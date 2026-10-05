import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Database, Download, FileSpreadsheet, Search } from "lucide-react";
import { UploadPanel } from "../components/UploadPanel";
import { useDatasets } from "../hooks/useDatasets";
import { datasetDownloadUrl } from "../api/datasets";
import { Alert, Badge, FieldInput, Panel, Tooltip } from "../components/ui";

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(size) / Math.log(1024)),
    units.length - 1,
  );
  return `${(size / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function DatasetListPage() {
  const { datasets, loading, error, refresh } = useDatasets();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filteredDatasets = datasets.filter((dataset) => {
    const text = [
      dataset.title,
      dataset.filename,
      dataset.metadata.driver,
      dataset.metadata.aero_configuration,
      dataset.metadata.testing_notes,
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  });

  return (
    <main className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
      <UploadPanel
        onUploaded={(slug) => {
          refresh();
          navigate(`/datasets/${slug}`);
        }}
      />
      <Panel className="grid content-start gap-4 overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-soft text-button">
              <Database size={17} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">Datasets</h2>
              <p className="text-sm text-muted">CSV telemetry catalog</p>
            </div>
          </div>
          <Badge tone="default">{datasets.length} available</Badge>
        </div>
        <div className="grid gap-3 px-4 pb-4">
          <div className="relative">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <FieldInput
              type="search"
              aria-label="Search datasets"
              placeholder="Search names, files, drivers, notes..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full pl-9"
            />
          </div>
          {!loading && !error && datasets.length > 0 && terms.length > 0 && (
            <p role="status" className="text-xs text-muted">
              {filteredDatasets.length} of {datasets.length} datasets
            </p>
          )}
          {loading && <p className="text-sm text-muted">Loading datasets...</p>}
          {error && <Alert tone="danger">{error}</Alert>}
          {!loading && !error && datasets.length === 0 && (
            <p className="text-sm text-muted">No datasets uploaded yet.</p>
          )}
          {!loading &&
            !error &&
            datasets.length > 0 &&
            filteredDatasets.length === 0 && (
              <p className="text-sm text-muted">
                No datasets match your search.
              </p>
            )}
          <ul className="grid gap-2">
            {filteredDatasets.map((dataset) => (
              <li key={dataset.slug}>
                <article className="group grid gap-2 rounded-lg border border-border bg-surface px-3 py-3 text-sm shadow-sm transition hover:-translate-y-0.5 hover:border-button hover:shadow-md">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <FileSpreadsheet
                        size={16}
                        aria-hidden="true"
                        className="shrink-0 text-button"
                      />
                      <Link
                        to={`/datasets/${dataset.slug}`}
                        className="truncate font-semibold text-text transition hover:text-button focus:outline-none focus:ring-2 focus:ring-ring/40"
                      >
                        {dataset.title}
                      </Link>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone="default">
                        {formatBytes(dataset.size_bytes)}
                      </Badge>
                      <Tooltip label={`Download ${dataset.title}`}>
                        <a
                          href={datasetDownloadUrl(dataset.slug)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-muted transition hover:bg-surface-soft hover:text-text focus:outline-none focus:ring-2 focus:ring-ring/40"
                          aria-label={`Download ${dataset.title}`}
                        >
                          <Download size={15} aria-hidden="true" />
                        </a>
                      </Tooltip>
                    </span>
                  </div>
                  <span className="truncate text-xs text-muted">
                    {dataset.filename}
                  </span>
                </article>
              </li>
            ))}
          </ul>
        </div>
      </Panel>
    </main>
  );
}
