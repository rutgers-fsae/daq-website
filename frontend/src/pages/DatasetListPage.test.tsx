import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDatasets } from "../hooks/useDatasets";
import { DatasetListPage } from "./DatasetListPage";
import { render } from "../test/render";

vi.mock("../hooks/useDatasets", () => ({
  useDatasets: vi.fn(),
}));

describe("DatasetListPage", () => {
  beforeEach(() => {
    vi.mocked(useDatasets).mockReturnValue({
      datasets: [
        {
          slug: "test-run",
          title: "Test Run",
          filename: "test-run.csv",
          uploaded_at: "2026-01-01T00:00:00Z",
          size_bytes: 1024,
          metadata: {
            driver: "Neel",
            ride_height: null,
            aero_configuration: "Sprint",
            testing_notes: "Dry track",
          },
        },
        {
          slug: "autumn-session",
          title: "Autumn Session",
          filename: "oct_04.csv",
          uploaded_at: "2026-10-04T00:00:00Z",
          size_bytes: 2048,
          metadata: {
            driver: "Ada",
            ride_height: null,
            aero_configuration: "Endurance",
            testing_notes: "Baseline",
          },
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
  });

  it("renders separate open and download controls for each dataset", () => {
    render(
      <MemoryRouter>
        <DatasetListPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Test Run" })).toHaveAttribute(
      "href",
      "/datasets/test-run",
    );
    expect(
      screen.getByRole("link", { name: "Download Test Run" }),
    ).toHaveAttribute("href", "/api/datasets/test-run/download");
  });
  it.each([
    "test run",
    " TEST-RUN.CSV ",
    "NeEl",
    "sprint",
    "DRY TRACK",
    "neel track",
  ])("filters datasets by %j", async (query) => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DatasetListPage />
      </MemoryRouter>,
    );
    await user.type(
      screen.getByRole("searchbox", { name: "Search datasets" }),
      query,
    );
    expect(screen.getByRole("link", { name: "Test Run" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Autumn Session" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2 datasets");
  });

  it("shows no matches and restores the catalog when search is cleared", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DatasetListPage />
      </MemoryRouter>,
    );
    const search = screen.getByRole("searchbox", { name: "Search datasets" });
    await user.type(search, "does not exist");
    expect(
      screen.getByText("No datasets match your search."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 of 2 datasets");
    expect(
      screen.queryByText("No datasets uploaded yet."),
    ).not.toBeInTheDocument();
    await user.clear(search);
    expect(screen.getByRole("link", { name: "Test Run" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Autumn Session" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the empty catalog message when nothing has been uploaded", () => {
    const current = vi.mocked(useDatasets).getMockImplementation()!();
    vi.mocked(useDatasets).mockReturnValue({ ...current, datasets: [] });
    render(
      <MemoryRouter>
        <DatasetListPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("No datasets uploaded yet.")).toBeInTheDocument();
    expect(
      screen.queryByText("No datasets match your search."),
    ).not.toBeInTheDocument();
  });
});
