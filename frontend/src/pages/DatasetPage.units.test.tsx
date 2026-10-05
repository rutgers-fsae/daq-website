import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getChartData, getDataset } from "../api/datasets";
import { useDatasetSchema } from "../hooks/useDatasetSchema";
import { render } from "../test/render";
import { DatasetPage } from "./DatasetPage";

const plot = vi.hoisted(() => ({
  data: [] as Array<Record<string, unknown>>,
  layout: {} as Record<string, unknown>,
}));
vi.mock("react-plotly.js/factory", () => ({
  default: () => (props: typeof plot) => {
    plot.data = props.data;
    plot.layout = props.layout;
    return <div data-testid="plot" />;
  },
}));
vi.mock("plotly.js-cartesian-dist-min", () => ({ default: {} }));
vi.mock("../api/datasets", () => ({
  getChartData: vi.fn(),
  getDataset: vi.fn(),
  updateDatasetMetadata: vi.fn(),
  exportDataset: vi.fn(),
  datasetDownloadUrl: () => "/download",
}));
vi.mock("../hooks/useDatasetSchema", () => ({ useDatasetSchema: vi.fn() }));

function page() {
  return render(
    <MemoryRouter initialEntries={["/datasets/sample"]}>
      <Routes>
        <Route path="/datasets/:slug" element={<DatasetPage theme="light" />} />
      </Routes>
    </MemoryRouter>,
  );
}
let storage: Map<string, string>;
function saveGraph(display_units?: Record<string, string>) {
  storage.set(
    "daq-graphs-sample",
    JSON.stringify([
      {
        id: 1,
        name: "Graph 1",
        chartConfig: {
          chart_type: "line",
          x_column: "Time",
          y_columns: ["Temp", "pressure_pa"],
          filters: [],
          display_units,
        },
      },
    ]),
  );
}

describe("dataset chart display units", () => {
  beforeEach(() => {
    storage = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    plot.data = [];
    vi.mocked(useDatasetSchema).mockReturnValue({
      loading: false,
      error: null,
      columns: [
        {
          name: "Time",
          unit: "s",
          type: "numeric",
          sample_values: [],
          display_name: "Time (s)",
        },
        {
          name: "Temp",
          unit: "C",
          type: "numeric",
          sample_values: [],
          display_name: "Temp (C)",
        },
        {
          name: "pressure_pa",
          unit: "kPa",
          type: "numeric",
          sample_values: [],
          display_name: "pressure_pa (kPa)",
        },
      ],
    });
    vi.mocked(getDataset).mockResolvedValue({
      slug: "sample",
      title: "Sample",
      filename: "sample.csv",
      uploaded_at: "2026-10-04",
      size_bytes: 100,
      metadata: {
        driver: "",
        ride_height: null,
        aero_configuration: "",
        testing_notes: "",
      },
    });
    vi.mocked(getChartData).mockResolvedValue({
      data: [
        {
          name: "Temp",
          type: "scatter",
          mode: "lines",
          x: [0, 60],
          y: [0, 100],
        },
        {
          name: "pressure_pa",
          type: "scatter",
          mode: "lines",
          x: [0, 60],
          y: [100, null],
        },
      ],
      row_count: 2,
    });
  });

  it("renders converted values, labels, axes and statistics, then restores without double conversion", async () => {
    saveGraph({ Time: "min", Temp: "°F", pressure_pa: "psi" });
    const user = userEvent.setup();
    const first = page();
    await user.click(screen.getByRole("button", { name: "Render" }));
    await screen.findByTestId("plot");
    await waitFor(() =>
      expect(plot.data[0]).toMatchObject({
        name: "Temp (°F)",
        x: [0, 1],
        y: [expect.closeTo(32), expect.closeTo(212)],
        yaxis: "y",
      }),
    );
    expect(plot.data[1].name).toBe("pressure_pa (psi)");
    expect(plot.data[1].yaxis).toBe("y2");
    expect((plot.data[1].y as number[])[0]).toBeCloseTo(14.503773773, 8);
    expect(plot.layout.xaxis).toMatchObject({ title: { text: "Time (min)" } });
    expect(plot.layout.yaxis2).toMatchObject({
      title: { text: "Values (psi)" },
    });
    expect(
      screen.getByRole("table", { name: "Visible range statistics" }),
    ).toHaveTextContent("122");
    expect(getChartData).toHaveBeenLastCalledWith("sample", {
      chart_type: "line",
      x_column: "Time",
      y_columns: ["Temp", "pressure_pa"],
      filters: [],
    });
    await user.selectOptions(screen.getByLabelText("Temp display unit"), "K");
    expect(plot.data[0].name).toBe("Temp (°F)");
    await user.click(screen.getByRole("button", { name: "Render" }));
    await waitFor(() =>
      expect(plot.data[0]).toMatchObject({
        name: "Temp (K)",
        y: [273.15, 373.15],
      }),
    );
    first.unmount();
    page();
    expect(screen.getByLabelText("Temp display unit")).toHaveValue("K");
    await user.click(screen.getByRole("button", { name: "Render" }));
    await waitFor(() =>
      expect(plot.data[0]).toMatchObject({
        name: "Temp (K)",
        y: [273.15, 373.15],
      }),
    );
  });

  it.each([undefined, { Temp: "mph", Missing: "psi", Time: "bogus" }])(
    "restores legacy or invalid selections using source units (%j)",
    async (saved) => {
      saveGraph(saved);
      page();
      expect(screen.getByLabelText("Temp display unit")).toHaveValue("°C");
      const persisted = JSON.parse(storage.get("daq-graphs-sample")!);
      expect(persisted[0].chartConfig.display_units).toEqual({});
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Render" }));
      await waitFor(() =>
        expect(plot.data[0]).toMatchObject({
          name: "Temp (C)",
          x: [0, 60],
          y: [0, 100],
        }),
      );
    },
  );
});
