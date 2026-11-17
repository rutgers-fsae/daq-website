#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy"]
# ///
"""Merge VectorNav logger CSVs into a MoTeC CSV export.

    uv run scripts/merge_motec_vectornav.py MOTEC.csv VN1.csv [VN2.csv ...] [-o OUT.csv]

The two loggers share no clock, so each VectorNav file is placed on the MoTeC
time axis by cross-correlating its GNSS speed against MoTeC wheel speed. Files
that do not match this MoTeC log (wrong session, stationary, no GNSS fix) are
reported and left out, so it is safe to pass a whole day's VectorNav files.

Output is the MoTeC CSV, byte-for-byte, with the VectorNav columns appended.
VectorNav is slower than MoTeC, so each MoTeC row gets the nearest VectorNav
sample (no interpolation); rows with no VectorNav sample nearby stay blank.

Self-check: uv run scripts/merge_motec_vectornav.py --self-test
"""

import argparse
import csv
import hashlib
import sys
import tempfile
from pathlib import Path

import numpy as np

GRID_S = 0.1  # resolution of the speed cross-correlation
MIN_SPEED_STD = 0.5  # m/s; below this a trace has no shape to align on
SPEED_TO_MS = {"km/h": 1 / 3.6, "kph": 1 / 3.6, "mph": 0.44704, "m/s": 1.0}
VN_UNITS = {
    "startup_ns": "ns", "gps_utc_ns": "ns", "dt": "s",
    "yaw": "deg", "pitch": "deg", "roll": "deg",
    "ax": "m/s²", "ay": "m/s²", "az": "m/s²",
    "gx": "rad/s", "gy": "rad/s", "gz": "rad/s",
    "dvx": "m/s", "dvy": "m/s", "dvz": "m/s",
    "dtx": "deg", "dty": "deg", "dtz": "deg",
    "mx": "G", "my": "G", "mz": "G", "temp_c": "C",
    "pressure_pa": "kPa",  # the logger writes kPa despite the column name
    **{f"{p}_{a}": "deg" for p in ("gnss", "ins") for a in ("lat", "lon")},
    **{
        f"{p}_{a}": "m/s"
        for p in ("gnss", "ins")
        for a in ("vn", "ve", "vd", "speed", "vel_u")
    },
    **{
        f"{p}_{a}": "m"
        for p in ("gnss", "ins")
        for a in ("alt", "pos_u", "pos_u_n", "pos_u_e", "pos_u_d")
    },
}


def load_motec(path, speed_column=None):
    """Raw lines plus the Time and speed (m/s) of every data row."""
    with open(path, newline="") as fh:
        lines = fh.readlines()
    header = next(
        i for i, line in enumerate(lines) if line.startswith(('"Time"', "Time,"))
    )
    names = next(csv.reader([lines[header]]))
    units = next(csv.reader([lines[header + 1]]))
    if speed_column:
        speed_cols = [names.index(speed_column)]
    else:
        speed_cols = [i for i, n in enumerate(names) if "wheel speed" in n.lower()]
    if not speed_cols:
        sys.exit("No 'Wheel Speed' column in the MoTeC file; pass --speed-column")
    scale = SPEED_TO_MS.get(units[speed_cols[0]].strip().lower())
    if scale is None:
        sys.exit(f"Unknown speed unit {units[speed_cols[0]]!r}")

    rows, time, speed = [], [], []
    for i in range(header + 2, len(lines)):
        fields = [f.strip('"') for f in lines[i].rstrip("\r\n").split(",")]
        try:
            t = float(fields[0])
        except ValueError:
            continue
        rows.append(i)
        time.append(t)
        # Max across wheels: a dead sensor reads 0 and is ignored.
        speed.append(max((float(fields[c] or 0) for c in speed_cols), default=0.0))
    return {
        "lines": lines,
        "header": header,
        "names": names,
        "rows": np.array(rows),
        "time": np.array(time),
        "speed": np.array(speed) * scale,
    }


