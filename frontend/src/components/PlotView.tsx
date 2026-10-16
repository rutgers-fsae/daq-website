import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, CSSProperties } from "react";
import { MousePointer2, Table2 } from "lucide-react";
import { Button } from "./ui";
import type { PlotTrace, AxisTitles } from "../types/chart";
import {
  calculateVisibleStatistics,
  formatStatistic,
  updateVisibleRanges,
  type VisibleRanges,
} from "./plotStatistics";

const THEME_COLORS = {
  dark: {
    paper: "#0d0d0f",
    plot: "#09090b",
    text: "#f7f7f7",
    grid: "#2a2a2f",
    zero: "#4a4a52",
  },
  light: {
    paper: "#ffffff",
    plot: "#f7f7f8",
    text: "#111111",
    grid: "#dedfe3",
    zero: "#aeb1b8",
  },
} as const;

const COLORWAYS = {
  dark: [
    "#ff3b5f",
    "#38bdf8",
    "#a78bfa",
    "#fbbf24",
    "#34d399",
    "#fb7185",
    "#60a5fa",
  ],
  light: [
    "#fd0127",
    "#111111",
    "#6b7280",
    "#ef4444",
    "#f97316",
    "#2563eb",
    "#16a34a",
  ],
} as const;

type Props = {
  data: PlotTrace[];
  theme: "light" | "dark";
  axisTitles: AxisTitles | null;
};

type PlotGraphDiv = HTMLElement & {
  _fullLayout?: {
    dragmode?: string;
    _size: { l: number; t: number; w: number; h: number };
  };
};

type PlotComponentProps = {
  data: PlotTrace[];
  layout: Record<string, unknown>;
  style: CSSProperties;
  onError?: (error: Error) => void;
  onRelayout?: (event: Record<string, unknown>) => void;
};

