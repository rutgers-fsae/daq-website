export type FilterRule = {
  column: string;
  op: "eq" | "contains" | "gte" | "lte";
  value: string | number;
};

export type ChartType = "line" | "scatter" | "bar" | "histogram" | "box";

export type ComputedColumn = {
  name: string;
  expression: string;
  unit?: string;
};

export type ChartRequest = {
  chart_type: ChartType;
  x_column?: string;
  y_columns: string[];
  group_by?: string;
  filters: FilterRule[];
  computed_columns?: ComputedColumn[];
};

export type ChartConfig = Pick<
  ChartRequest,
  "chart_type" | "x_column" | "y_columns" | "filters" | "computed_columns"
> & { display_units?: Record<string, string> };

export type PlotTrace = Record<string, unknown>;

export type AxisTitles = {
  xTitle: string;
  yTitle: string;
  y2Title?: string;
  separateAxes?: boolean;
  traceLabels: Record<string, string>;
  traceAxisByColumn: Record<string, "y" | "y2">;
};
