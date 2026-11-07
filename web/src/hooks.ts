import { useCallback, useEffect, useRef, useState } from 'react';
import type { DailySummary, HistoryPoint } from '../../server/src/analytics';
import type { DriverStatus, Observation, StationInfo } from '../../server/src/types';

export type { DailySummary, HistoryPoint, DriverStatus, Observation, StationInfo };

export interface LiveState {
  stations: StationInfo[];
  latest: Record<string, Observation>;
  summaries: Record<string, DailySummary>;
  status?: DriverStatus;
  driver?: string;
  version?: string;
  /** WebSocket to our own server is open. */
  socketOpen: boolean;
  /** Bumped when the server stored backfilled history, so charts refetch. */
  historyVersion: number;
}

type ServerMessage =
  | {
      type: 'snapshot';
      stations: StationInfo[];
      latest: Record<string, Observation>;
      summaries: Record<string, DailySummary>;
      status: DriverStatus;
      driver: string;
      version?: string;
    }
  | { type: 'stations'; stations: StationInfo[] }
  | { type: 'observation'; observation: Observation; summary?: DailySummary }
  | { type: 'backfill'; stationId: string; count: number; summary?: DailySummary }
  | { type: 'summary'; stationId: string; summary: DailySummary }
  | { type: 'status'; status: DriverStatus };

/** Live connection to the server's /ws feed with automatic reconnect. */
export function useLiveStation(): LiveState {
  const [state, setState] = useState<LiveState>({
    stations: [],
    latest: {},
    summaries: {},
    socketOpen: false,
    historyVersion: 0,
  });

  useEffect(() => {
    let ws: WebSocket | undefined;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        retry = 0;
        setState((s) => ({ ...s, socketOpen: true }));
      };
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        setState((s) => reduce(s, msg));
      };
      ws.onclose = () => {
        setState((s) => ({ ...s, socketOpen: false }));
        if (closed) return;
        const delay = Math.min(30_000, 1_000 * 2 ** retry++);
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return state;
}

function reduce(s: LiveState, msg: ServerMessage): LiveState {
  switch (msg.type) {
    case 'snapshot':
      return {
        ...s,
        stations: msg.stations,
        latest: msg.latest,
        summaries: msg.summaries,
        status: msg.status,
        driver: msg.driver,
        version: msg.version,
        historyVersion: s.historyVersion + 1,
      };
    case 'stations':
      return { ...s, stations: msg.stations };
    case 'observation': {
      const id = msg.observation.stationId;
      return {
        ...s,
        latest: { ...s.latest, [id]: msg.observation },
        summaries: msg.summary ? { ...s.summaries, [id]: msg.summary } : s.summaries,
      };
    }
    case 'backfill':
      return {
        ...s,
        summaries: msg.summary ? { ...s.summaries, [msg.stationId]: msg.summary } : s.summaries,
        historyVersion: s.historyVersion + 1,
      };
    case 'summary':
      return { ...s, summaries: { ...s.summaries, [msg.stationId]: msg.summary } };
    case 'status':
      return { ...s, status: msg.status };
    default:
      return s;
  }
}

export interface History {
  from: number;
  to: number;
  bucketMs: number;
  points: HistoryPoint[];
}

/**
 * Chart history for a station. Fetches on range change / backfill, refreshes
 * every 5 minutes, and appends live readings in between so charts move in realtime.
 */
export function useHistory(stationId: string | undefined, hours: number, version: number, live?: Observation) {
  const [data, setData] = useState<History>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!stationId) return;
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/stations/${encodeURIComponent(stationId)}/history?hours=${hours}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((h: History) => {
        setData(h);
        setError(undefined);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(String(e.message ?? e));
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [stationId, hours, version, tick]);

  // Fold each live reading into the series.
  const lastLive = useRef<number>(0);
  useEffect(() => {
    if (!live || !data || live.stationId !== stationId || live.time <= lastLive.current) return;
    lastLive.current = live.time;
    setData((d) => (d ? appendLive(d, live, hours) : d));
  }, [live, data, stationId, hours]);

  return { data, loading, error };
}

const LIVE_KEYS = [
  'tempF',
  'feelsLikeF',
  'dewPointF',
  'humidity',
  'indoorTempF',
  'indoorHumidity',
  'pressureRelInHg',
  'windSpeedMph',
  'windSpeedAvg10mMph',
  'windGustMph',
  'rainRateInHr',
  'rainDailyIn',
  'rainEventIn',
  'solarWm2',
  'uvIndex',
  'pm25',
] as const;

function appendLive(d: History, obs: Observation, hours: number): History {
  const last = d.points.at(-1);
  if (last && obs.time <= last.t) return d;
  const p: HistoryPoint = { t: obs.time };
  for (const k of LIVE_KEYS) {
    const v = obs.values[k];
    if (typeof v === 'number') p[k] = v;
  }
  const to = Math.max(d.to, obs.time);
  const from = to - hours * 3_600_000;
  // Keep one live point per bucket: replace the trailing point if it's in the same bucket.
  const sameBucket = last && Math.floor(last.t / d.bucketMs) === Math.floor(obs.time / d.bucketMs) && (last as { live?: boolean }).live;
  const base = sameBucket ? d.points.slice(0, -1) : d.points;
  const points = [...base.filter((x) => x.t >= from), Object.assign(p, { live: true })];
  return { ...d, from, to, points };
}

/** Re-render every `ms` (for "updated 12s ago" labels). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** useState backed by localStorage (per-viewer preferences). */
export function useStored<T extends string | number>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return (typeof initial === 'number' ? Number(raw) : raw) as T;
    } catch {
      /* storage unavailable */
    }
    return initial;
  });
  const set = useCallback(
    (nv: T) => {
      setV(nv);
      try {
        localStorage.setItem(key, String(nv));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [v, set];
}
