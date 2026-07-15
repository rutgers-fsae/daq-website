import { describe, expect, it } from "vitest";
import { calculateVisibleStatistics, formatStatistic, updateVisibleRanges } from "./plotStatistics";

const colors = ["#f00", "#0ff"];

describe("plot statistics", () => {
  it("calculates statistics for finite points inside the full viewport", () => {
    const [statistics] = calculateVisibleStatistics(
      [{ name: "Speed", x: [0, 1, 2, 3], y: [10, 20, null, 40], type: "scatter", mode: "lines" }],
      { x: [1, 3], y: [15, 35] },
      colors,
    );

    expect(statistics).toMatchObject({ name: "Speed", average: 20, min: 20, max: 20, rms: 20 });
  });

  it("uses each trace's assigned y-axis range and accepts reversed bounds", () => {
    const statistics = calculateVisibleStatistics(
      [
        { name: "Speed", x: [0, 1], y: [10, 20], type: "scatter", mode: "lines", yaxis: "y" },
        { name: "Voltage", x: [0, 1], y: [300, 400], type: "scatter", mode: "lines", yaxis: "y2" },
      ],
      { x: [1, 0], y: [15, 25], y2: [450, 350] },
      colors,
    );

    expect(statistics[0]).toMatchObject({ average: 20, min: 20, max: 20 });
    expect(statistics[1]).toMatchObject({ average: 400, min: 400, max: 400 });
  });

  it("calculates RMS independently from the average", () => {
    const [statistics] = calculateVisibleStatistics(
      [{ name: "Signal", x: [0, 1], y: [-3, 3], type: "scatter", mode: "markers" }],
      {},
      colors,
    );

    expect(statistics.average).toBe(0);
    expect(statistics.rms).toBe(3);
  });

  it("supports datetime and categorical x ranges", () => {
    const [dates] = calculateVisibleStatistics(
      [
        {
          name: "Dates",
          x: ["2026-01-01", "2026-01-02", "2026-01-03"],
          y: [1, 2, 3],
          type: "scatter",
          mode: "lines",
        },
      ],
      { x: ["2026-01-02", "2026-01-03"] },
      colors,
    );
    const [categories] = calculateVisibleStatistics(
      [{ name: "Laps", x: ["A", "B", "C"], y: [10, 20, 30], type: "scatter", mode: "markers" }],
      { x: [0.5, 2] },
      colors,
    );

    expect(dates).toMatchObject({ average: 2.5, min: 2, max: 3 });
    expect(categories).toMatchObject({ average: 25, min: 20, max: 30 });
  });

  it("returns empty values and excludes unsupported chart types", () => {
    const empty = calculateVisibleStatistics(
      [{ name: "Signal", x: [0], y: [10], type: "scatter", mode: "lines" }],
      { x: [2, 3] },
      colors,
    );
    const unsupported = calculateVisibleStatistics(
      [{ name: "Bars", x: [0], y: [10], type: "bar" }],
      {},
      colors,
    );

    expect(empty[0]).toMatchObject({ rms: null, average: null, min: null, max: null });
    expect(unsupported).toEqual([]);
    expect(formatStatistic(null)).toBe("N/A");
    expect(formatStatistic(12345.67)).toBe("12,350");
  });

  it("updates individual ranges and clears axes on autorange", () => {
    const zoomed = updateVisibleRanges({}, {
      "xaxis.range[0]": 1,
      "xaxis.range[1]": 3,
      "yaxis.range": [10, 20],
    });
    const reset = updateVisibleRanges(zoomed, { "xaxis.autorange": true });

    expect(zoomed).toEqual({ x: [1, 3], y: [10, 20] });
    expect(reset).toEqual({ y: [10, 20] });
  });
});
