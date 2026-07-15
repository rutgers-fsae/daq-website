import { useEffect, useMemo, useState } from "react";
import type { ComponentType, CSSProperties } from "react";
import type { PlotTrace } from "../types/chart";
import { calculateVisibleStatistics, formatStatistic, updateVisibleRanges, type VisibleRanges } from "./plotStatistics";

const THEME_COLORS = {
  dark: { paper: "#0d0d0f", plot: "#09090b", text: "#f7f7f7", grid: "#2a2a2f", zero: "#4a4a52" },
  light: { paper: "#ffffff", plot: "#f7f7f8", text: "#111111", grid: "#dedfe3", zero: "#aeb1b8" },
} as const;

const COLORWAYS = {
  dark: ["#ff3b5f", "#38bdf8", "#a78bfa", "#fbbf24", "#34d399", "#fb7185", "#60a5fa"],
  light: ["#fd0127", "#111111", "#6b7280", "#ef4444", "#f97316", "#2563eb", "#16a34a"],
} as const;

type Props = {
  data: PlotTrace[];
  theme: "light" | "dark";
  axisTitles: {
    xTitle: string;
    yTitle: string;
    y2Title?: string;
    traceLabels: Record<string, string>;
    traceAxisByColumn: Record<string, "y" | "y2">;
  } | null;
};

type PlotComponentProps = {
  data: PlotTrace[];
  layout: Record<string, unknown>;
  style: CSSProperties;
  onError?: (error: Error) => void;
  onRelayout?: (event: Record<string, unknown>) => void;
};

export function PlotView({ data, theme, axisTitles }: Props) {
  const [PlotComponent, setPlotComponent] = useState<ComponentType<PlotComponentProps> | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [visibleRanges, setVisibleRanges] = useState<VisibleRanges>({});

  useEffect(() => {
    let mounted = true;
    Promise.all([import("react-plotly.js/factory"), import("plotly.js-cartesian-dist-min")]).then(([factory, plotly]) => {
      if (mounted) {
        const component = factory.default(plotly.default);
        setPlotComponent(() => component as ComponentType<PlotComponentProps>);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setRenderError(null);
  }, [data, axisTitles, theme]);

  useEffect(() => {
    setVisibleRanges({});
  }, [data, axisTitles]);

  const colors = THEME_COLORS[theme];
  const colorway = COLORWAYS[theme];
  const labeledData = useMemo(() => {
    const traceLabels = axisTitles?.traceLabels || {};
    const traceAxisByColumn = axisTitles?.traceAxisByColumn || {};
    return data.map((trace) => {
      const name = typeof trace.name === "string" ? trace.name : "";
      const directLabel = traceLabels[name];
      const groupedLabel = Object.entries(traceLabels).find(([column]) => name.endsWith(` - ${column}`));
      const sourceColumn = directLabel ? name : groupedLabel?.[0];
      const labeledTrace = {
        ...trace,
        name: directLabel || (groupedLabel ? name.replace(` - ${groupedLabel[0]}`, ` - ${groupedLabel[1]}`) : name),
      };
      const traceAxis = sourceColumn ? traceAxisByColumn[sourceColumn] : undefined;
      return traceAxis ? { ...labeledTrace, yaxis: traceAxis } : labeledTrace;
    });
  }, [axisTitles, data]);
  const hasRightAxis = Boolean(axisTitles?.y2Title);
  const layout = useMemo(
    () => ({
      autosize: true,
      title: { text: "Dataset Graph", font: { size: 15 } },
      margin: { l: 64, r: hasRightAxis ? 64 : 24, t: 46, b: 56 },
      xaxis: { title: { text: axisTitles?.xTitle || "" }, gridcolor: colors.grid, zerolinecolor: colors.zero },
      yaxis: { title: { text: axisTitles?.yTitle || "" }, gridcolor: colors.grid, zerolinecolor: colors.zero },
      ...(hasRightAxis
        ? {
            yaxis2: {
              title: { text: axisTitles?.y2Title || "" },
              overlaying: "y",
              side: "right",
              gridcolor: colors.grid,
              zerolinecolor: colors.zero,
            },
          }
        : {}),
      paper_bgcolor: colors.paper,
      plot_bgcolor: colors.plot,
      colorway: [...colorway],
      font: { color: colors.text, family: "Inter, ui-sans-serif, system-ui, sans-serif" },
    }),
    [axisTitles, colorway, colors.grid, colors.paper, colors.plot, colors.text, colors.zero, hasRightAxis],
  );
  const statistics = useMemo(
    () => calculateVisibleStatistics(labeledData, visibleRanges, [...colorway]),
    [colorway, labeledData, visibleRanges],
  );

  if (!data.length) return <p className="p-8 text-center text-sm text-muted">No chart data yet.</p>;
  if (!PlotComponent) return <p className="p-8 text-center text-sm text-muted">Loading chart engine...</p>;
  if (renderError) return <p className="p-8 text-center text-sm text-[var(--danger)]">Chart render failed: {renderError}</p>;

  return (
    <div className="relative h-[520px] w-full">
      <PlotComponent
        data={labeledData}
        layout={layout}
        style={{ width: "100%", height: "520px" }}
        onRelayout={(event) => setVisibleRanges((current) => updateVisibleRanges(current, event))}
        onError={(error) => setRenderError(error.message || "Unknown Plotly error")}
      />
      {statistics.length > 0 && (
        <div className="absolute left-16 top-12 z-10 max-h-44 max-w-[calc(100%-5.5rem)] overflow-auto rounded-md border border-border bg-panel/95 shadow-lg backdrop-blur-sm">
          <table className="min-w-max border-collapse text-[11px] tabular-nums text-text" aria-label="Visible range statistics">
            <thead className="sticky top-0 bg-surface-soft text-muted">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">Trace</th>
                <th className="px-2 py-1.5 text-right font-semibold">RMS</th>
                <th className="px-2 py-1.5 text-right font-semibold">Average</th>
                <th className="px-2 py-1.5 text-right font-semibold">Min</th>
                <th className="px-2 py-1.5 text-right font-semibold">Max</th>
              </tr>
            </thead>
            <tbody>
              {statistics.map((statistic, index) => (
                <tr key={`${statistic.name}-${index}`} className="border-t border-border">
                  <th className="max-w-40 px-2 py-1 text-left font-medium">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: statistic.color }} aria-hidden="true" />
                      <span className="truncate">{statistic.name}</span>
                    </span>
                  </th>
                  <td className="px-2 py-1 text-right">{formatStatistic(statistic.rms)}</td>
                  <td className="px-2 py-1 text-right">{formatStatistic(statistic.average)}</td>
                  <td className="px-2 py-1 text-right">{formatStatistic(statistic.min)}</td>
                  <td className="px-2 py-1 text-right">{formatStatistic(statistic.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
