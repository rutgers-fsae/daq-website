import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragStartEvent,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeft, Columns2, Download, Filter, GripVertical, LockKeyhole, Plus, Rows2, Trash2, X } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { ChartBuilder } from "../components/ChartBuilder";
import { PlotView } from "../components/PlotView";
import { exportDataset, getChartData, getDataset, updateDatasetMetadata } from "../api/datasets";
import { useDatasetSchema } from "../hooks/useDatasetSchema";
import type { ChartConfig, ChartRequest, FilterRule, PlotTrace } from "../types/chart";
import type { Dataset, DatasetMetadata } from "../types/dataset";
import { Alert, Badge, Button, FieldInput, FieldSelect, FieldTextarea, Label, Panel, Tooltip } from "../components/ui";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { cxClasses } from "../components/ui-utils";

type Props = {
  theme: "light" | "dark";
};

type GraphState = {
  id: number;
  name: string;
  chartConfig: ChartConfig;
  plotData: PlotTrace[];
  axisTitles: {
    xTitle: string;
    yTitle: string;
    y2Title?: string;
    traceLabels: Record<string, string>;
    traceAxisByColumn: Record<string, "y" | "y2">;
  } | null;
  chartError: string | null;
  isLoading: boolean;
};

type PersistedGraphState = Pick<GraphState, "id" | "name" | "chartConfig" | "axisTitles">;

type ExportFilterDraft = {
  id: number;
  column: string;
  op: FilterRule["op"];
  value: string;
};

type MetadataDraft = {
  driver: string;
  ride_height: string;
  aero_configuration: string;
  testing_notes: string;
};

type SaveState = "idle" | "saving" | "saved" | "error";

function emptyMetadata(): DatasetMetadata {
  return {
    driver: "",
    ride_height: null,
    aero_configuration: "",
    testing_notes: "",
  };
}

function draftFromMetadata(metadata: DatasetMetadata | undefined): MetadataDraft {
  const source = metadata ?? emptyMetadata();
  return {
    driver: source.driver,
    ride_height: source.ride_height === null ? "" : source.ride_height.toFixed(2),
    aero_configuration: source.aero_configuration,
    testing_notes: source.testing_notes,
  };
}

function metadataFromDraft(draft: MetadataDraft): DatasetMetadata | null {
  const rideHeight = draft.ride_height.trim();
  const numericRideHeight = rideHeight === "" ? null : Number(rideHeight);
  if (numericRideHeight !== null && !Number.isFinite(numericRideHeight)) {
    return null;
  }
  return {
    driver: draft.driver,
    ride_height: numericRideHeight === null ? null : Math.round(numericRideHeight * 100) / 100,
    aero_configuration: draft.aero_configuration,
    testing_notes: draft.testing_notes,
  };
}

function serializeMetadata(metadata: DatasetMetadata): string {
  return JSON.stringify(metadata);
}

function emptyGraph(id: number, name = `Graph ${id}`): GraphState {
  return {
    id,
    name,
    chartConfig: { chart_type: "line", y_columns: [], filters: [] },
    plotData: [],
    axisTitles: null,
    chartError: null,
    isLoading: false,
  };
}

function restoreGraph(item: Partial<GraphState>, fallbackId: number): GraphState {
  const id = typeof item.id === "number" ? item.id : fallbackId;
  return {
    ...emptyGraph(id),
    name: typeof item.name === "string" ? item.name : `Graph ${id}`,
    chartConfig: restoreChartConfig(item.chartConfig),
    axisTitles: item.axisTitles || null,
  };
}

function graphForStorage(graph: GraphState): PersistedGraphState {
  return {
    id: graph.id,
    name: graph.name,
    chartConfig: graph.chartConfig,
    axisTitles: graph.axisTitles,
  };
}

