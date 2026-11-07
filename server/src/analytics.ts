import type { MetricKey, Observation } from './types.js';

/** Epoch ms of local midnight in the given IANA time zone. */
export function startOfDay(now: number, timeZone?: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(now));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const elapsed = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + (now % 1000);
    return now - elapsed;
  } catch {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
}

export interface Extreme {
  value: number;
  time: number;
}

export interface DailySummary {
  dayStart: number;
  tempHigh?: Extreme;
  tempLow?: Extreme;
  humidityHigh?: Extreme;
  humidityLow?: Extreme;
  indoorTempHigh?: Extreme;
  indoorTempLow?: Extreme;
  indoorHumidityHigh?: Extreme;
  indoorHumidityLow?: Extreme;
  pressureHigh?: Extreme;
  pressureLow?: Extreme;
  gustMax?: Extreme;
  rainRateMax?: Extreme;
  solarMax?: Extreme;
  uvMax?: Extreme;
  /** Change in °F over the last hour. */
  tempChange1h?: number;
  /** Change in inHg over the last 3 hours. */
  pressureChange3h?: number;
  pressureTrend?: 'rising' | 'falling' | 'steady';
}

function extreme(rows: Observation[], key: MetricKey, pick: 'max' | 'min'): Extreme | undefined {
  let best: Extreme | undefined;
  for (const r of rows) {
    const v = r.values[key];
    if (typeof v !== 'number') continue;
    if (!best || (pick === 'max' ? v > best.value : v < best.value)) best = { value: v, time: r.time };
  }
  return best;
}

/** Value of `key` from the reading nearest to `target`, within `toleranceMs`. */
function valueNear(rows: Observation[], key: MetricKey, target: number, toleranceMs: number): number | undefined {
  let best: { d: number; v: number } | undefined;
  for (const r of rows) {
    const v = r.values[key];
    if (typeof v !== 'number') continue;
    const d = Math.abs(r.time - target);
    if (d <= toleranceMs && (!best || d < best.d)) best = { d, v };
  }
  return best?.v;
}

/**
 * `rows` must cover at least since local midnight and the last 3 hours.
 * `latest` is the current reading (it may not be stored yet).
 */
export function summarize(rows: Observation[], latest: Observation, dayStart: number): DailySummary {
  const today = rows.filter((r) => r.time >= dayStart);
  if (latest.time >= dayStart && !today.some((r) => r.time === latest.time)) today.push(latest);

  const s: DailySummary = {
    dayStart,
    tempHigh: extreme(today, 'tempF', 'max'),
    tempLow: extreme(today, 'tempF', 'min'),
    humidityHigh: extreme(today, 'humidity', 'max'),
    humidityLow: extreme(today, 'humidity', 'min'),
    indoorTempHigh: extreme(today, 'indoorTempF', 'max'),
    indoorTempLow: extreme(today, 'indoorTempF', 'min'),
    indoorHumidityHigh: extreme(today, 'indoorHumidity', 'max'),
    indoorHumidityLow: extreme(today, 'indoorHumidity', 'min'),
    pressureHigh: extreme(today, 'pressureRelInHg', 'max'),
    pressureLow: extreme(today, 'pressureRelInHg', 'min'),
    gustMax: extreme(today, 'windGustMph', 'max'),
    rainRateMax: extreme(today, 'rainRateInHr', 'max'),
    solarMax: extreme(today, 'solarWm2', 'max'),
    uvMax: extreme(today, 'uvIndex', 'max'),
  };

  // Prefer the station's own daily max gust when it reports one.
  const stationGust = latest.values.maxDailyGustMph;
  if (typeof stationGust === 'number' && (!s.gustMax || stationGust > s.gustMax.value)) {
    s.gustMax = { value: stationGust, time: s.gustMax?.time ?? latest.time };
  }

  const t1h = valueNear(rows, 'tempF', latest.time - 3_600_000, 15 * 60_000);
  if (t1h !== undefined && latest.values.tempF !== undefined) s.tempChange1h = round(latest.values.tempF - t1h, 1);

  const p3h = valueNear(rows, 'pressureRelInHg', latest.time - 3 * 3_600_000, 20 * 60_000);
  const p = latest.values.pressureRelInHg;
  if (p3h !== undefined && p !== undefined) {
    const d = round(p - p3h, 3);
    s.pressureChange3h = d;
    // ~0.02 inHg (0.7 hPa) per 3h is the conventional "steady" band.
    s.pressureTrend = d >= 0.02 ? 'rising' : d <= -0.02 ? 'falling' : 'steady';
  }
  return s;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Metrics exposed to history charts, and how to combine readings within a bucket. */
const HISTORY_METRICS: Partial<Record<MetricKey, 'avg' | 'max'>> = {
  tempF: 'avg',
  feelsLikeF: 'avg',
  dewPointF: 'avg',
  humidity: 'avg',
  indoorTempF: 'avg',
  indoorHumidity: 'avg',
  pressureRelInHg: 'avg',
  windSpeedMph: 'avg',
  windSpeedAvg10mMph: 'avg',
  windGustMph: 'max',
  rainRateInHr: 'max',
  rainDailyIn: 'max',
  rainEventIn: 'max',
  solarWm2: 'avg',
  uvIndex: 'max',
  pm25: 'avg',
};

export type HistoryPoint = { t: number } & Partial<Record<MetricKey, number>>;

/** Average/max readings into evenly spaced buckets so charts get a bounded point count. */
export function downsample(rows: Observation[], from: number, to: number, maxPoints = 400) {
  const minute = 60_000;
  const bucketMs = Math.max(minute, Math.ceil((to - from) / maxPoints / minute) * minute);
  const buckets = new Map<number, Observation[]>();
  for (const r of rows) {
    const b = Math.floor(r.time / bucketMs) * bucketMs;
    let list = buckets.get(b);
    if (!list) buckets.set(b, (list = []));
    list.push(r);
  }

  const points: HistoryPoint[] = [];
  for (const [b, list] of [...buckets.entries()].sort((a, z) => a[0] - z[0])) {
    const p: HistoryPoint = { t: list.length === 1 ? list[0].time : b + bucketMs / 2 };
    for (const [key, mode] of Object.entries(HISTORY_METRICS) as [MetricKey, 'avg' | 'max'][]) {
      let sum = 0;
      let n = 0;
      let max = -Infinity;
      for (const r of list) {
        const v = r.values[key];
        if (typeof v !== 'number') continue;
        sum += v;
        n++;
        if (v > max) max = v;
      }
      if (n) p[key] = mode === 'max' ? max : round(sum / n, 2);
    }
    points.push(p);
  }
  return { bucketMs, points };
}
