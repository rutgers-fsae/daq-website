import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDatasets } from "../hooks/useDatasets";
import { DatasetListPage } from "./DatasetListPage";

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
            driver: "",
            ride_height: null,
            aero_configuration: "",
            testing_notes: "",
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

    expect(screen.getByRole("link", { name: "Test Run" })).toHaveAttribute("href", "/datasets/test-run");
    expect(screen.getByRole("link", { name: "Download Test Run" })).toHaveAttribute("href", "/api/datasets/test-run/download");
  });
});
