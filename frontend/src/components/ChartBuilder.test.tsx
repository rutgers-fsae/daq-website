import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChartBuilder } from "./ChartBuilder";
import type { SchemaColumn } from "../types/dataset";

const columns: SchemaColumn[] = [
  {
    name: "Time",
    type: "numeric",
    unit: "s",
    display_name: "Time (s)",
    sample_values: ["0", "1"],
  },
  {
    name: "Speed",
    type: "numeric",
    unit: "mph",
    display_name: "Speed (mph)",
    sample_values: ["10", "20"],
  },
  {
    name: "Driver",
    type: "categorical",
    display_name: "Driver",
    sample_values: ["A"],
  },
];

describe("ChartBuilder", () => {
  it("emits selected chart request and axis titles", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(<ChartBuilder columns={columns} onRun={onRun} />);

    await user.click(screen.getByRole("button", { name: /select x axis/i }));
    await user.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: "Time (s)",
      }),
    );
    await user.click(screen.getByRole("button", { name: /select y series/i }));
    await user.click(screen.getByRole("checkbox", { name: "Speed (mph)" }));
    await user.click(screen.getByRole("button", { name: "Render" }));

    expect(onRun).toHaveBeenCalledWith(
      {
        chart_type: "line",
        x_column: "Time",
        y_columns: ["Speed"],
        filters: [],
      },
      expect.objectContaining({
        xTitle: "Time (s)",
        yTitle: "Speed (mph)",
      }),
      {},
    );
  });

  it.each(["Time", "elapsed_s", "device_elapsed_s", "startup_ns"])(
    "filters %s when time is not the x axis",
    async (timeName) => {
      const user = userEvent.setup();
      const onRun = vi.fn();
      render(
        <ChartBuilder
          columns={[{ ...columns[0], name: timeName }, ...columns.slice(1)]}
          onRun={onRun}
        />,
      );

      await user.click(screen.getByRole("button", { name: /select x axis/i }));
      await user.click(
        within(screen.getByRole("listbox")).getByRole("option", {
          name: "Driver",
        }),
      );
      await user.click(
        screen.getByRole("button", { name: /select y series/i }),
      );
      await user.click(screen.getByRole("checkbox", { name: "Speed (mph)" }));
      await user.type(
        screen.getByRole("spinbutton", { name: "Time filter start" }),
        "10",
      );
      await user.type(
        screen.getByRole("spinbutton", { name: "Time filter end" }),
        "20",
      );
      await user.click(screen.getByRole("button", { name: "Render" }));

      expect(onRun).toHaveBeenCalledWith(
        {
          chart_type: "line",
          x_column: "Driver",
          y_columns: ["Speed"],
          filters: [
            { column: timeName, op: "gte", value: 10 },
            { column: timeName, op: "lte", value: 20 },
          ],
        },
        expect.objectContaining({
          xTitle: "Driver",
          yTitle: "Speed (mph)",
        }),
        {},
      );
    },
  );

  it("shows an empty state when there are no numeric columns", () => {
    render(<ChartBuilder columns={[columns[2]]} onRun={vi.fn()} />);

    expect(
      screen.getByText("This dataset has no numeric columns to plot."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Render" })).toBeDisabled();
  });

  it("searches available X and Y channels", async () => {
    const user = userEvent.setup();
    render(<ChartBuilder columns={columns} onRun={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /select x axis/i }));
    await user.type(
      screen.getByPlaceholderText("Search X channels..."),
      "driver",
    );
    const xOptions = within(screen.getByRole("listbox"));
    expect(
      xOptions.getByRole("option", { name: "Driver" }),
    ).toBeInTheDocument();
    expect(
      xOptions.queryByRole("option", { name: "Time (s)" }),
    ).not.toBeInTheDocument();
    await user.click(xOptions.getByRole("option", { name: "Driver" }));

    await user.click(screen.getByRole("button", { name: /select y series/i }));
    await user.type(
      screen.getByPlaceholderText("Search Y channels..."),
      "speed",
    );
    const yOptions = within(screen.getByRole("listbox"));
    expect(
      yOptions.getByRole("option", { name: /speed/i }),
    ).toBeInTheDocument();
    expect(yOptions.queryByText("Time (s)")).not.toBeInTheDocument();
  });
  it("uses saved display units for shared axes and snapshots them on Render", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const onConfigChange = vi.fn();
    render(
      <ChartBuilder
        columns={[
          ...columns,
          { ...columns[1], name: "OtherSpeed", unit: "kph" },
        ]}
        config={{
          chart_type: "line",
          x_column: "Time",
          y_columns: ["Speed", "OtherSpeed"],
          filters: [],
          display_units: { OtherSpeed: "mph", Missing: "psi", Speed: "psi" },
        }}
        onConfigChange={onConfigChange}
        onRun={onRun}
      />,
    );
    expect(screen.getByLabelText("OtherSpeed display unit")).toHaveValue("mph");
    expect(screen.getByLabelText("Speed display unit")).toHaveValue("mph");
    expect(screen.queryByText(/Using dual Y-axes/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Time display unit"), "min");
    await user.type(screen.getByLabelText("Time filter start"), "60");
    await user.click(screen.getByRole("button", { name: "Render" }));
    expect(onRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: [{ column: "Time", op: "gte", value: 60 }],
      }),
      expect.objectContaining({
        xTitle: "Time (min)",
        yTitle: "Values (mph)",
        y2Title: undefined,
        traceAxisByColumn: { Speed: "y", OtherSpeed: "y" },
      }),
      { Time: "min", OtherSpeed: "mph" },
    );
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        display_units: { Time: "min", OtherSpeed: "mph" },
      }),
    );
    await user.selectOptions(
      screen.getByLabelText("Speed display unit"),
      "m/s",
    );
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Using dual Y-axes/)).toBeInTheDocument();
  });

  it("keeps the two-axis limit and omits unknown and datetime conversion controls", async () => {
    const user = userEvent.setup();
    render(
      <ChartBuilder
        columns={[
          ...columns,
          {
            ...columns[1],
            name: "Pressure",
            unit: "kPa",
            display_name: "Pressure (kPa)",
          },
          {
            ...columns[1],
            name: "Unknown",
            unit: "G",
            display_name: "Unknown (G)",
          },
          { ...columns[0], name: "timestamp", type: "datetime" },
        ]}
        config={{
          chart_type: "line",
          x_column: "timestamp",
          y_columns: ["Speed", "Pressure", "Unknown"],
          filters: [],
        }}
        onRun={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Render" })).toBeDisabled();
    expect(
      screen.queryByLabelText("Unknown display unit"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("timestamp display unit"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Unknown (G)" }));
    expect(screen.getByRole("button", { name: "Render" })).toBeEnabled();
  });
  it("discards unit selections when the source schema changes", () => {
    const config = {
      chart_type: "line" as const,
      y_columns: ["Speed"],
      filters: [],
      display_units: { Speed: "km/h" },
    };
    const onRun = vi.fn();
    const { rerender } = render(
      <ChartBuilder columns={columns} config={config} onRun={onRun} />,
    );
    expect(screen.getByLabelText("Speed display unit")).toHaveValue("km/h");
    rerender(
      <ChartBuilder
        columns={[columns[0], { ...columns[1], unit: "kPa" }]}
        config={config}
        onRun={onRun}
      />,
    );
    expect(screen.getByLabelText("Speed display unit")).toHaveValue("kPa");
    rerender(<ChartBuilder columns={columns} config={config} onRun={onRun} />);
    expect(screen.getByLabelText("Speed display unit")).toHaveValue("mph");
  });
});
