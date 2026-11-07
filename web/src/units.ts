export type UnitSystem = 'imperial' | 'metric';

export type Kind =
  | 'temp'
  | 'tempDelta'
  | 'speed'
  | 'pressure'
  | 'pressureDelta'
  | 'rain'
  | 'rainRate'
  | 'distance'
  | 'percent'
  | 'solar'
  | 'uv'
  | 'pm'
  | 'count';

interface KindSpec {
  convert: (v: number) => number;
  unit: string;
  digits: number;
}

const SPECS: Record<UnitSystem, Record<Kind, KindSpec>> = {
  imperial: {
    temp: { convert: (v) => v, unit: '°F', digits: 1 },
    tempDelta: { convert: (v) => v, unit: '°F', digits: 1 },
    speed: { convert: (v) => v, unit: 'mph', digits: 1 },
    pressure: { convert: (v) => v, unit: 'inHg', digits: 2 },
    pressureDelta: { convert: (v) => v, unit: 'inHg', digits: 2 },
    rain: { convert: (v) => v, unit: 'in', digits: 2 },
    rainRate: { convert: (v) => v, unit: 'in/h', digits: 2 },
    distance: { convert: (v) => v, unit: 'mi', digits: 0 },
    percent: { convert: (v) => v, unit: '%', digits: 0 },
    solar: { convert: (v) => v, unit: 'W/m²', digits: 0 },
    uv: { convert: (v) => v, unit: '', digits: 0 },
    pm: { convert: (v) => v, unit: 'µg/m³', digits: 1 },
    count: { convert: (v) => v, unit: '', digits: 0 },
  },
  metric: {
    temp: { convert: (v) => ((v - 32) * 5) / 9, unit: '°C', digits: 1 },
    tempDelta: { convert: (v) => (v * 5) / 9, unit: '°C', digits: 1 },
    speed: { convert: (v) => v * 1.609344, unit: 'km/h', digits: 1 },
    pressure: { convert: (v) => v * 33.8639, unit: 'hPa', digits: 1 },
    pressureDelta: { convert: (v) => v * 33.8639, unit: 'hPa', digits: 1 },
    rain: { convert: (v) => v * 25.4, unit: 'mm', digits: 1 },
    rainRate: { convert: (v) => v * 25.4, unit: 'mm/h', digits: 1 },
    distance: { convert: (v) => v * 1.609344, unit: 'km', digits: 0 },
    percent: { convert: (v) => v, unit: '%', digits: 0 },
    solar: { convert: (v) => v, unit: 'W/m²', digits: 0 },
    uv: { convert: (v) => v, unit: '', digits: 0 },
    pm: { convert: (v) => v, unit: 'µg/m³', digits: 1 },
    count: { convert: (v) => v, unit: '', digits: 0 },
  },
};

export function spec(kind: Kind, system: UnitSystem): KindSpec {
  return SPECS[system][kind];
}

export function convert(kind: Kind, system: UnitSystem, v: number | undefined): number | undefined {
  return v === undefined || v === null ? undefined : SPECS[system][kind].convert(v);
}

/** Converted value formatted to the kind's precision, or an em dash. */
export function fmt(kind: Kind, system: UnitSystem, v: number | undefined, digits?: number): string {
  const c = convert(kind, system, v);
  if (c === undefined || !Number.isFinite(c)) return '—';
  const d = digits ?? SPECS[system][kind].digits;
  return c.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function unit(kind: Kind, system: UnitSystem): string {
  return SPECS[system][kind].unit;
}