def load_vn(path):
    with open(path, newline="") as fh:
        lines = [line.rstrip("\r\n") for line in fh]
    names = lines[0].split(",")
    col = {n: i for i, n in enumerate(names)}
    raw, startup, gps, speed, fix = [], [], [], [], []
    for line in lines[1:]:
        f = line.split(",")
        if len(f) != len(names) or not f[col["startup_ns"]]:
            continue  # truncated last line from a power cut
        raw.append(line)
        startup.append(int(f[col["startup_ns"]]))
        gps.append(int(f[col["gps_utc_ns"]] or 0))
        speed.append(float(f[col["gnss_speed"]] or 0))
        fix.append(int(float(f[col["gnss_fix"]] or 0)) if "gnss_fix" in col else 1)
    startup, gps = np.array(startup), np.array(gps)
    # Before the first fix the logger writes startup time into gps_utc_ns.
    has_time = (gps != startup) & (gps > 10**17)
    return {
        "path": Path(path),
        "names": names,
        "raw": raw,
        "startup": startup / 1e9,
        "speed": np.array(speed),
        "fix": np.array(fix) > 0,
        "gps_minus_startup": (
            float(np.median((gps - startup)[has_time])) / 1e9
            if has_time.any()
            else None
        ),
    }


def align(motec, vn):
    """Find where the VN file sits in MoTeC time.

    Returns (reason, None) or (None, match) where motec_time = startup + offset.
    """
    if vn["fix"].sum() < 2:
        return "no GNSS fix", None
    st, sp = vn["startup"][vn["fix"]], vn["speed"][vn["fix"]]
    vg = np.arange(st[0], st[-1], GRID_S)
    vs = np.interp(vg, st, sp)
    n = len(vs)
    if n < 100 or vs.std() < MIN_SPEED_STD:
        return "stationary (no speed trace to align on)", None
    mg = np.arange(motec["time"][0], motec["time"][-1], GRID_S)
    mv = np.interp(mg, motec["time"], motec["speed"])
    if mv.std() < MIN_SPEED_STD:
        return "MoTeC log is stationary (no speed trace to align on)", None
    # ponytail: a VN file must lie wholly inside the MoTeC log; pad mv with
    # zeros here if partially overlapping files ever need merging.
    if n >= len(mv):
        return "longer than the MoTeC log", None

    # Normalised cross-correlation of the VN trace at every MoTeC position.
    a = (vs - vs.mean()) / vs.std()
    cs, cs2 = np.cumsum(np.r_[0, mv]), np.cumsum(np.r_[0, mv**2])
    mu = (cs[n:] - cs[:-n]) / n
    sd = np.sqrt(np.maximum((cs2[n:] - cs2[:-n]) / n - mu**2, 1e-12))
    c = np.where(sd > MIN_SPEED_STD, np.correlate(mv, a, "valid") / n / sd, -1.0)
    k = int(c.argmax())
    shift = 0.0
    if 0 < k < len(c) - 1:  # parabolic peak fit for sub-grid resolution
        y0, y1, y2 = c[k - 1 : k + 2]
        if y0 - 2 * y1 + y2 < 0:
            shift = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2)
    seg = mv[k : k + n]
    offset = mg[k] + shift * GRID_S - vg[0]
    wall = vn["gps_minus_startup"]
    return None, {
        "corr": float(c[k]),
        "scale": float(seg @ vs / max(seg @ seg, 1e-9)),
        "offset": offset,
        "start": vn["startup"][0] + offset,
        "end": vn["startup"][-1] + offset,
        # GPS time at MoTeC t=0; consistent across files of one MoTeC session.
        "t0": None if wall is None else wall - offset,
    }


def pick_consistent(matches):
    """Largest set of matches that cannot contradict each other.

    A short acceleration run can correlate well in several logs, so also
    require that files do not overlap and that GPS time never runs backwards
    along the MoTeC time axis (MoTeC only ever skips time while powered off).
    """
    order = sorted(matches, key=lambda m: m["start"])
    best, prev = [], []
    for i, m in enumerate(order):
        score, link = 0.0, None
        for j in range(i):
            p = order[j]
            fits = p["end"] <= m["start"] + 1.0 and (
                p["t0"] is None or m["t0"] is None or p["t0"] <= m["t0"] + 1.0
            )
            if fits and best[j] > score:
                score, link = best[j], j
        best.append(score + m["corr"] * (m["end"] - m["start"]))
        prev.append(link)
    keep = []
    i = int(np.argmax(best)) if best else None
    while i is not None:
        keep.append(order[i])
        i = prev[i]
    return keep[::-1]


