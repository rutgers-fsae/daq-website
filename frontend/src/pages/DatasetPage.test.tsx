import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportDataset } from "../api/datasets";
import { useDatasetSchema } from "../hooks/useDatasetSchema";
import { DatasetPage } from "./DatasetPage";

vi.mock("../api/datasets", () => ({
  datasetDownloadUrl: (slug: string) => `/api/datasets/${slug}/download`,
  exportDataset: vi.fn(),
  getChartData: vi.fn(),
}));

vi.mock("../hooks/useDatasetSchema", () => ({
  useDatasetSchema: vi.fn(),
}));

vi.mock("../components/ChartBuilder", () => ({
  ChartBuilder: () => <div data-testid="chart-builder" />,
}));

vi.mock("../components/PlotView", () => ({
  PlotView: () => <div data-testid="plot-view" />,
}));

describe("DatasetPage", () => {
  beforeEach(() => {
    vi.mocked(useDatasetSchema).mockReturnValue({
      columns: [
        { name: "Time", type: "numeric", unit: "s", display_name: "Time (s)", sample_values: ["0", "1"] },
        { name: "Driver", type: "categorical", display_name: "Driver", sample_values: ["Ada"] },
      ],
      loading: false,
      error: null,
    });
    vi.mocked(exportDataset).mockResolvedValue({
      blob: new Blob(["Time,Driver\n0,Ada\n"], { type: "text/csv" }),
      filename: "sample-filtered-parsed.csv",
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:export") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
      },
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  it("opens export modal and sends export-only filters with selected columns", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/datasets/sample"]}>
        <Routes>
          <Route path="/datasets/:slug" element={<DatasetPage theme="light" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("dialog", { name: "CSV Export" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Download CSV" }));

    expect(screen.getByRole("dialog", { name: "CSV Export" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Time (s)" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Driver" })).toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "Time (s)" }));
    await user.selectOptions(screen.getByLabelText("Export filter column"), "Driver");
    await user.type(screen.getByLabelText("Export filter value"), "Ada");
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(exportDataset).toHaveBeenCalledWith("sample", [{ column: "Driver", op: "eq", value: "Ada" }], ["Driver"]);
  });

  it("closes the export modal with Escape", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/datasets/sample"]}>
        <Routes>
          <Route path="/datasets/:slug" element={<DatasetPage theme="light" />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(screen.getByRole("dialog", { name: "CSV Export" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "CSV Export" })).not.toBeInTheDocument();
  });
});
