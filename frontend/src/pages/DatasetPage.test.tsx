import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportDataset, getDataset, updateDatasetMetadata } from "../api/datasets";
import { useDatasetSchema } from "../hooks/useDatasetSchema";
import { DatasetPage } from "./DatasetPage";
import { render } from "../test/render";

vi.mock("../api/datasets", () => ({
  datasetDownloadUrl: (slug: string) => `/api/datasets/${slug}/download`,
  exportDataset: vi.fn(),
  getDataset: vi.fn(),
  getChartData: vi.fn(),
  updateDatasetMetadata: vi.fn(),
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
    vi.mocked(getDataset).mockResolvedValue({
      slug: "sample",
      title: "Sample",
      filename: "sample.csv",
      uploaded_at: "2026-07-08T12:00:00Z",
      size_bytes: 123,
      metadata: {
        driver: "Ada",
        ride_height: 12.3,
        aero_configuration: "Sprint",
        testing_notes: "Baseline run",
      },
    });
    vi.mocked(updateDatasetMetadata).mockImplementation(async (_slug, metadata) => ({
      slug: "sample",
      title: "Sample",
      filename: "sample.csv",
      uploaded_at: "2026-07-08T12:00:00Z",
      size_bytes: 123,
      metadata,
    }));
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

  it("renders dataset metadata fields from the dataset record", async () => {
    render(
      <MemoryRouter initialEntries={["/datasets/sample"]}>
        <Routes>
          <Route path="/datasets/:slug" element={<DatasetPage theme="light" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByDisplayValue("Ada")).toBeInTheDocument();
    expect(screen.getByDisplayValue("12.30")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Sprint")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Baseline run")).toBeInTheDocument();
  });

  it("does not autosave metadata without the upload password", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/datasets/sample"]}>
        <Routes>
          <Route path="/datasets/:slug" element={<DatasetPage theme="light" />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.clear(await screen.findByLabelText("Driver"));
    await user.type(screen.getByLabelText("Driver"), "Bea");

    await new Promise((resolve) => window.setTimeout(resolve, 700));
    expect(updateDatasetMetadata).not.toHaveBeenCalled();
  });

  it("autosaves metadata edits with the upload password", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/datasets/sample"]}>
        <Routes>
          <Route path="/datasets/:slug" element={<DatasetPage theme="light" />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(await screen.findByLabelText("Metadata upload password"), "changeme");
    await user.clear(screen.getByLabelText("Driver"));
    await user.type(screen.getByLabelText("Driver"), "Bea");
    await user.clear(screen.getByLabelText("Ride Height"));
    await user.type(screen.getByLabelText("Ride Height"), "14.236");

    await waitFor(
      () =>
        expect(updateDatasetMetadata).toHaveBeenCalledWith(
          "sample",
          {
            driver: "Bea",
            ride_height: 14.24,
            aero_configuration: "Sprint",
            testing_notes: "Baseline run",
          },
          "changeme",
        ),
      { timeout: 1500 },
    );
  });
});
