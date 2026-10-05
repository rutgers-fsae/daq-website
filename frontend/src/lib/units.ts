import type { ChartRequest, PlotTrace } from "../types/chart";
import type { SchemaColumn } from "../types/dataset";

type Unit = { family: string; scale: number; offset: number };

const foot = 0.3048;
const poundForce = 4.4482216152605;

// Base value = value * scale + offset. Case is significant (g is not G).
export const units: Record<string, Unit> = Object.fromEntries(
  Object.entries({
    speed: { "m/s": 1, "km/h": 1 / 3.6, mph: 0.44704, "ft/s": foot },
    pressure: {
      Pa: 1,
      kPa: 1000,
      MPa: 1e6,
      bar: 1e5,
      mbar: 100,
      psi: poundForce / 0.0254 ** 2,
    },
    distance: {
      mm: 0.001,
      cm: 0.01,
      m: 1,
      km: 1000,
      in: 0.0254,
      ft: foot,
      yd: 3 * foot,
      mi: 1609.344,
    },
    temperature: { "°C": 1, "°F": 5 / 9, K: 1 },
    acceleration: { "m/s²": 1, "ft/s²": foot, g: 9.80665 },
    angle: { deg: Math.PI / 180, rad: 1 },
    angularSpeed: { rpm: Math.PI / 30, "rad/s": 1, "deg/s": Math.PI / 180 },
    time: { ns: 1e-9, µs: 1e-6, ms: 0.001, s: 1, min: 60, h: 3600 },
    force: { N: 1, kN: 1000, lbf: poundForce },
    torque: {
      "N·m": 1,
      "lbf·ft": poundForce * foot,
      "lbf·in": poundForce * 0.0254,
    },
    power: { W: 1, kW: 1000, hp: 550 * poundForce * foot },
    voltage: { mV: 0.001, V: 1, kV: 1000 },
    current: { mA: 0.001, A: 1, kA: 1000 },
    frequency: { Hz: 1, kHz: 1000, MHz: 1e6 },
  }).flatMap(([family, entries]) =>
    Object.entries(entries).map(([name, scale]) => [
      name,
      {
        family,
        scale,
        offset:
          name === "°C" ? 273.15 : name === "°F" ? 273.15 - (32 * 5) / 9 : 0,
      },
    ]),
  ),
);

const aliases: Record<string, string> = {
  kph: "km/h",
  "km/hr": "km/h",
  C: "°C",
  F: "°F",
  "N.m": "N·m",
  Nm: "N·m",
  "N*m": "N·m",
  "lb-ft": "lbf·ft",
  "lb-in": "lbf·in",
  "m/s^2": "m/s²",
  "ft/s^2": "ft/s²",
  us: "µs",
  μs: "µs",
  "°": "deg",
};

export function canonicalUnit(
  unit: string | null | undefined,
): string | undefined {
  const name = unit?.trim();
  if (!name) return undefined;
  const canonical = Object.prototype.hasOwnProperty.call(aliases, name)
    ? aliases[name]
    : name;
  return Object.prototype.hasOwnProperty.call(units, canonical)
    ? canonical
    : undefined;
}

export function sourceUnit(column: SchemaColumn | undefined) {
  if (column?.type !== "numeric") return undefined;
  if (column.unit === "G" && /^G Force\b/i.test(column.name)) return "g";
  return canonicalUnit(column.unit);
}

export function compatibleUnits(source: string | undefined) {
  const name = canonicalUnit(source);
  return name
    ? Object.keys(units).filter(
        (target) => units[target].family === units[name].family,
      )
    : [];
}

export function convertUnit(value: number, from: string, to: string) {
  const source = canonicalUnit(from);
  const target = canonicalUnit(to);
  if (!source || !target || units[source].family !== units[target].family) {
    throw new Error(`Cannot convert ${from} to ${to}`);
  }
  if (source === target) return value;
  const a = units[source];
  const b = units[target];
  return (value * a.scale + a.offset - b.offset) / b.scale;
}

export function cleanDisplayUnits(
  value: unknown,
  columns?: SchemaColumn[],
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([column, target]) => {
      const unit =
        typeof target === "string" ? canonicalUnit(target) : undefined;
      const source = columns
        ? sourceUnit(columns.find((item) => item.name === column))
        : undefined;
      return unit &&
        (!columns ||
          (source && compatibleUnits(source).includes(unit) && source !== unit))
        ? [[column, unit]]
        : [];
    }),
  );
}

export function convertChartData(
  data: PlotTrace[],
  request: ChartRequest,
  columns: SchemaColumn[],
  displayUnits: Record<string, string>,
): PlotTrace[] {
  const selected = cleanDisplayUnits(displayUnits, columns);
  function convertSamples(samples: unknown, column: string | undefined) {
    const target =
      column && Object.prototype.hasOwnProperty.call(selected, column)
        ? selected[column]
        : undefined;
    const source = sourceUnit(columns.find((item) => item.name === column));
    if (!Array.isArray(samples) || !source || !target) return samples;
    return samples.map((value) =>
      typeof value === "number" && Number.isFinite(value)
        ? convertUnit(value, source, target)
        : value,
    );
  }
  return data.map((trace) => {
    const name = typeof trace.name === "string" ? trace.name : "";
    const column =
      request.y_columns.find((column) => column === name) ||
      [...request.y_columns]
        .sort((a, b) => b.length - a.length)
        .find((column) => name.endsWith(` - ${column}`));
    return {
      ...trace,
      x: convertSamples(trace.x, request.x_column),
      y: convertSamples(trace.y, column),
    };
  });
}