def merge(motec_path, vn_paths, out_path, *, min_corr=0.95, scale_tol=0.1,
          max_gap=0.1, vn_shift=0.0, speed_column=None):
    motec = load_motec(motec_path, speed_column)
    print(f"{Path(motec_path).name}: {len(motec['time'])} rows, "
          f"{motec['time'][0]:.1f}..{motec['time'][-1]:.1f} s")

    candidates, seen, vn_names = [], set(), None
    # Shortest name first so "x.csv" wins over its duplicate "x(1).csv".
    for path in sorted(vn_paths, key=lambda p: (len(Path(p).name), Path(p).name)):
        name = Path(path).name
        digest = hashlib.sha1(Path(path).read_bytes()).hexdigest()
        if digest in seen:
            print(f"  skip  {name}: duplicate of an earlier file")
            continue
        seen.add(digest)
        vn = load_vn(path)
        vn_names = vn_names or vn["names"]
        if vn["names"] != vn_names:
            sys.exit(f"{name}: columns differ from the other VectorNav files")
        reason, m = align(motec, vn)
        if m and m["corr"] < min_corr:
            reason = f"speed correlation {m['corr']:.3f} < {min_corr}"
        elif m and abs(m["scale"] - 1) > scale_tol:
            reason = f"speed scale {m['scale']:.2f} (corr {m['corr']:.3f})"
        if reason:
            print(f"  skip  {name}: {reason}")
        else:
            candidates.append({**m, "vn": vn})

    kept = pick_consistent(candidates)
    for m in candidates:
        if not any(m is k for k in kept):
            print(f"  skip  {m['vn']['path'].name}: corr {m['corr']:.3f} but "
                  "overlaps or contradicts the GPS time of better matches")
    for m in kept:
        print(f"  MERGE {m['vn']['path'].name}: MoTeC {m['start']:.2f}..{m['end']:.2f} s"
              f"  corr {m['corr']:.3f}  scale {m['scale']:.2f}")
    if not kept:
        print("  WARNING: no VectorNav file matched; VectorNav columns will be empty")

    # Nearest VectorNav sample for every MoTeC row.
    vt = np.concatenate([m["vn"]["startup"] + m["offset"] + vn_shift for m in kept]
                        or [np.empty(0)])
    raw = [line for m in kept for line in m["vn"]["raw"]]
    order = np.argsort(vt, kind="stable")  # adjacent files can touch
    vt, raw = vt[order], [raw[i] for i in order]
    t = motec["time"]
    nearest = np.full(len(t), -1)
    if len(vt):
        right = np.clip(np.searchsorted(vt, t), 1, len(vt) - 1) if len(vt) > 1 else 0
        left = np.maximum(right - 1, 0)
        idx = np.where(np.abs(vt[left] - t) <= np.abs(vt[right] - t), left, right)
        nearest = np.where(np.abs(vt[idx] - t) <= max_gap, idx, -1)

    vn_names = vn_names or []
    out_names = [n if n not in motec["names"] else f"vn_{n}" for n in vn_names]
    blank = "," * len(vn_names)
    extra = dict(zip(motec["rows"].tolist(), nearest.tolist()))
    quoted = lambda items: "".join(f',"{x}"' for x in items)  # noqa: E731
    with open(out_path, "w", newline="") as out:
        for i, line in enumerate(motec["lines"]):
            body = line.rstrip("\r\n")
            eol = line[len(body):]
            if i == motec["header"]:
                body += quoted(out_names)
            elif i == motec["header"] + 1:
                body += quoted(VN_UNITS.get(n, "") for n in vn_names)
            elif i in extra:
                j = extra[i]
                body += "," + raw[j] if j >= 0 else blank
            out.write(body + eol)
    filled = int((nearest >= 0).sum())
    print(f"  wrote {out_path}: {filled}/{len(t)} rows have VectorNav data "
          f"({filled / max(len(t), 1):.0%})")
    return kept


