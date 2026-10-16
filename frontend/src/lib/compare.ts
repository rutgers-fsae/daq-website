import type { PlotTrace } from "../types/chart";

function isInf(value: unknown): value is number {
  return typeof value == "number" && Number.isFinite(value);
}

export function toElapsedTime(
  data: PlotTrace[],
  timeUnit: string | undefined,
): PlotTrace[] {
  if (timeUnit !== "s") {
    throw new Error("Display time x column in seconds.");
  }

  const timestamps = data[0]?.x;

  if (!Array.isArray(timestamps)) {
    throw new Error("No time data returned.");
  }

  const startTime = timestamps.find(isInf);

  if (startTime === undefined) {
    throw new Error("No valid timestamps found.");
  }

  return data.map((trace) => {
    if (!Array.isArray(trace.x)) {
      throw new Error("A trace is missing its time data.");
    }

    const elapsedX = trace.x.map((time) =>
      isInf(time) ? time - startTime : null,
    );

    return { ...trace, x: elapsedX };
  });
}