function restoreChartConfig(config: Partial<ChartConfig> | undefined): ChartConfig {
  const chartType = config?.chart_type;
  return {
    chart_type:
      chartType === "line" || chartType === "scatter" || chartType === "bar" || chartType === "histogram" || chartType === "box"
        ? chartType
        : "line",
    x_column: typeof config?.x_column === "string" ? config.x_column : undefined,
    y_columns: Array.isArray(config?.y_columns) ? config.y_columns.filter((item): item is string => typeof item === "string") : [],
    filters: Array.isArray(config?.filters)
      ? config.filters.filter(
          (item): item is ChartConfig["filters"][number] =>
            typeof item?.column === "string" &&
            (item.op === "eq" || item.op === "contains" || item.op === "gte" || item.op === "lte") &&
            (typeof item.value === "string" || typeof item.value === "number"),
        )
      : [],
  };
}

function chartConfigsEqual(left: ChartConfig, right: ChartConfig): boolean {
  return (
    left.chart_type === right.chart_type &&
    left.x_column === right.x_column &&
    left.y_columns.length === right.y_columns.length &&
    left.y_columns.every((column, index) => column === right.y_columns[index]) &&
    left.filters.length === right.filters.length &&
    left.filters.every(
      (filter, index) =>
        filter.column === right.filters[index]?.column &&
        filter.op === right.filters[index]?.op &&
        filter.value === right.filters[index]?.value,
    )
  );
}

function emptyExportFilter(id: number, column = ""): ExportFilterDraft {
  return { id, column, op: "eq", value: "" };
}

