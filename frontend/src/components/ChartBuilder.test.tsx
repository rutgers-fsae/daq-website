import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChartBuilder } from "./ChartBuilder";
import { expressionRefs } from "../lib/expressions";
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

  it("builds custom series from earlier ones and guards dependencies", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const a = { name: "A", expression: "Speed * 2" };
    render(
      <ChartBuilder
        columns={columns}
        config={{
          chart_type: "line",
          y_columns: ["A"],
          filters: [],
          computed_columns: [a],
        }}
        onRun={onRun}
      />,
    );

    await user.type(screen.getByLabelText("Custom series name"), "B");
    await user.type(screen.getByLabelText("Custom series expression"), "A");
    await user.click(
      within(
        screen.getByRole("listbox", { name: "Matching channels" }),
      ).getByRole("option", { name: /^A/ }),
    );
    await user.type(screen.getByLabelText("Custom series expression"), " + 1");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("button", { name: "Remove A" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "A = Speed * 2" }));
    await user.type(screen.getByLabelText("Custom series expression"), " + B");
    expect(screen.getByRole("alert")).toHaveTextContent(
      '"B" is defined below this series',
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Render" }));
    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({
        computed_columns: [a, { name: "B", expression: "A + 1" }],
      }),
      expect.anything(),
      {},
    );
  });

  it("autocompletes multi-word custom series among many channels", async () => {
    const user = userEvent.setup();
    const channels: SchemaColumn[] = Array.from({ length: 9 }, (_, i) => ({
      name: `Battery ${i + 1}`,
      type: "numeric",
      unit: "V",
      display_name: `Battery ${i + 1} (V)`,
      sample_values: ["1"],
    }));
    render(
      <ChartBuilder
        columns={channels}
        config={{
          chart_type: "line",
          y_columns: [],
          filters: [],
          computed_columns: [
            { name: "Battery Power", expression: "`Battery 1` * 2" },
          ],
        }}
        onRun={vi.fn()}
      />,
    );
    const expression = screen.getByLabelText("Custom series expression");

    // Nine matching channels must not crowd out the custom series.
    await user.type(screen.getByLabelText("Custom series name"), "Net");
    await user.type(expression, "`Batt");
    expect(
      screen.getByRole("option", { name: "Battery Power" }),
    ).toBeInTheDocument();

    // The whole multi-word name is replaced, and Enter then adds the series.
    await user.clear(expression);
    await user.type(expression, "Battery P{Enter}");
    expect(expression).toHaveValue("`Battery Power`");
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("button", { name: "Net = `Battery Power`" }),
    ).toBeInTheDocument();
  });

  it("finds the columns an expression uses", () => {
    expect([...expressionRefs("`Pack Current` * V + abs(x) * 1e5")]).toEqual([
      "Pack Current",
      "V",
      "x",
    ]);
  });

  it("adds a custom series and sends it with the request", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(<ChartBuilder columns={columns} onRun={onRun} />);

    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    await user.type(screen.getByLabelText("Custom series name"), "Dist");
    await user.type(
      screen.getByLabelText("Custom series expression"),
      "Speed * Time",
    );
    await user.type(screen.getByLabelText("Custom series unit"), "mi");
    expect(screen.getByRole("status")).toHaveTextContent("Not added yet");
    await user.click(add);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Render" }));

    expect(onRun).toHaveBeenCalledWith(
      {
        chart_type: "line",
        y_columns: ["Dist"],
        filters: [],
        computed_columns: [
          { name: "Dist", expression: "Speed * Time", unit: "mi" },
        ],
      },
      expect.objectContaining({
        traceLabels: { Dist: "Dist (mi)" },
      }),
      {},
    );
  });

  it("adds a custom series with Enter", async () => {
    const user = userEvent.setup();
    render(<ChartBuilder columns={columns} onRun={vi.fn()} />);
    await user.type(screen.getByLabelText("Custom series name"), "Neg");
    await user.type(
      screen.getByLabelText("Custom series expression"),
      "-1 * 0.5 * 2{Enter}",
    );
    expect(screen.getByTitle("Edit custom series")).toHaveTextContent(
      "Neg = -1 * 0.5 * 2",
    );
  });

  it("autocompletes channel names and edits a custom series", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(<ChartBuilder columns={columns} onRun={onRun} />);

    const expression = screen.getByLabelText("Custom series expression");
    await user.type(screen.getByLabelText("Custom series name"), "Dist");
    await user.type(expression, "2 * Spe");
    await user.click(screen.getByRole("option", { name: /Speed/ }));
    expect(expression).toHaveValue("2 * Speed");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await user.click(screen.getByTitle("Edit custom series"));
    expect(expression).toHaveValue("2 * Speed");
    await user.clear(screen.getByLabelText("Custom series name"));
    await user.type(screen.getByLabelText("Custom series name"), "Twice");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Render" }));

    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({
        y_columns: ["Twice"],
        computed_columns: [{ name: "Twice", expression: "2 * Speed" }],
      }),
      expect.anything(),
      {},
    );
  });

  it("turns on separate axes when more than two units are selected", async () => {
    const user = userEvent.setup();
    const cols: SchemaColumn[] = ["s", "mph", "psi"].map((unit, i) => ({
      name: `C${i}`,
      type: "numeric",
      unit,
      display_name: `C${i} (${unit})`,
      sample_values: ["1"],
    }));
    render(<ChartBuilder columns={cols} onRun={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /select y series/i }));
    for (const col of cols.slice(0, 2))
      await user.click(
        screen.getByRole("checkbox", { name: col.display_name }),
      );
    const toggle = screen.getByLabelText(/Separate Y-axis per series/);
    expect(toggle).not.toBeChecked();
    await user.click(
      screen.getByRole("checkbox", { name: cols[2].display_name }),
    );
    expect(toggle).toBeChecked();
  });

  it("reorders separate-axis panels", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    const cols: SchemaColumn[] = ["s", "mph", "psi"].map((unit, i) => ({
      name: `C${i}`,
      type: "numeric",
      unit,
      display_name: `C${i} (${unit})`,
      sample_values: ["1"],
    }));
    render(<ChartBuilder columns={cols} onRun={onRun} />);

    await user.click(screen.getByRole("button", { name: /select y series/i }));
    for (const col of cols)
      await user.click(
        screen.getByRole("checkbox", { name: col.display_name }),
      );
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Move C2 (psi) up" }));
    expect(
      screen.getByRole("button", { name: "Move C0 (s) up" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Render" }));

    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({ y_columns: ["C0", "C2", "C1"] }),
      expect.objectContaining({ separateAxes: true }),
      {},
    );
  });

  it("collapses without losing the selection", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(<ChartBuilder columns={columns} onRun={onRun} />);

    await user.click(screen.getByRole("button", { name: /select y series/i }));
    await user.click(screen.getByRole("checkbox", { name: "Speed (mph)" }));
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "Collapse chart builder" }),
    );
    expect(
      screen.queryByRole("button", { name: "Render" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("line · 1 series selected")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Expand chart builder" }),
    );
    await user.click(screen.getByRole("button", { name: "Render" }));
    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({ y_columns: ["Speed"] }),
      expect.anything(),
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
    expect(screen.queryByText(/Using dual Y-axes/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("OtherSpeed display unit")).toHaveValue("m/s");
  });

  it("auto-enables separate axes, keeps the limit when off, and omits unknown and datetime conversion controls", async () => {
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
    const toggle = screen.getByLabelText(/Separate Y-axis per series/);
    expect(toggle).toBeChecked();
    expect(screen.getByRole("button", { name: "Render" })).toBeEnabled();
    await user.click(toggle);
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
