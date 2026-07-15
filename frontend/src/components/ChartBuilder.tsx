import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Play, X } from "lucide-react";
import type { SchemaColumn } from "../types/dataset";
import type { ChartConfig, ChartRequest, FilterRule } from "../types/chart";
import { Alert, Badge, Button, FieldInput, FieldSelect, Label, Panel } from "./ui";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

type Props = {
  columns: SchemaColumn[];
  config?: ChartConfig;
  onConfigChange?: (config: ChartConfig) => void;
  onRun: (
    payload: ChartRequest,
    axisTitles: {
      xTitle: string;
      yTitle: string;
      y2Title?: string;
      traceLabels: Record<string, string>;
      traceAxisByColumn: Record<string, "y" | "y2">;
    },
  ) => void;
};

const defaultConfig: ChartConfig = { chart_type: "line", y_columns: [], filters: [] };

function isTimeColumn(column: SchemaColumn) {
  return (column.type === "numeric" || column.type === "datetime") && /(time|timestamp)/i.test(column.name);
}

function filterValueForColumn(value: string, column: SchemaColumn | undefined) {
  if (column?.type !== "numeric") {
    return value;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : value;
}

function timeFilterState(filters: FilterRule[] | undefined) {
  const lowerBound = filters?.find((rule) => rule.op === "gte");
  const upperBound = filters?.find((rule) => rule.op === "lte");
  const timeColumn = lowerBound?.column || upperBound?.column || "";
  return {
    timeColumn,
    startTime: lowerBound?.value === undefined ? "" : String(lowerBound.value),
    endTime: upperBound?.value === undefined ? "" : String(upperBound.value),
  };
}

export function ChartBuilder({ columns, config = defaultConfig, onConfigChange, onRun }: Props) {
  const [chartType, setChartType] = useState<ChartRequest["chart_type"]>(config.chart_type);
  const [xColumn, setXColumn] = useState(config.x_column || "");
  const [yColumns, setYColumns] = useState<string[]>(config.y_columns);
  const initialTimeFilter = timeFilterState(config.filters);
  const [timeColumn, setTimeColumn] = useState(initialTimeFilter.timeColumn);
  const [startTime, setStartTime] = useState(initialTimeFilter.startTime);
  const [endTime, setEndTime] = useState(initialTimeFilter.endTime);
  const [isXDropdownOpen, setIsXDropdownOpen] = useState(false);
  const [isYDropdownOpen, setIsYDropdownOpen] = useState(false);

  const numericColumns = useMemo(() => columns.filter((col) => col.type === "numeric"), [columns]);
  const timeColumns = useMemo(() => columns.filter(isTimeColumn), [columns]);
  const selectedTimeColumn = columns.find((column) => column.name === timeColumn);
  const timeInputType = selectedTimeColumn?.type === "datetime" ? "text" : "number";
  const startTimeTrimmed = startTime.trim();
  const endTimeTrimmed = endTime.trim();
  const hasInvalidTimeFilter =
    selectedTimeColumn?.type === "numeric" &&
    ((startTimeTrimmed !== "" && !Number.isFinite(Number(startTimeTrimmed))) ||
      (endTimeTrimmed !== "" && !Number.isFinite(Number(endTimeTrimmed))));
  const filters = useMemo<FilterRule[]>(() => {
    if (!timeColumn || hasInvalidTimeFilter) {
      return [];
    }
    const rules: FilterRule[] = [];
    if (startTimeTrimmed !== "") {
      rules.push({ column: timeColumn, op: "gte", value: filterValueForColumn(startTimeTrimmed, selectedTimeColumn) });
    }
    if (endTimeTrimmed !== "") {
      rules.push({ column: timeColumn, op: "lte", value: filterValueForColumn(endTimeTrimmed, selectedTimeColumn) });
    }
    return rules;
  }, [endTimeTrimmed, hasInvalidTimeFilter, selectedTimeColumn, startTimeTrimmed, timeColumn]);

  useEffect(() => {
    onConfigChange?.({ chart_type: chartType, x_column: xColumn || undefined, y_columns: yColumns, filters });
  }, [chartType, filters, onConfigChange, xColumn, yColumns]);

  useEffect(() => {
    const available = new Set(columns.map((column) => column.name));
    setXColumn((current) => (current && !available.has(current) ? "" : current));
    setYColumns((current) => current.filter((column) => available.has(column)));
    setTimeColumn((current) => {
      if (current && available.has(current)) {
        return current;
      }
      return timeColumns[0]?.name || "";
    });
  }, [columns, timeColumns]);

  function columnLabel(columnName: string) {
    const column = columns.find((item) => item.name === columnName);
    if (!column) return columnName;
    return column.display_name || column.name;
  }

  function columnUnit(columnName: string) {
    return columns.find((item) => item.name === columnName)?.unit || null;
  }

  function toggleYColumn(columnName: string) {
    setYColumns((prev) =>
      prev.includes(columnName) ? prev.filter((item) => item !== columnName) : [...prev, columnName],
    );
  }

  const selectedUnits = Array.from(new Set(yColumns.map((column) => columnUnit(column) || "unitless")));
  const hasMultipleUnits = selectedUnits.length > 1;
  const hasTooManyUnits = selectedUnits.length > 2;
  const primaryUnit = selectedUnits[0];
  const secondaryUnit = selectedUnits[1];
  const primaryUnitLabel = primaryUnit === "unitless" ? "Unitless" : primaryUnit;
  const secondaryUnitLabel = secondaryUnit === "unitless" ? "Unitless" : secondaryUnit;

  function axisTitleForUnit(unit: string | undefined) {
    if (!unit) return "Values";
    return unit === "unitless" ? "Values" : `Values (${unit})`;
  }

  function traceAxisByColumn() {
    return Object.fromEntries(
      yColumns.map((column) => [column, (columnUnit(column) || "unitless") === primaryUnit ? "y" : "y2"]),
    ) as Record<string, "y" | "y2">;
  }
  const yDropdownLabel =
    yColumns.length === 0 ? "Select Y Series" : yColumns.length === 1 ? "1 series selected" : `${yColumns.length} series selected`;
  const xDropdownLabel = xColumn ? columnLabel(xColumn) : "Select X Axis";

  return (
    <Panel className="grid gap-3 bg-surface-soft p-3 shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Chart Builder</h3>
          <p className="text-xs text-subtle">{numericColumns.length} numeric channels</p>
        </div>
        <FieldSelect
          value={chartType}
          onChange={(e) => setChartType(e.target.value as ChartRequest["chart_type"])}
          className="w-full sm:w-40"
          aria-label="Chart type"
        >
          <option value="line">Line</option>
          <option value="scatter">Scatter</option>
          <option value="bar">Bar</option>
          <option value="histogram">Histogram</option>
          <option value="box">Box</option>
        </FieldSelect>
      </div>
      {numericColumns.length === 0 && (
        <Alert tone="warning" className="text-xs">
          This dataset has no numeric columns to plot.
        </Alert>
      )}
      <div className="grid gap-2 md:grid-cols-2">
        <Label className="grid gap-1.5">
          X Axis
          <Popover open={isXDropdownOpen} onOpenChange={setIsXDropdownOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-9 w-full items-center justify-between rounded-md border border-input-border bg-input px-3 text-left text-sm font-normal text-text shadow-sm transition hover:border-button focus:outline-none focus:ring-2 focus:ring-ring/30"
                aria-label={xDropdownLabel}
              >
                <span className="truncate normal-case tracking-normal">{xDropdownLabel}</span>
                <ChevronDown size={15} aria-hidden="true" className="shrink-0 text-muted" />
              </button>
            </PopoverTrigger>
            <PopoverContent>
              <Command label="X axis channels">
                <CommandInput placeholder="Search X channels..." aria-label="Search X channels" />
                <CommandList>
                  <CommandEmpty>No channels found.</CommandEmpty>
                  <CommandItem
                    value="Use row index"
                    onSelect={() => {
                      setXColumn("");
                      setIsXDropdownOpen(false);
                    }}
                    className={!xColumn ? "font-medium" : "text-muted"}
                  >
                    Use row index
                  </CommandItem>
                  {columns.map((col) => (
                    <CommandItem
                      key={col.name}
                      value={`${col.display_name || col.name} ${col.name}`}
                      onSelect={() => {
                        setXColumn(col.name);
                        setIsXDropdownOpen(false);
                      }}
                      className={xColumn === col.name ? "font-medium" : undefined}
                    >
                      {col.display_name || col.name}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </Label>
        <Label className="grid gap-1.5">
          Y Series
          <Popover open={isYDropdownOpen} onOpenChange={setIsYDropdownOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-9 w-full items-center justify-between rounded-md border border-input-border bg-input px-3 text-left text-sm font-normal text-text shadow-sm transition hover:border-button focus:outline-none focus:ring-2 focus:ring-ring/30"
                aria-label={yDropdownLabel}
              >
                <span className="truncate normal-case tracking-normal">{yDropdownLabel}</span>
                <ChevronDown size={15} aria-hidden="true" className="shrink-0 text-muted" />
              </button>
            </PopoverTrigger>
            <PopoverContent>
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <p className="text-sm font-medium text-text">Y Axis Series</p>
                {yColumns.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setYColumns([])}
                    className="rounded-md px-2 py-1 text-xs text-muted transition hover:bg-surface-soft hover:text-text"
                  >
                    Clear all
                  </button>
                )}
              </div>
              <Command label="Y axis channels">
                <CommandInput placeholder="Search Y channels..." aria-label="Search Y channels" />
                <CommandList>
                  <CommandEmpty>No numeric channels found.</CommandEmpty>
                  {numericColumns.map((col) => (
                    <CommandItem
                      key={col.name}
                      value={`${col.display_name || col.name} ${col.name}`}
                      onSelect={() => toggleYColumn(col.name)}
                    >
                      <input
                        type="checkbox"
                        checked={yColumns.includes(col.name)}
                        onChange={() => toggleYColumn(col.name)}
                        onClick={(event) => event.stopPropagation()}
                        className="mr-2 h-4 w-4 shrink-0 accent-button"
                        aria-label={col.display_name || col.name}
                      />
                      <span className="truncate">{col.display_name || col.name}</span>
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </Label>
      </div>
      {yColumns.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {yColumns.map((column) => (
            <button
              key={column}
              type="button"
              onClick={() => toggleYColumn(column)}
              className="inline-flex items-center gap-1 rounded-md border border-input-border bg-input px-2 py-1 text-xs font-medium text-text shadow-sm transition hover:border-button hover:bg-surface"
              title="Remove series"
            >
              {columnLabel(column)}
              <X size={12} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      {timeColumns.length > 0 && (
        <div className="grid gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Time Window</p>
            <Badge tone="default">{timeColumns.length} time fields</Badge>
          </div>
          <div className="grid gap-1.5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Label className="grid min-w-0 gap-1">
              Time Filter
              <FieldSelect
                value={timeColumn}
                onChange={(event) => setTimeColumn(event.target.value)}
                aria-label="Time filter column"
              >
                {timeColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.display_name || column.name}
                  </option>
                ))}
              </FieldSelect>
            </Label>
            <Label className="grid min-w-0 gap-1">
              Start
              <FieldInput
                type={timeInputType}
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                aria-label="Time filter start"
                placeholder="Min"
                step="any"
                className="w-full min-w-0"
              />
            </Label>
            <Label className="grid min-w-0 gap-1">
              End
              <FieldInput
                type={timeInputType}
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                aria-label="Time filter end"
                placeholder="Max"
                step="any"
                className="w-full min-w-0"
              />
            </Label>
          </div>
          {(startTime || endTime) && (
            <button
              type="button"
              onClick={() => {
                setStartTime("");
                setEndTime("");
              }}
              className="justify-self-start rounded-md px-2 py-1 text-xs text-muted transition hover:bg-surface-soft hover:text-text"
            >
              Clear time filter
            </button>
          )}
        </div>
      )}
      {hasInvalidTimeFilter && (
        <Alert tone="warning" className="text-xs">
          Time filter values must be numeric for {selectedTimeColumn?.display_name || selectedTimeColumn?.name}.
        </Alert>
      )}
      {hasMultipleUnits && !hasTooManyUnits && (
        <Alert tone="info" className="text-xs">
          Using dual Y-axes for {primaryUnitLabel} and {secondaryUnitLabel}.
        </Alert>
      )}
      {hasTooManyUnits && (
        <Alert tone="warning" className="text-xs">
          More than two Y-axis units selected. Only two axes are supported per graph.
        </Alert>
      )}
      <Button
        disabled={yColumns.length === 0 || hasTooManyUnits || hasInvalidTimeFilter}
        onClick={() =>
          onRun(
            { chart_type: chartType, x_column: xColumn || undefined, y_columns: yColumns, filters },
            {
              xTitle: xColumn ? columnLabel(xColumn) : "Index",
              yTitle: yColumns.length === 1 ? columnLabel(yColumns[0]) : axisTitleForUnit(primaryUnit),
              y2Title: secondaryUnit ? axisTitleForUnit(secondaryUnit) : undefined,
              traceLabels: Object.fromEntries(yColumns.map((column) => [column, columnLabel(column)])),
              traceAxisByColumn: traceAxisByColumn(),
            },
          )
        }
        variant="primary"
        className="justify-self-start"
      >
        <Play size={15} aria-hidden="true" />
        Render
      </Button>
    </Panel>
  );
}
