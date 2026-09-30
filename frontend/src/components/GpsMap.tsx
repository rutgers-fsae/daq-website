import { useEffect, useMemo, useState } from "react";
import { getChartData } from "../api/datasets";
import type { FilterRule } from "../types/chart";
import type { SchemaColumn } from "../types/dataset";
import { Alert, Button, FieldSelect, Label, Panel } from "./ui";

type Props = {
  slug: string;
  columns: SchemaColumn[];
  graphs: {
    id: number;
    name: string;
    chartConfig: { filters: FilterRule[] };
  }[];
};
type Sample = {
  time: string;
  seconds: number;
  lat: number | null;
  lon: number | null;
};

export function GpsMap({ slug, columns, graphs }: Props) {
  const sources = ["ins", "gnss"].filter((source) =>
    ["lat", "lon"].every((axis) =>
      columns.some((column) => column.name === `${source}_${axis}`),
    ),
  );
  const [source, setSource] = useState(sources[0] || "");
  const [graphId, setGraphId] = useState(graphs[0]?.id);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reduced, setReduced] = useState(false);
  const graph = graphs.find((item) => item.id === graphId) || graphs[0];
  const filters = graph?.chartConfig.filters;
  const hasFix = columns.some((column) => column.name === "gnss_fix");
  const hasTimestamp = columns.some((column) => column.name === "timestamp");

  useEffect(() => {
    if (!source || !hasTimestamp) return;
    let active = true;
    setLoading(true);
    setError(null);
    setPlaying(false);
    setSamples([]);
    setIndex(0);
    const channels = [`${source}_lat`, `${source}_lon`];
    if (source === "gnss" && hasFix) channels.push("gnss_fix");
    getChartData(slug, {
      chart_type: "line",
      x_column: "timestamp",
      y_columns: channels,
      filters: filters || [],
    })
      .then((result) => {
        if (!active) return;
        const traces = result.data as { x: string[]; y: (number | null)[] }[];
        const times = traces[0]?.x || [];
        const start = Date.parse(times[0]);
        const loaded = times.map((time, i) => {
          const lat = traces[0].y[i],
            lon = traces[1].y[i];
          const fix = traces[2]?.y[i];
          const valid =
            typeof lat === "number" &&
            Number.isFinite(lat) &&
            Math.abs(lat) <= 90 &&
            typeof lon === "number" &&
            Number.isFinite(lon) &&
            Math.abs(lon) <= 180 &&
            !(lat === 0 && lon === 0) &&
            (source !== "gnss" ||
              !hasFix ||
              (typeof fix === "number" && fix >= 2 && fix <= 8));
          return {
            time,
            seconds: (Date.parse(time) - start) / 1000,
            lat: valid ? lat : null,
            lon: valid ? lon : null,
          };
        });
        if (
          loaded.some(
            (sample, i) =>
              !Number.isFinite(sample.seconds) ||
              (i > 0 && sample.seconds < loaded[i - 1].seconds),
          )
        ) {
          throw new Error(
            "GPS playback requires valid timestamps in chronological order.",
          );
        }
        setSamples(loaded);
        setReduced(result.was_downsampled || false);
      })
      .catch((err: unknown) => {
        if (active)
          setError(
            err instanceof Error ? err.message : "Unable to load GPS track",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug, source, filters, hasFix, hasTimestamp]);

  useEffect(() => {
    if (!playing || !samples.length) return;
    const start = performance.now();
    const from = samples[index].seconds;
    let cursor = index;
    const timer = window.setInterval(() => {
      const seconds = from + (performance.now() - start) / 1000;
      while (
        cursor < samples.length - 1 &&
        samples[cursor + 1].seconds <= seconds
      )
        cursor++;
      setIndex(cursor);
      if (cursor === samples.length - 1) setPlaying(false);
    }, 100);
    return () => window.clearInterval(timer);
    // The playback clock starts only when playback or the loaded track changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, samples]);

  const track = useMemo(() => {
    const origin = samples.find(
      (sample) => sample.lat !== null && sample.lon !== null,
    );
    if (!origin || origin.lat === null || origin.lon === null) return null;
    const originLat = origin.lat,
      originLon = origin.lon;
    // ponytail: local tangent approximation for track-sized runs; use a geodesic projection for regional trips.
    const points = samples.map((sample) =>
      sample.lat === null || sample.lon === null
        ? null
        : {
            x:
              (6371000 *
                Math.cos((originLat * Math.PI) / 180) *
                (sample.lon - originLon) *
                Math.PI) /
              180,
            y: (6371000 * (sample.lat - originLat) * Math.PI) / 180,
          },
    );
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const point of points) {
      if (!point) continue;
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    const scale = Math.min(
      720 / Math.max(20, maxX - minX),
      320 / Math.max(20, maxY - minY),
    );
    const screen = points.map((point) =>
      point
        ? {
            x: 400 + (point.x - (minX + maxX) / 2) * scale,
            y: 200 - (point.y - (minY + maxY) / 2) * scale,
          }
        : null,
    );
    const paths = screen.map((point, i) =>
      point
        ? `${i === 0 || !screen[i - 1] ? "M" : "L"}${point.x},${point.y}`
        : "",
    );
    return { screen, paths, scale };
  }, [samples]);

  if (!sources.length || !hasTimestamp) return null;
  const current = samples[index];
  const position = track?.screen[index];
  return (
    <Panel className="grid gap-3 p-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">
        GPS Track
      </h2>
      <div className="flex flex-wrap gap-3">
        <Label className="grid gap-1">
          Position source
          <FieldSelect
            aria-label="GPS position source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            {sources.map((item) => (
              <option key={item} value={item}>
                {item.toUpperCase()}
              </option>
            ))}
          </FieldSelect>
        </Label>
        <Label className="grid gap-1">
          Follow time filters from
          <FieldSelect
            aria-label="GPS graph time filters"
            value={graph?.id ?? ""}
            onChange={(event) => setGraphId(Number(event.target.value))}
          >
            {graphs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </FieldSelect>
        </Label>
        <p className="self-end text-xs text-muted">
          North up · local track in meters
        </p>
      </div>
      {loading && <p role="status">Loading GPS track...</p>}
      {error && <Alert tone="danger">{error}</Alert>}
      {!loading && !error && !track && (
        <p role="status">No valid GPS positions in this time range.</p>
      )}
      {track && (
        <>
          <svg
            viewBox="0 0 800 400"
            className="w-full rounded-md border border-border bg-surface-soft"
            role="img"
            aria-label="GPS route with current position; north is up"
          >
            <path
              d={track.paths.join(" ")}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.2"
              strokeWidth="2"
            />
            <path
              d={track.paths.slice(0, index + 1).join(" ")}
              fill="none"
              stroke={source === "ins" ? "#e63946" : "#d99b21"}
              strokeWidth="3"
            />
            {position && (
              <circle cx={position.x} cy={position.y} r="6" fill="currentColor">
                <title>Current position</title>
              </circle>
            )}
            <path
              d={`M30,360 h${10 * track.scale}`}
              stroke="currentColor"
              strokeWidth="2"
            />
            <text x="30" y="385" fill="currentColor" fontSize="14">
              10 m
            </text>
            <text x="770" y="25" fill="currentColor" fontSize="14">
              N ↑
            </text>
          </svg>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => {
                if (index === samples.length - 1) setIndex(0);
                setPlaying((value) => !value);
              }}
              disabled={samples.length < 2}
            >
              {playing ? "Pause" : "Play"}
            </Button>
            <input
              type="range"
              min="0"
              max={samples.length - 1}
              value={index}
              aria-label="GPS playback time"
              className="min-w-0 flex-1 accent-button"
              onChange={(event) => {
                setPlaying(false);
                setIndex(Number(event.target.value));
              }}
            />
          </div>
          <p className="text-sm text-muted" aria-live="off">
            {current?.time} · {current?.seconds.toFixed(1)} s ·{" "}
            {position
              ? `${current.lat?.toFixed(6)}, ${current.lon?.toFixed(6)}`
              : "No valid position"}
          </p>
          {reduced && (
            <p className="text-xs text-muted">
              Track reduced to {samples.length.toLocaleString()} samples for
              display.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
