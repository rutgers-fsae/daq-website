import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getChartData } from "../api/datasets";
import type { SchemaColumn } from "../types/dataset";
import { GpsMap } from "./GpsMap";

vi.mock("../api/datasets", () => ({ getChartData: vi.fn() }));
const columns = [
  "timestamp",
  "ins_lat",
  "ins_lon",
  "gnss_lat",
  "gnss_lon",
  "gnss_fix",
].map(
  (name) =>
    ({
      name,
      type: name === "timestamp" ? "datetime" : "numeric",
      sample_values: [],
    }) as SchemaColumn,
);
const graphs = [{ id: 1, name: "Graph 1", chartConfig: { filters: [] } }];
const times = [0, 1, 2, 4].map((seconds) => `2026-09-30T00:00:0${seconds}Z`);
const data = [
  { x: times, y: [40, null, 40.002, 40.003] },
  { x: times, y: [-74, null, -74.002, -74.003] },
];

describe("GpsMap", () => {
  beforeEach(() => {
    vi.mocked(getChartData).mockReset();
    vi.mocked(getChartData).mockResolvedValue({ data, row_count: 4 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides for datasets without GPS columns", () => {
    render(<GpsMap slug="sample" columns={[]} graphs={graphs} />);
    expect(screen.queryByText("GPS Track")).not.toBeInTheDocument();
    expect(getChartData).not.toHaveBeenCalled();
  });

  it("shows INS, preserves position gaps, and scrubs through time", async () => {
    const { container } = render(
      <GpsMap slug="sample" columns={columns} graphs={graphs} />,
    );
    await screen.findByRole("img");
    expect(getChartData).toHaveBeenCalledWith(
      "sample",
      expect.objectContaining({
        x_column: "timestamp",
        y_columns: ["ins_lat", "ins_lon"],
      }),
    );
    const path = container.querySelector("svg path")?.getAttribute("d");
    expect(path?.match(/M/g)).toHaveLength(2);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });
    expect(screen.getByText(/No valid position/)).toBeInTheDocument();
    expect(container.querySelector("svg circle")).toBeNull();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });
    expect(screen.getByText(/4.0 s/)).toBeInTheDocument();
    expect(container.querySelector("svg circle")).not.toBeNull();
  });

  it("plays using recorded timing and stops at the end", async () => {
    render(<GpsMap slug="sample" columns={columns} graphs={graphs} />);
    await screen.findByRole("img");
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "performance"],
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByRole("slider")).toHaveValue("1");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("slider")).toHaveValue("3");
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("slider")).toHaveValue("0");
  });

  it("uses graph time filters and validates GNSS fixes", async () => {
    const filters = [
      { column: "timestamp", op: "gte" as const, value: times[2] },
    ];
    render(
      <GpsMap
        slug="sample"
        columns={columns}
        graphs={[
          ...graphs,
          { id: 2, name: "Late run", chartConfig: { filters } },
        ]}
      />,
    );
    await screen.findByRole("img");
    fireEvent.change(screen.getByLabelText("GPS graph time filters"), {
      target: { value: "2" },
    });
    await waitFor(() =>
      expect(getChartData).toHaveBeenLastCalledWith(
        "sample",
        expect.objectContaining({ filters }),
      ),
    );
    vi.mocked(getChartData).mockResolvedValue({
      data: [...data, { x: times, y: [0, 0, 0, 0] }],
      row_count: 4,
    });
    fireEvent.change(screen.getByLabelText("GPS position source"), {
      target: { value: "gnss" },
    });
    expect(
      await screen.findByText("No valid GPS positions in this time range."),
    ).toBeInTheDocument();
    expect(getChartData).toHaveBeenLastCalledWith(
      "sample",
      expect.objectContaining({
        y_columns: ["gnss_lat", "gnss_lon", "gnss_fix"],
      }),
    );
  });

  it("rejects an invalid playback timeline", async () => {
    vi.mocked(getChartData).mockResolvedValue({
      data: data.map((trace) => ({ ...trace, x: [...times].reverse() })),
      row_count: 4,
    });
    render(<GpsMap slug="sample" columns={columns} graphs={graphs} />);
    expect(
      await screen.findByText(
        "GPS playback requires valid timestamps in chronological order.",
      ),
    ).toBeInTheDocument();
  });

  it("reports load errors", async () => {
    vi.mocked(getChartData).mockRejectedValue(new Error("GPS load failed"));
    render(<GpsMap slug="sample" columns={columns} graphs={graphs} />);
    expect(await screen.findByText("GPS load failed")).toBeInTheDocument();
  });
});