function exportValueForColumn(value: string, columnType: string | undefined, op: FilterRule["op"]) {
  if (columnType !== "numeric" || op === "contains") {
    return value;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : value;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type ExportModalProps = {
  slug: string;
  columns: Parameters<typeof ChartBuilder>[0]["columns"];
};

function ExportModal({ slug, columns }: ExportModalProps) {
  const [nextFilterId, setNextFilterId] = useState(2);
  const [filters, setFilters] = useState<ExportFilterDraft[]>(() => [emptyExportFilter(1, columns[0]?.name || "")]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(() => columns.map((column) => column.name));
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const available = new Set(columns.map((column) => column.name));
    setSelectedColumns((current) => current.filter((column) => available.has(column)));
    setFilters((current) =>
      current.map((filter) => ({
        ...filter,
        column: filter.column && available.has(filter.column) ? filter.column : columns[0]?.name || "",
      })),
    );
  }, [columns]);

  function addFilter() {
    setFilters((current) => [...current, emptyExportFilter(nextFilterId, columns[0]?.name || "")]);
    setNextFilterId((current) => current + 1);
  }

  function updateFilter(id: number, patch: Partial<ExportFilterDraft>) {
    setFilters((current) => current.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter)));
  }

  function removeFilter(id: number) {
    setFilters((current) => current.filter((filter) => filter.id !== id));
  }

  function toggleColumn(columnName: string) {
    setSelectedColumns((current) =>
      current.includes(columnName) ? current.filter((column) => column !== columnName) : [...current, columnName],
    );
  }

  function buildFilters(): FilterRule[] {
    return filters.flatMap((filter) => {
      const value = filter.value.trim();
      if (!filter.column || value === "") {
        return [];
      }
      const column = columns.find((item) => item.name === filter.column);
      return [{ column: filter.column, op: filter.op, value: exportValueForColumn(value, column?.type, filter.op) }];
    });
  }

  function buildColumns(): string[] {
    const selected = new Set(selectedColumns);
    return columns.map((column) => column.name).filter((column) => selected.has(column));
  }

  async function handleExport() {
    setIsExporting(true);
    setStatus(null);
    setError(null);
    try {
      const result = await exportDataset(slug, buildFilters(), buildColumns());
      downloadBlob(result.blob, result.filename);
      setStatus("CSV export started.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to export CSV");
    } finally {
      setIsExporting(false);
    }
  }

  const exportDisabled = isExporting || selectedColumns.length === 0 || columns.length === 0;

  return (
      <DialogContent className="max-w-4xl" aria-describedby="csv-export-description">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Filter size={16} aria-hidden="true" className="text-button" />
              <DialogTitle className="text-sm uppercase tracking-[0.16em] text-muted">CSV Export</DialogTitle>
            </div>
            <DialogDescription id="csv-export-description" className="mt-1">Select columns and filters for this download.</DialogDescription>
          </div>
          <Tooltip label="Close export modal">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Close export modal">
                <X size={16} aria-hidden="true" />
              </Button>
            </DialogClose>
          </Tooltip>
        </div>
        <div className="grid gap-4 overflow-y-auto p-4">
          <section className="grid gap-2 rounded-md border border-border bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-text">Columns</h4>
                <p className="text-xs text-muted">{selectedColumns.length} of {columns.length} selected</p>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" onClick={() => setSelectedColumns(columns.map((column) => column.name))} variant="outline" size="sm">
                  Select All
                </Button>
                <Button type="button" onClick={() => setSelectedColumns([])} variant="ghost" size="sm">
                  Clear
                </Button>
              </div>
            </div>
            <div className="grid max-h-52 gap-1 overflow-y-auto rounded-md border border-border bg-panel p-2 sm:grid-cols-2 lg:grid-cols-3">
              {columns.map((column) => (
                <label key={column.name} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text hover:bg-surface-soft">
                  <input
                    type="checkbox"
                    checked={selectedColumns.includes(column.name)}
                    onChange={() => toggleColumn(column.name)}
                    className="h-4 w-4 shrink-0 accent-button"
                  />
                  <span className="truncate">{column.display_name || column.name}</span>
                </label>
              ))}
            </div>
            {selectedColumns.length === 0 && (
              <Alert tone="warning" className="text-xs">
                Select at least one column to export.
              </Alert>
            )}
          </section>
          <section className="grid gap-2 rounded-md border border-border bg-surface p-3">
            <div>
              <h4 className="text-sm font-semibold text-text">Filters</h4>
              <p className="text-xs text-muted">Export filters are separate from graph filters.</p>
            </div>
            {filters.map((filter) => (
              <div key={filter.id} className="grid gap-2 rounded-md border border-border bg-panel p-2 md:grid-cols-[minmax(0,1.4fr)_minmax(120px,0.6fr)_minmax(0,1fr)_auto]">
                <Label className="grid gap-1">
                  Column
                  <FieldSelect
                    value={filter.column}
                    onChange={(event) => updateFilter(filter.id, { column: event.target.value })}
                    aria-label="Export filter column"
                  >
                    {columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.display_name || column.name}
                      </option>
                    ))}
                  </FieldSelect>
                </Label>
                <Label className="grid gap-1">
                  Operator
                  <FieldSelect
                    value={filter.op}
                    onChange={(event) => updateFilter(filter.id, { op: event.target.value as FilterRule["op"] })}
                    aria-label="Export filter operator"
                  >
                    <option value="eq">Equals</option>
                    <option value="contains">Contains</option>
                    <option value="gte">At least</option>
                    <option value="lte">At most</option>
                  </FieldSelect>
                </Label>
                <Label className="grid gap-1">
                  Value
                  <FieldInput
                    value={filter.value}
                    onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                    aria-label="Export filter value"
                    placeholder="Any value"
                  />
                </Label>
                <Tooltip label="Remove export filter">
                  <Button
                    type="button"
                    onClick={() => removeFilter(filter.id)}
                    disabled={filters.length === 1}
                    variant="ghost"
                    size="icon"
                    className="self-end"
                    aria-label="Remove export filter"
                  >
                    <X size={15} aria-hidden="true" />
                  </Button>
                </Tooltip>
              </div>
            ))}
            <Button type="button" onClick={addFilter} disabled={columns.length === 0} variant="outline" className="justify-self-start">
              <Plus size={15} aria-hidden="true" />
              Add Export Filter
            </Button>
            {status && <Alert tone="success">{status}</Alert>}
            {error && <Alert tone="danger">{error}</Alert>}
          </section>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
          <DialogClose asChild>
            <Button type="button" variant="ghost">Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={handleExport} disabled={exportDisabled} variant="primary">
            <Download size={15} aria-hidden="true" />
            {isExporting ? "Exporting..." : "Export CSV"}
          </Button>
        </div>
      </DialogContent>
  );
}