export function PlotView({ data, theme, axisTitles }: Props) {
  const [PlotComponent, setPlotComponent] =
    useState<ComponentType<PlotComponentProps> | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [sharedHover, setSharedHover] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stopBand = useRef<(() => void) | null>(null);
  const [band, setBand] = useState<{
    left: number;
    width: number;
    top: number;
    height: number;
  } | null>(null);
  const [visibleRanges, setVisibleRanges] = useState<VisibleRanges>({});

  useEffect(() => {
    let mounted = true;
    Promise.all([
      import("react-plotly.js/factory"),
      import("plotly.js-cartesian-dist-min"),
    ]).then(([factory, plotly]) => {
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

  useEffect(() => () => stopBand.current?.(), []);

  // Plotly's zoom box only covers the subplot being dragged; mirror the
  // x-span of the drag across the whole plot area so every graph shows it.
  function startBand(event: React.MouseEvent<HTMLDivElement>) {
    const wrapper = wrapperRef.current;
    const gd = wrapper?.querySelector<PlotGraphDiv>(".js-plotly-plot");
    const layout = gd?._fullLayout;
    if (!stacked || event.button !== 0 || !wrapper || !layout) return;
    if (layout.dragmode !== "zoom") return;
    const { l, t, w, h } = layout._size;
    const origin = wrapper.getBoundingClientRect();
    const x0 = event.clientX - origin.left;
    const y0 = event.clientY - origin.top;
    if (x0 < l || x0 > l + w || y0 < t || y0 > t + h) return;
    stopBand.current?.();
    const clamp = (x: number) => Math.min(l + w, Math.max(l, x));
    const move = (e: MouseEvent) => {
      const x1 = clamp(e.clientX - origin.left);
      setBand({
        left: Math.min(x0, x1),
        width: Math.abs(x1 - x0),
        top: t,
        height: h,
      });
    };
    const end = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      stopBand.current = null;
      setBand(null);
    };
    stopBand.current = end;
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
  }

  const colors = THEME_COLORS[theme];
  const colorway = COLORWAYS[theme];
  const labeledData = useMemo(() => {
    const traceLabels = axisTitles?.traceLabels || {};
    const traceAxisByColumn = axisTitles?.traceAxisByColumn || {};
    return data.map((trace) => {
      const name = typeof trace.name === "string" ? trace.name : "";
      const directLabel = traceLabels[name];
      const groupedLabel = Object.entries(traceLabels).find(([column]) =>
        name.endsWith(` - ${column}`),
      );
      const sourceColumn = directLabel ? name : groupedLabel?.[0];
      const labeledTrace = {
        ...trace,
        name:
          directLabel ||
          (groupedLabel
            ? name.replace(` - ${groupedLabel[0]}`, ` - ${groupedLabel[1]}`)
            : name),
      };
      const traceAxis = sourceColumn
        ? traceAxisByColumn[sourceColumn]
        : undefined;
      return traceAxis ? { ...labeledTrace, yaxis: traceAxis } : labeledTrace;
    });
  }, [axisTitles, data]);
  const stacked = Boolean(axisTitles?.separateAxes);
  const plotData = useMemo(
    () =>
      stacked
        ? labeledData.map((trace, i) => ({
            ...trace,
            yaxis: i ? `y${i + 1}` : "y",
          }))
        : labeledData,
    [labeledData, stacked],
  );
  const hasRightAxis = Boolean(axisTitles?.y2Title) && !stacked;
  const height = stacked ? Math.max(520, 180 * plotData.length + 100) : 520;
  // One y axis per trace, stacked top to bottom, all sharing the x axis.
  const stackedAxes = useMemo(() => {
    const n = plotData.length;
    const gap = 0.03;
    const h = (1 - gap * (n - 1)) / n;
    return Object.fromEntries(
      plotData.map((trace, i) => [
        i ? `yaxis${i + 1}` : "yaxis",
        {
          title: { text: String(trace.name ?? ""), font: { size: 11 } },
          domain: [1 - (i + 1) * h - i * gap, 1 - i * h - i * gap],
          anchor: "x",
          gridcolor: colors.grid,
          zerolinecolor: colors.zero,
        },
      ]),
    );
  }, [colors.grid, colors.zero, plotData]);
  const layout = useMemo(
    () => ({
      autosize: true,
      hovermode: sharedHover ? "x unified" : "closest",
      hoverdistance: sharedHover ? -1 : 20,
      hoversubplots: "axis",
      hoverlabel: { namelength: -1 },
      title: { text: "Dataset Graph", font: { size: 15 } },
      margin: { l: 64, r: hasRightAxis ? 64 : 24, t: 46, b: 56 },
      xaxis: {
        title: { text: axisTitles?.xTitle || "" },
        ...(stacked
          ? {
              anchor: plotData.length > 1 ? `y${plotData.length}` : "y",
              showspikes: true,
              spikemode: "across",
              spikesnap: "cursor",
              spikethickness: 1,
            }
          : {}),
        gridcolor: colors.grid,
        zerolinecolor: colors.zero,
      },
      yaxis: {
        title: { text: axisTitles?.yTitle || "" },
        gridcolor: colors.grid,
        zerolinecolor: colors.zero,
      },
      ...(stacked ? stackedAxes : {}),
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
      font: {
        color: colors.text,
        family: "Inter, ui-sans-serif, system-ui, sans-serif",
      },
    }),
    [
      axisTitles,
      colorway,
      colors.grid,
      colors.paper,
      colors.plot,
      colors.text,
      colors.zero,
      hasRightAxis,
      plotData.length,
      sharedHover,
      stacked,
      stackedAxes,
    ],
  );
  const statistics = useMemo(
    () => calculateVisibleStatistics(labeledData, visibleRanges, [...colorway]),
    [colorway, labeledData, visibleRanges],
  );

  if (!data.length)
    return (
      <p className="p-8 text-center text-sm text-muted">No chart data yet.</p>
    );
  if (!PlotComponent)
    return (
      <p className="p-8 text-center text-sm text-muted">
        Loading chart engine...
      </p>
    );
  if (renderError)
    return (
      <p className="p-8 text-center text-sm text-[var(--danger)]">
        Chart render failed: {renderError}
      </p>
    );

  return (
    <>
      <div className="flex justify-end gap-2 px-3 pb-1 pt-3">
        <Button
          type="button"
          size="sm"
          variant={showStats ? "primary" : "secondary"}
          className="gap-1.5 rounded-full px-3"
          aria-pressed={showStats}
          onClick={() => setShowStats((current) => !current)}
        >
          <Table2 size={14} className="shrink-0" aria-hidden="true" />
          Stats
          <span
            aria-hidden="true"
            className="min-w-7 rounded-full border border-current/20 px-1.5 py-1 text-center text-[10px] leading-none opacity-80"
          >
            {showStats ? "On" : "Off"}
          </span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant={sharedHover ? "primary" : "secondary"}
          className="gap-1.5 rounded-full px-3"
          aria-pressed={sharedHover}
          onClick={() => setSharedHover((current) => !current)}
        >
          <MousePointer2 size={14} className="shrink-0" aria-hidden="true" />
          Shared hover
          <span
            aria-hidden="true"
            className="min-w-7 rounded-full border border-current/20 px-1.5 py-1 text-center text-[10px] leading-none opacity-80"
          >
            {sharedHover ? "On" : "Off"}
          </span>
        </Button>
      </div>
      <div
        ref={wrapperRef}
        className="relative w-full"
        style={{ height }}
        onMouseDownCapture={startBand}
      >
        <PlotComponent
          data={plotData}
          layout={layout}
          style={{ width: "100%", height }}
          onRelayout={(event) =>
            setVisibleRanges((current) => updateVisibleRanges(current, event))
          }
          onError={(error) =>
            setRenderError(error.message || "Unknown Plotly error")
          }
        />
        {band && band.width > 2 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 border-x border-button bg-button/15"
            style={band}
          />
        )}
        {showStats && statistics.length > 0 && (
          <div className="absolute left-16 top-12 z-10 max-h-44 max-w-[calc(100%-5.5rem)] overflow-auto rounded-md border border-border bg-panel/95 shadow-lg backdrop-blur-sm">
            <table
              className="min-w-max border-collapse text-[11px] tabular-nums text-text"
              aria-label="Visible range statistics"
            >
              <thead className="sticky top-0 bg-surface-soft text-muted">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold">Trace</th>
                  <th className="px-2 py-1.5 text-right font-semibold">RMS</th>
                  <th className="px-2 py-1.5 text-right font-semibold">
                    Average
                  </th>
                  <th className="px-2 py-1.5 text-right font-semibold">Min</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Max</th>
                </tr>
              </thead>
              <tbody>
                {statistics.map((statistic, index) => (
                  <tr
                    key={`${statistic.name}-${index}`}
                    className="border-t border-border"
                  >
                    <th className="max-w-40 px-2 py-1 text-left font-medium">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: statistic.color }}
                          aria-hidden="true"
                        />
                        <span className="truncate">{statistic.name}</span>
                      </span>
                    </th>
                    <td className="px-2 py-1 text-right">
                      {formatStatistic(statistic.rms)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {formatStatistic(statistic.average)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {formatStatistic(statistic.min)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {formatStatistic(statistic.max)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
