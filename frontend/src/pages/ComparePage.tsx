import { useState } from "react";
import { useDatasets } from "../hooks/useDatasets";
import { Alert, FieldSelect, Label, Panel } from "../components/ui";
import { RunControls, type GraphState } from "../components/RunControls";
import { PlotView } from "../components/PlotView";
type Props = {
  theme: "light" | "dark";
};

export function ComparePage({ theme }: Props) {
  const { datasets, loading, error } = useDatasets();

  const [runA, setRunA] = useState("");
  const [runB, setRunB] = useState("");
  const [graphA, setGraphA] = useState<GraphState | null>(null);
  const [graphB, setGraphB] = useState<GraphState | null>(null);

  const selections = [
    { label: "Run A", value: runA, update: setRunA },
    { label: "Run B", value: runB, update: setRunB },
  ];
  const plotData = [
    ...(graphA?.slug === runA ? graphA.plotData : []),
    ...(graphB?.slug === runB ? graphB.plotData : []),
  ];
  return (
    <main className="grid gap-4">
      <Panel className="grid gap-4 p-4">
        <h2 className="text-base font-semibold">Compare runs</h2>

        {loading && <p className="text-sm text-muted">Loading datasets...</p>}
        {error && <Alert tone="danger">{error}</Alert>}

        {selections.map((selection) => (
          <Label key={selection.label} className="grid gap-2">
            {selection.label}

            <FieldSelect
              value={selection.value}
              disabled={loading || Boolean(error)}
              onChange={(event) => selection.update(event.target.value)}
            >
              <option value="">Choose a Run</option>

              {datasets.map((dataset) => (
                <option key={dataset.slug} value={dataset.slug}>
                  {dataset.title}
                </option>
              ))}
            </FieldSelect>
          </Label>
        ))}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {runA && (
          <RunControls
            key={`a-${runA}`}
            slug={runA}
            label="Run A"
            onData={setGraphA}
          />
        )}

        {runB && (
          <RunControls
            key={`b-${runB}`}
            slug={runB}
            label="Run B"
            onData={setGraphB}
          />
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-inner">
        <PlotView data={plotData} theme={theme} axisTitles={null} />
      </div>
    </main>
  );
}