type SortableGraphCardProps = {
  graph: GraphState;
  index: number;
  totalGraphs: number;
  columns: Parameters<typeof ChartBuilder>[0]["columns"];
  theme: "light" | "dark";
  onRemove: (id: number) => void;
  onRename: (id: number, name: string) => void;
  onConfigChange: (id: number, config: ChartConfig) => void;
  onRun: (
    graphId: number,
    payload: ChartRequest,
    titles: {
      xTitle: string;
      yTitle: string;
      y2Title?: string;
      traceLabels: Record<string, string>;
      traceAxisByColumn: Record<string, "y" | "y2">;
    },
  ) => void;
};

function SortableGraphCard({
  graph,
  index,
  totalGraphs,
  columns,
  theme,
  onRemove,
  onRename,
  onConfigChange,
  onRun,
}: SortableGraphCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: graph.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const displayName = graph.name.trim() || `Graph ${index + 1}`;
  const handleConfigChange = useCallback((config: ChartConfig) => onConfigChange(graph.id, config), [graph.id, onConfigChange]);

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={cxClasses("grid gap-3 rounded-lg border border-border bg-panel p-3 shadow-sm shadow-black/5 transition", isDragging && "opacity-85 shadow-2xl")}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Tooltip label={`Reorder ${displayName}`}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 cursor-grab active:cursor-grabbing"
              aria-label={`Reorder ${displayName}`}
              {...attributes}
              {...listeners}
            >
              <GripVertical size={14} />
            </Button>
          </Tooltip>
          <FieldInput
            type="text"
            value={graph.name}
            onChange={(event) => onRename(graph.id, event.target.value)}
            className="min-w-0 flex-1 border-transparent bg-transparent px-1 font-semibold shadow-none hover:bg-input focus:border-input-border"
            aria-label={`Graph ${index + 1} name`}
            maxLength={60}
          />
          <Badge tone="default" className="hidden shrink-0 sm:inline-flex">{graph.plotData.length} traces</Badge>
        </div>
        <Tooltip label={`Remove ${displayName}`}>
          <Button
            type="button"
            onClick={() => onRemove(graph.id)}
            disabled={totalGraphs === 1}
            variant="ghost"
            size="icon"
            aria-label={`Remove ${displayName}`}
          >
            <Trash2 size={15} aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>
      <ChartBuilder
        columns={columns}
        config={graph.chartConfig}
        onConfigChange={handleConfigChange}
        onRun={(payload, titles) => onRun(graph.id, payload, titles)}
      />
      {graph.isLoading && <p className="text-sm text-muted">Rendering graph...</p>}
      {graph.chartError && (
        <Alert tone="danger">
          Chart load failed: {graph.chartError}
        </Alert>
      )}
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-inner">
        <PlotView data={graph.plotData} theme={theme} axisTitles={graph.axisTitles} />
      </div>
    </article>
  );
}

