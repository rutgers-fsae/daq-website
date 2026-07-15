import type { PlotTrace } from "../types/chart";

export type AxisRange = [unknown, unknown];

export type VisibleRanges = {
  x?: AxisRange;
  y?: AxisRange;
  y2?: AxisRange;
};

export type TraceStatistics = {
  name: string;
  color: string;
  rms: number | null;
  average: number | null;
  min: number | null;
  max: number | null;
};

type XAxisKind = "number" | "date" | "category";

function isEligibleTrace(trace: PlotTrace) {
  if (trace.type !== "scatter") return false;
  return typeof trace.mode !== "string" || trace.mode.includes("lines") || trace.mode.includes("markers");
}

function axisKind(values: unknown[]): XAxisKind {
  const populated = values.filter((value) => value !== null && value !== undefined);
  if (populated.length > 0 && populated.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return "number";
  }
  if (
    populated.length > 0 &&
    populated.every(
      (value) =>
        value instanceof Date ||
        (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value))),
    )
  ) {
    return "date";
  }
  return "category";
}

function comparableValue(value: unknown, kind: XAxisKind, categories: Map<string, number>) {
  if (kind === "number") {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  if (kind === "date") {
    const parsed = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  }
  return categories.get(String(value)) ?? null;
}

function comparableBound(value: unknown, kind: XAxisKind, categories: Map<string, number>) {
  if (kind === "category" && typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return comparableValue(value, kind, categories);
}

function isWithin(value: number, range: AxisRange | undefined, convert: (bound: unknown) => number | null) {
  if (!range) return true;
  const first = convert(range[0]);
  const second = convert(range[1]);
  if (first === null || second === null) return true;
  return value >= Math.min(first, second) && value <= Math.max(first, second);
}

function traceColor(trace: PlotTrace, fallback: string) {
  const line = trace.line;
  if (line && typeof line === "object" && "color" in line && typeof line.color === "string") return line.color;
  const marker = trace.marker;
  if (marker && typeof marker === "object" && "color" in marker && typeof marker.color === "string") return marker.color;
  return fallback;
}

export function calculateVisibleStatistics(data: PlotTrace[], ranges: VisibleRanges, colorway: string[]): TraceStatistics[] {
  const eligible = data.filter(isEligibleTrace);
  const allXValues = eligible.flatMap((trace) => (Array.isArray(trace.x) ? trace.x : []));
  const kind = axisKind(allXValues);
  const categories = new Map<string, number>();
  if (kind === "category") {
    allXValues.forEach((value) => {
      const key = String(value);
      if (!categories.has(key)) categories.set(key, categories.size);
    });
  }

  return eligible.map((trace, traceIndex) => {
    const yValues = Array.isArray(trace.y) ? trace.y : [];
    const xValues = Array.isArray(trace.x) ? trace.x : yValues.map((_, index) => index);
    const yRange = trace.yaxis === "y2" ? ranges.y2 : ranges.y;
    const visibleValues: number[] = [];

    yValues.forEach((rawY, index) => {
      if (typeof rawY !== "number" || !Number.isFinite(rawY)) return;
      const x = comparableValue(xValues[index] ?? index, kind, categories);
      if (x === null || !isWithin(x, ranges.x, (bound) => comparableBound(bound, kind, categories))) return;
      if (!isWithin(rawY, yRange, (bound) => (typeof bound === "number" && Number.isFinite(bound) ? bound : null))) return;
      visibleValues.push(rawY);
    });

    if (visibleValues.length === 0) {
      return {
        name: typeof trace.name === "string" ? trace.name : `Trace ${traceIndex + 1}`,
        color: traceColor(trace, colorway[traceIndex % colorway.length]),
        rms: null,
        average: null,
        min: null,
        max: null,
      };
    }

    const sum = visibleValues.reduce((total, value) => total + value, 0);
    const squareSum = visibleValues.reduce((total, value) => total + value * value, 0);
    return {
      name: typeof trace.name === "string" ? trace.name : `Trace ${traceIndex + 1}`,
      color: traceColor(trace, colorway[traceIndex % colorway.length]),
      rms: Math.sqrt(squareSum / visibleValues.length),
      average: sum / visibleValues.length,
      min: Math.min(...visibleValues),
      max: Math.max(...visibleValues),
    };
  });
}

export function updateVisibleRanges(current: VisibleRanges, event: Record<string, unknown>): VisibleRanges {
  const next = { ...current };
  (["xaxis", "yaxis", "yaxis2"] as const).forEach((axis) => {
    const key = axis === "xaxis" ? "x" : axis === "yaxis" ? "y" : "y2";
    if (event[`${axis}.autorange`] === true) {
      delete next[key];
      return;
    }
    const combined = event[`${axis}.range`];
    if (Array.isArray(combined) && combined.length >= 2) {
      next[key] = [combined[0], combined[1]];
      return;
    }
    const first = event[`${axis}.range[0]`];
    const second = event[`${axis}.range[1]`];
    if (first !== undefined && second !== undefined) next[key] = [first, second];
  });
  return next;
}

const numberFormatter = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 });

export function formatStatistic(value: number | null) {
  return value === null ? "N/A" : numberFormatter.format(value);
}
