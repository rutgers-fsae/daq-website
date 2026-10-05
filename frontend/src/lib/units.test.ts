import { describe, expect, it } from "vitest";
import {
  canonicalUnit,
  cleanDisplayUnits,
  compatibleUnits,
  convertChartData,
  convertUnit,
  sourceUnit,
  units,
} from "./units";
import { calculateVisibleStatistics } from "../components/plotStatistics";
import type { SchemaColumn } from "../types/dataset";

const column = (name: string, unit?: string): SchemaColumn => ({
  name,
  unit,
  type: "numeric",
  sample_values: [],
});

describe("unit conversion", () => {
  it.each([
    [100, "kph", "mph", 62.1371192237334],
    [100, "kPa", "psi", 14.5037737730209],
    [25.4, "mm", "in", 1],
    [1609344, "mm", "mi", 1],
    [0, "C", "°F", 32],
    [0, "°C", "K", 273.15],
    [-40, "°C", "°F", -40],
    [1, "g", "m/s²", 9.80665],
    [180, "deg", "rad", Math.PI],
    [60, "rpm", "rad/s", 2 * Math.PI],
    [1, "h", "s", 3600],
    [1, "lbf", "N", 4.4482216152605],
    [1, "lbf·ft", "Nm", 1.3558179483314],
    [1, "hp", "W", 745.69987158227],
    [1, "kV", "mV", 1e6],
    [1, "kA", "mA", 1e6],
    [1, "MHz", "Hz", 1e6],
  ])("converts %s %s to %s", (value, from, to, expected) => {
    expect(
      convertUnit(value as number, from as string, to as string),
    ).toBeCloseTo(expected as number, 8);
  });

  it("preserves identity and round-trips every compatible pair", () => {
    for (const from of Object.keys(units)) {
      for (const value of [-12.345, 0, 123.456]) {
        expect(convertUnit(value, from, from)).toBe(value);
        for (const to of compatibleUnits(from)) {
          expect(
            convertUnit(convertUnit(value, from, to), to, from),
          ).toBeCloseTo(value, 8);
        }
      }
    }
  });

  it("rejects incompatible and unknown units, preserving case", () => {
    expect(() => convertUnit(1, "mm", "psi")).toThrow();
    expect(() => convertUnit(1, "G", "g")).toThrow();
    expect(canonicalUnit("__proto__")).toBeUndefined();
    expect(canonicalUnit("pa")).toBeUndefined();
    expect(canonicalUnit(" N.m ")).toBe("N·m");
    expect(sourceUnit(column("G Force Lat", "G"))).toBe("g");
    expect(sourceUnit(column("mx", "G"))).toBeUndefined();
    expect(
      sourceUnit({ ...column("Time", "s"), type: "datetime" }),
    ).toBeUndefined();
    expect(
      cleanDisplayUnits(
        { Missing: "mph", Speed: "psi", mx: "g", Time: "s", junk: 3 },
        [column("Speed", "km/h"), column("mx", "G"), column("Time", "s")],
      ),
    ).toEqual({});
    expect(cleanDisplayUnits([])).toEqual({});
  });

  it("converts samples without mutation and computes statistics in display units", () => {
    const columns = [
      column("Time", "s"),
      column("Temp", "C"),
      column("pressure_pa", "kPa"),
    ];
    const data = [
      {
        name: "Temp",
        type: "scatter",
        mode: "lines",
        x: [0, 60, 120, 180],
        y: [0, 100, null, -40],
      },
      { name: "group - pressure_pa", type: "scatter", x: [0], y: [100] },
    ];
    const request = {
      chart_type: "line" as const,
      x_column: "Time",
      y_columns: ["Temp", "pressure_pa"],
      filters: [],
    };
    const selected = { Time: "min", Temp: "°F", pressure_pa: "psi" };
    const converted = convertChartData(data, request, columns, selected);
    expect(converted[0].x).toEqual([0, 1, 2, 3]);
    expect(converted[0].y).toEqual([
      expect.closeTo(32),
      expect.closeTo(212),
      null,
      expect.closeTo(-40),
    ]);
    expect((converted[1].y as number[])[0]).toBeCloseTo(14.503773773, 8);
    expect(data[0].y).toEqual([0, 100, null, -40]);
    expect(convertChartData(data, request, columns, selected)).toEqual(
      converted,
    );
    const [stats] = calculateVisibleStatistics(converted, { x: [0, 1] }, [
      "red",
    ]);
    expect(stats).toMatchObject({
      min: expect.closeTo(32),
      max: expect.closeTo(212),
      average: expect.closeTo(122),
    });
    expect(stats.rms).toBeCloseTo(Math.sqrt((32 ** 2 + 212 ** 2) / 2));
  });

  it.each(["line", "scatter", "bar", "histogram", "box"] as const)(
    "converts %s input samples",
    (chart_type) => {
      const data = [
        { name: "Length", x: ["A"], y: [25.4, undefined, NaN, Infinity] },
      ];
      const converted = convertChartData(
        data,
        { chart_type, y_columns: ["Length"], filters: [] },
        [column("Length", "mm")],
        { Length: "in" },
      );
      expect(converted[0].y).toEqual([1, undefined, NaN, Infinity]);
      expect(converted[0].x).toEqual(["A"]);
    },
  );
});