def self_test():
    rng = np.random.default_rng(0)
    t = np.arange(0, 300, 0.005)
    speed = np.abs(np.cumsum(rng.normal(0, 0.05, len(t))))  # m/s random walk
    start = 100.03  # MoTeC time at which the VN file begins
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        motec = ['"Format","MoTeC CSV File"\r\n', "\r\n",
                 '"Time","Wheel Speed FL","Wheel Speed FR"\r\n', '"s","km/h","km/h"\r\n',
                 "\r\n"]
        motec += [f'"{a:.3f}","{b * 3.6:.3f}","0.0"\r\n' for a, b in zip(t, speed)]
        (tmp / "m.csv").write_text("".join(motec), newline="")
        vt = np.arange(0, 60, 0.1)
        rows = ["timestamp,startup_ns,gps_utc_ns,yaw,gnss_fix,gnss_speed"]
        for i, s in enumerate(vt):
            ns = int(round((13 + s) * 1e9))
            rows.append(f"x,{ns},{ns + 10**18},{i},4,"
                        f"{np.interp(start + s, t, speed):.4f}")
        (tmp / "good.csv").write_text("\n".join(rows) + "\n")
        (tmp / "copy.csv").write_text("\n".join(rows) + "\n")
        flat = [rows[0]] + [f"x,{int(1e9 * i)},{int(1e9 * i) + 10**18},0,4,0.0"
                            for i in range(200)]
        (tmp / "still.csv").write_text("\n".join(flat) + "\n")
        kept = merge(tmp / "m.csv", [tmp / "good.csv", tmp / "copy.csv",
                                     tmp / "still.csv"], tmp / "out.csv")
        assert len(kept) == 1 and kept[0]["corr"] > 0.99, kept[0]["corr"]
        assert abs(kept[0]["start"] - start) < 0.02, kept[0]["start"]
        out = list(csv.reader(open(tmp / "out.csv", newline="")))
        assert out[2][3:] == rows[0].split(","), out[2]
        assert out[3][6] == "deg", out[3]  # yaw units
        by_time = {r[0]: r for r in out[5:]}
        assert by_time["130.030"][6] == "300", by_time["130.030"]  # yaw = sample no.
        assert by_time["130.070"][6] == "300" and by_time["130.090"][6] == "301"
        assert by_time["50.000"][3:] == [""] * 6, by_time["50.000"]
        assert all(len(r) == 9 for r in out[5:])
    print("self-test passed")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        sys.exit()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("motec", type=Path)
    ap.add_argument("vectornav", type=Path, nargs="+")
    ap.add_argument("-o", "--output", type=Path,
                    help="default: <motec name>_merged.csv next to the MoTeC file")
    ap.add_argument("--min-corr", type=float, default=0.95,
                    help="minimum speed correlation to accept a file (default 0.95)")
    ap.add_argument("--scale-tol", type=float, default=0.1,
                    help="allowed GNSS/wheel speed ratio error (default 0.1)")
    ap.add_argument("--max-gap", type=float, default=0.1,
                    help="seconds a VectorNav sample may be from a MoTeC row (default 0.1)")
    ap.add_argument("--vn-shift", type=float, default=0.0,
                    help="seconds added to VectorNav times, e.g. to cancel GNSS latency")
    ap.add_argument("--speed-column",
                    help="MoTeC speed channel to align on (default: max of all wheel speeds)")
    args = ap.parse_args()
    output = args.output or args.motec.with_name(f"{args.motec.stem}_merged.csv")
    merge(args.motec, args.vectornav, output, min_corr=args.min_corr,
          scale_tol=args.scale_tol, max_gap=args.max_gap, vn_shift=args.vn_shift,
          speed_column=args.speed_column)