export function DatasetPage({ theme }: Props) {
  const { slug = "" } = useParams();
  const { columns, loading, error } = useDatasetSchema(slug);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [datasetLoading, setDatasetLoading] = useState(true);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft>(() => draftFromMetadata(emptyMetadata()));
  const [metadataPassword, setMetadataPassword] = useState("");
  const [lastSavedMetadata, setLastSavedMetadata] = useState(() => serializeMetadata(emptyMetadata()));
  const [metadataSaveState, setMetadataSaveState] = useState<SaveState>("idle");
  const [metadataSaveError, setMetadataSaveError] = useState<string | null>(null);
  const [nextGraphId, setNextGraphId] = useState(2);
  const [graphs, setGraphs] = useState<GraphState[]>(() => {
    const key = `daq-graphs-${slug}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<GraphState>[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((item, index) => restoreGraph(item, index + 1));
        }
      } catch {
        return [emptyGraph(1)];
      }
    }
    return [emptyGraph(1)];
  });
  const [activeGraphId, setActiveGraphId] = useState<number | null>(null);
  const [desktopLayout, setDesktopLayout] = useState<"one" | "two">(() => {
    const stored = localStorage.getItem("daq-graph-layout");
    return stored === "one" || stored === "two" ? stored : "two";
  });
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function addGraph() {
    setGraphs((prev) => [
      ...prev,
      emptyGraph(nextGraphId),
    ]);
    setNextGraphId((prev) => prev + 1);
  }

  function removeGraph(id: number) {
    setGraphs((prev) => (prev.length > 1 ? prev.filter((graph) => graph.id !== id) : prev));
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveGraphId(Number(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveGraphId(null);
    if (!over || active.id === over.id) {
      return;
    }
    setGraphs((prev) => {
      const oldIndex = prev.findIndex((graph) => graph.id === active.id);
      const newIndex = prev.findIndex((graph) => graph.id === over.id);
      if (oldIndex === -1 || newIndex === -1) {
        return prev;
      }
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function handleDragCancel() {
    setActiveGraphId(null);
  }

  function setLayout(mode: "one" | "two") {
    setDesktopLayout(mode);
    localStorage.setItem("daq-graph-layout", mode);
  }

  const activeGraph = useMemo(() => graphs.find((graph) => graph.id === activeGraphId) ?? null, [graphs, activeGraphId]);
  const metadataForSave = metadataFromDraft(metadataDraft);
  const metadataDirty = Boolean(metadataForSave && serializeMetadata(metadataForSave) !== lastSavedMetadata);

  function renameGraph(id: number, name: string) {
    setGraphs((prev) => prev.map((graph) => (graph.id === id ? { ...graph, name } : graph)));
  }

  const updateGraphConfig = useCallback((id: number, chartConfig: ChartConfig) => {
    setGraphs((prev) =>
      prev.map((graph) => {
        if (graph.id !== id || chartConfigsEqual(graph.chartConfig, chartConfig)) {
          return graph;
        }
        return { ...graph, chartConfig };
      }),
    );
  }, []);

  useEffect(() => {
    const maxGraphId = graphs.reduce((acc, graph) => Math.max(acc, graph.id), 1);
    setNextGraphId(maxGraphId + 1);
    localStorage.setItem(`daq-graphs-${slug}`, JSON.stringify(graphs.map(graphForStorage)));
  }, [graphs, slug]);

  useEffect(() => {
    let cancelled = false;
    setDatasetLoading(true);
    setDatasetError(null);
    setDataset(null);
    setMetadataSaveState("idle");
    setMetadataSaveError(null);

    getDataset(slug)
      .then((result) => {
        if (cancelled) return;
        const nextDraft = draftFromMetadata(result.metadata);
        setDataset(result);
        setMetadataDraft(nextDraft);
        setLastSavedMetadata(serializeMetadata(metadataFromDraft(nextDraft) ?? emptyMetadata()));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDatasetError(err instanceof Error ? err.message : "Failed to load dataset metadata");
      })
      .finally(() => {
        if (!cancelled) {
          setDatasetLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!dataset || datasetLoading || datasetError || !metadataPassword) {
      return;
    }

    const metadata = metadataFromDraft(metadataDraft);
    if (!metadata) {
      setMetadataSaveState("error");
      setMetadataSaveError("Ride height must be a valid number.");
      return;
    }

    const serialized = serializeMetadata(metadata);
    if (serialized === lastSavedMetadata) {
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setMetadataSaveState("saving");
      setMetadataSaveError(null);
      updateDatasetMetadata(slug, metadata, metadataPassword)
        .then((updated) => {
          if (cancelled) return;
          const nextDraft = draftFromMetadata(updated.metadata);
          setDataset(updated);
          setMetadataDraft(nextDraft);
          setLastSavedMetadata(serializeMetadata(metadataFromDraft(nextDraft) ?? emptyMetadata()));
          setMetadataSaveState("saved");
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setMetadataSaveState("error");
          setMetadataSaveError(err instanceof Error ? err.message : "Failed to save metadata");
        });
    }, 600);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [dataset, datasetError, datasetLoading, lastSavedMetadata, metadataDraft, metadataPassword, slug]);

  const graphGridClass = `grid grid-cols-1 gap-4 ${desktopLayout === "one" ? "lg:grid-cols-1" : "lg:grid-cols-2"}`;

  async function runChart(
    graphId: number,
    payload: ChartRequest,
    titles: {
      xTitle: string;
      yTitle: string;
      y2Title?: string;
      traceLabels: Record<string, string>;
      traceAxisByColumn: Record<string, "y" | "y2">;
    },
  ) {
    setGraphs((prev) =>
      prev.map((graph) =>
        graph.id === graphId ? { ...graph, chartError: null, isLoading: true } : graph,
      ),
    );
    try {
      const result = await getChartData(slug, payload);
      setGraphs((prev) =>
        prev.map((graph) =>
          graph.id === graphId
            ? {
                ...graph,
                plotData: result.data as PlotTrace[],
                axisTitles: titles,
                chartError: null,
                isLoading: false,
              }
            : graph,
        ),
      );
    } catch (err: unknown) {
      setGraphs((prev) =>
        prev.map((graph) =>
          graph.id === graphId
            ? {
                ...graph,
                chartError: err instanceof Error ? err.message : "Failed to load chart data",
                plotData: [],
                axisTitles: null,
                isLoading: false,
              }
            : graph,
        ),
      );
    }
  }

  function updateMetadataDraft(patch: Partial<MetadataDraft>) {
    setMetadataDraft((current) => ({ ...current, ...patch }));
  }

  function normalizeRideHeightDraft() {
    setMetadataDraft((current) => {
      const trimmed = current.ride_height.trim();
      if (trimmed === "") {
        return { ...current, ride_height: "" };
      }
      const value = Number(trimmed);
      if (!Number.isFinite(value)) {
        return current;
      }
      return { ...current, ride_height: value.toFixed(2) };
    });
  }

  const metadataStatus = (() => {
    if (!metadataForSave) return <Badge tone="danger">Invalid</Badge>;
    if (metadataDirty && !metadataPassword) return <Badge tone="warning">Password Required</Badge>;
    if (metadataSaveState === "saving") return <Badge tone="info">Saving</Badge>;
    if (metadataSaveState === "saved") return <Badge tone="success">Saved</Badge>;
    if (metadataSaveState === "error") return <Badge tone="danger">Error</Badge>;
    return <Badge tone="default">Idle</Badge>;
  })();

  return (
    <main className="grid gap-4">
      <Panel className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <Link to="/" className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-text">
            <ArrowLeft size={15} aria-hidden="true" />
            Back to datasets
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold">Dataset: {slug}</h2>
            {!loading && !error && <Badge tone="info">{columns.length} channels</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={isExportModalOpen} onOpenChange={setIsExportModalOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="secondary">
                <Download size={15} aria-hidden="true" />
                Download CSV
              </Button>
            </DialogTrigger>
            {isExportModalOpen && !loading && !error && (
              <ExportModal slug={slug} columns={columns} />
            )}
          </Dialog>
          <Button
            type="button"
            onClick={addGraph}
            variant="primary"
          >
            <Plus size={15} aria-hidden="true" />
            Add New Graph
          </Button>
          <div className="hidden items-center gap-1 rounded-lg border border-input-border bg-input p-1 shadow-sm lg:flex">
            <Button
              type="button"
              onClick={() => setLayout("one")}
              variant={desktopLayout === "one" ? "primary" : "ghost"}
              size="sm"
            >
              <Rows2 size={14} aria-hidden="true" />
              1 Column
            </Button>
            <Button
              type="button"
              onClick={() => setLayout("two")}
              variant={desktopLayout === "two" ? "primary" : "ghost"}
              size="sm"
            >
              <Columns2 size={14} aria-hidden="true" />
              2 Columns
            </Button>
          </div>
        </div>
      </Panel>
      <Panel className="grid gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Testing Metadata</h3>
            <p className="text-sm text-muted">{dataset?.title ?? slug}</p>
          </div>
          {metadataStatus}
        </div>
        {datasetError && <Alert tone="danger">Metadata load failed: {datasetError}</Alert>}
        <div className="grid gap-3 md:grid-cols-3">
          <Label className="grid gap-1.5">
            Upload Password
            <span className="relative">
              <LockKeyhole size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
              <FieldInput
                type="password"
                value={metadataPassword}
                onChange={(event) => setMetadataPassword(event.target.value)}
                className="pl-9"
                disabled={datasetLoading}
                aria-label="Metadata upload password"
              />
            </span>
          </Label>
          <Label className="grid gap-1.5">
            Driver
            <FieldInput
              type="text"
              value={metadataDraft.driver}
              onChange={(event) => updateMetadataDraft({ driver: event.target.value })}
              disabled={datasetLoading || Boolean(datasetError)}
            />
          </Label>
          <Label className="grid gap-1.5">
            Ride Height
            <FieldInput
              type="number"
              step="0.01"
              value={metadataDraft.ride_height}
              onChange={(event) => updateMetadataDraft({ ride_height: event.target.value })}
              onBlur={normalizeRideHeightDraft}
              disabled={datasetLoading || Boolean(datasetError)}
            />
          </Label>
          <Label className="grid gap-1.5 md:col-span-3">
            Aero Configuration
            <FieldInput
              type="text"
              value={metadataDraft.aero_configuration}
              onChange={(event) => updateMetadataDraft({ aero_configuration: event.target.value })}
              disabled={datasetLoading || Boolean(datasetError)}
            />
          </Label>
          <Label className="grid gap-1.5 md:col-span-3">
            Testing Notes
            <FieldTextarea
              value={metadataDraft.testing_notes}
              onChange={(event) => updateMetadataDraft({ testing_notes: event.target.value })}
              disabled={datasetLoading || Boolean(datasetError)}
            />
          </Label>
        </div>
        {metadataSaveError && <Alert tone="danger">{metadataSaveError}</Alert>}
      </Panel>
      {loading && <p className="text-sm text-muted">Loading schema...</p>}
      {error && <Alert tone="danger">Schema load failed: {error}</Alert>}
      {!loading && !error && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={graphs.map((graph) => graph.id)} strategy={rectSortingStrategy}>
            <section className={graphGridClass}>
              {graphs.map((graph, index) => (
                <SortableGraphCard
                  key={graph.id}
                  graph={graph}
                  index={index}
                  totalGraphs={graphs.length}
                  columns={columns}
                  theme={theme}
                  onRemove={removeGraph}
                  onRename={renameGraph}
                  onConfigChange={updateGraphConfig}
                  onRun={runChart}
                />
              ))}
            </section>
          </SortableContext>
          <DragOverlay>
            {activeGraph ? (
              <article className="grid min-w-[300px] gap-2 rounded-lg border border-border bg-panel p-4 shadow-2xl">
                <h3 className="text-base font-semibold">{activeGraph.name.trim() || `Graph ${graphs.findIndex((g) => g.id === activeGraph.id) + 1}`}</h3>
                <p className="text-sm text-muted">Dragging graph card...</p>
              </article>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </main>
  );
}
