import { apiFetch, errorMessageFromResponse } from "./client";
import type { ChartRequest, FilterRule } from "../types/chart";
import type { Dataset, SchemaColumn } from "../types/dataset";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export function listDatasets() {
  return apiFetch<Dataset[]>("/api/datasets");
}

export function getSchema(slug: string) {
  return apiFetch<{ columns: SchemaColumn[]; row_count: number }>(`/api/datasets/${slug}/schema`);
}

export function getChartData(slug: string, payload: ChartRequest) {
  return apiFetch<{ data: unknown[]; row_count: number }>(`/api/datasets/${slug}/chart-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function uploadDataset(file: File, password: string) {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<{ slug: string; title: string; filename: string }>("/api/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${password}` },
    body: form,
  });
}

export function datasetDownloadUrl(slug: string) {
  return `${API_BASE}/api/datasets/${encodeURIComponent(slug)}/download`;
}

export async function exportDataset(slug: string, filters: FilterRule[], columns: string[]) {
  const response = await fetch(datasetDownloadUrl(slug), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filters, columns }),
  });
  if (!response.ok) {
    throw new Error(errorMessageFromResponse(await response.text()));
  }
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("Content-Disposition")) ?? `${slug}-filtered-parsed.csv`,
  };
}

function filenameFromDisposition(disposition: string | null) {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1];
}
