import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PlotView } from "./PlotView";

const plotState = vi.hoisted(() => ({
  lastProps: null as null | {
    data: Array<Record<string, unknown>>;
    layout: Record<string, unknown>;
    onError?: (error: Error) => void;
    onRelayout?: (event: Record<string, unknown>) => void;
  },
}));

vi.mock("react-plotly.js/factory", () => ({
  default: vi.fn(() => (props: NonNullable<typeof plotState.lastProps>) => {
    plotState.lastProps = props;
    return <div data-testid="plot" />;
  }),
}));

vi.mock("plotly.js-cartesian-dist-min", () => ({
  default: {},
}));

const baseTrace = {
  name: "Speed",
  x: [0, 1],
  y: [10, 20],
  type: "scatter",
  mode: "lines",
};

describe("PlotView", () => {
  beforeEach(() => {
    plotState.lastProps = null;
  });

  it("omits the secondary y axis for single-axis charts", async () => {
    render(
      <PlotView
        data={[baseTrace]}
        theme="light"
        axisTitles={{
          xTitle: "Time (s)",
          yTitle: "Speed (mph)",
          traceLabels: { Speed: "Speed (mph)" },
          traceAxisByColumn: { Speed: "y" },
        }}
      />,
    );

    await screen.findByTestId("plot");

    expect(plotState.lastProps?.layout).not.toHaveProperty("yaxis2");
    expect(plotState.lastProps?.layout).toMatchObject({
      hovermode: "x unified",
      hoverdistance: -1,
      hoverlabel: { namelength: -1 },
    });
    expect(plotState.lastProps?.data[0]).toMatchObject({
      name: "Speed (mph)",
      yaxis: "y",
    });
  });

  it("includes the secondary y axis only for dual-axis charts", async () => {
    render(
      <PlotView
        data={[baseTrace, { ...baseTrace, name: "Voltage", y: [300, 310] }]}
        theme="light"
        axisTitles={{
          xTitle: "Time (s)",
          yTitle: "Speed (mph)",
          y2Title: "Values (V)",
          traceLabels: { Speed: "Speed (mph)", Voltage: "Voltage (V)" },
          traceAxisByColumn: { Speed: "y", Voltage: "y2" },
        }}
      />,
    );

    await screen.findByTestId("plot");

    expect(plotState.lastProps?.layout).toHaveProperty("yaxis2");
    expect(plotState.lastProps?.layout).toMatchObject({
      hovermode: "x unified",
      hoverdistance: -1,
      hoverlabel: { namelength: -1 },
    });
    expect(plotState.lastProps?.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Speed (mph)", yaxis: "y" }),
        expect.objectContaining({ name: "Voltage (V)", yaxis: "y2" }),
      ]),
    );
  });

  it("uses a visible second trace color in dark mode", async () => {
    render(
      <PlotView
        data={[baseTrace, { ...baseTrace, name: "Voltage", y: [300, 310] }]}
        theme="dark"
        axisTitles={null}
      />,
    );

    await screen.findByTestId("plot");

    const colorway = plotState.lastProps?.layout.colorway;
    expect(colorway).toEqual(expect.any(Array));
    expect((colorway as string[])[1]).not.toBe("#111111");
  });

  it("updates the statistics overlay when the viewport changes", async () => {
    render(
      <PlotView
        data={[{ ...baseTrace, x: [0, 1, 2], y: [10, 20, 30] }]}
        theme="light"
        axisTitles={null}
      />,
    );

    await screen.findByTestId("plot");
    expect(
      screen.getByRole("table", { name: "Visible range statistics" }),
    ).toHaveTextContent("20");

    act(() => {
      plotState.lastProps?.onRelayout?.({
        "xaxis.range[0]": 1,
        "xaxis.range[1]": 2,
        "yaxis.range[0]": 25,
        "yaxis.range[1]": 35,
      });
    });

    await waitFor(() => {
      expect(
        screen.getByRole("table", { name: "Visible range statistics" }),
      ).toHaveTextContent("30");
    });
    expect(
      screen.getByRole("table", { name: "Visible range statistics" }),
    ).not.toHaveTextContent("20");

    act(() => {
      plotState.lastProps?.onRelayout?.({
        "xaxis.autorange": true,
        "yaxis.autorange": true,
      });
    });

    await waitFor(() => {
      expect(
        screen.getByRole("table", { name: "Visible range statistics" }),
      ).toHaveTextContent("20");
    });
  });

  it("does not show viewport statistics for unsupported chart types", async () => {
    render(
      <PlotView
        data={[{ name: "Speed", x: [0, 1], y: [10, 20], type: "bar" }]}
        theme="light"
        axisTitles={null}
      />,
    );

    await screen.findByTestId("plot");
    expect(
      screen.queryByRole("table", { name: "Visible range statistics" }),
    ).not.toBeInTheDocument();
  });

  it("shows Plotly render errors instead of a blank plot", async () => {
    render(<PlotView data={[baseTrace]} theme="light" axisTitles={null} />);

    await screen.findByTestId("plot");
    act(() => {
      plotState.lastProps?.onError?.(
        new Error("Cannot read properties of undefined"),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          /Chart render failed: Cannot read properties of undefined/i,
        ),
      ).toBeInTheDocument();
    });
  });
  it("toggles between shared and nearest-point hover without changing data", async () => {
    const user = userEvent.setup();
    render(<PlotView data={[baseTrace]} theme="light" axisTitles={null} />);
    await screen.findByTestId("plot");
    const toggle = screen.getByRole("button", { name: "Shared hover" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    const data = plotState.lastProps?.data;
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(plotState.lastProps?.layout).toMatchObject({
      hovermode: "closest",
      hoverdistance: 20,
    });
    expect(plotState.lastProps?.data).toBe(data);
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(plotState.lastProps?.layout).toMatchObject({
      hovermode: "x unified",
      hoverdistance: -1,
    });
  });
});
