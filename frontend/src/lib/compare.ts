import type { PlotTrace } from "../types/chart";
import { compatibleUnits, convertUnit } from "./units";

function isFinite(value: unknown): value is number {
  return typeof value == "number" && Number.isFinite(value);
}

export function toElapsedTime(
  data: PlotTrace[],
  timeUnit: string | undefined,
): PlotTrace[] {
  if (!timeUnit || !compatibleUnits(timeUnit).includes("s")) {
    throw new Error("Choose a time column with a known time unit.");
  }

  let startTime: number | undefined;

  for (const trace of data) {
    if (!Array.isArray(trace.x)) {
      throw new Error("A trace is missing its time data.");
    }

    for (const time of trace.x) {
      if (isFinite(time) && (startTime === undefined || time < startTime)) {
        startTime = time;
      }
    }
  }

  if (startTime === undefined) {
    throw new Error("No valid timestamps found.");
  }

  return data.map((trace) => {
    if (!Array.isArray(trace.x)) {
      throw new Error("A trace is missing its time data.");
    }

    const elapsedX = trace.x.map((time) =>
      isFinite(time) ? convertUnit(time - startTime, timeUnit, "s") : null,
    );

    return { ...trace, x: elapsedX };
  });
}
