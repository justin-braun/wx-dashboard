const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function cardinal(deg: number | undefined): string {
  if (deg === undefined) return '—';
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export function clockTime(t: number | undefined, timeZone?: string): string {
  if (t === undefined) return '—';
  try {
    return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone });
  } catch {
    return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
}

export function dateTime(t: number, timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone };
  try {
    return new Date(t).toLocaleString(undefined, opts);
  } catch {
    return new Date(t).toLocaleString(undefined, { ...opts, timeZone: undefined });
  }
}

export function ago(t: number | undefined, now: number): string {
  if (t === undefined) return 'never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function uvCategory(uv: number | undefined): { label: string; level: 'good' | 'warning' | 'serious' | 'critical' } | undefined {
  if (uv === undefined) return undefined;
  if (uv < 3) return { label: 'Low', level: 'good' };
  if (uv < 6) return { label: 'Moderate', level: 'warning' };
  if (uv < 8) return { label: 'High', level: 'serious' };
  if (uv < 11) return { label: 'Very high', level: 'critical' };
  return { label: 'Extreme', level: 'critical' };
}

/** US EPA AQI from PM2.5 (µg/m³), using the 2024 breakpoints. */
export function aqiFromPm25(pm: number | undefined): { aqi: number; label: string; level: 'good' | 'warning' | 'serious' | 'critical' } | undefined {
  if (pm === undefined) return undefined;
  const c = Math.floor(pm * 10) / 10;
  const table: [number, number, number, number, string, 'good' | 'warning' | 'serious' | 'critical'][] = [
    [0, 9.0, 0, 50, 'Good', 'good'],
    [9.1, 35.4, 51, 100, 'Moderate', 'warning'],
    [35.5, 55.4, 101, 150, 'Unhealthy for sensitive groups', 'serious'],
    [55.5, 125.4, 151, 200, 'Unhealthy', 'critical'],
    [125.5, 225.4, 201, 300, 'Very unhealthy', 'critical'],
    [225.5, 1000, 301, 500, 'Hazardous', 'critical'],
  ];
  for (const [cl, ch, il, ih, label, level] of table) {
    if (c <= ch) return { aqi: Math.round(((ih - il) / (ch - cl)) * (Math.max(c, cl) - cl) + il), label, level };
  }
  return { aqi: 500, label: 'Hazardous', level: 'critical' };
}
