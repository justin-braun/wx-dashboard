import { io, type Socket } from 'socket.io-client';
import type { BatteryStatus, ExtraSensor, Observation, ObservationValues, StationInfo } from '../types.js';
import type { DriverContext, DriverDefinition, StationDriver } from './driver.js';

/**
 * Ambient Weather Network cloud driver.
 *
 * Works with any station that uploads to AmbientWeather.net (WS-2000, WS-2902,
 * WS-5000, ...). Uses the REST API for station discovery and backfill, and the
 * realtime Socket.io API for live updates. A REST poll takes over if the
 * realtime feed goes quiet.
 *
 * Docs: https://ambientweather.docs.apiary.io/
 */

const REST_BASE = 'https://rt.ambientweather.net/v1';
const REALTIME_URL = 'https://rt2.ambientweather.net';
/** The REST device-data endpoint returns 5-minute records, at most 288 per call. */
const PAGE_LIMIT = 288;
/** Ambient allows 1 request/second per API key. */
const REQUEST_SPACING_MS = 1100;
/** If realtime has been silent this long, fall back to polling REST. */
const STALE_AFTER_MS = 5 * 60_000;
const WATCHDOG_INTERVAL_MS = 60_000;

type AmbientRecord = Record<string, unknown> & { dateutc?: number; macAddress?: string };

interface AmbientDevice {
  macAddress: string;
  lastData?: AmbientRecord;
  info?: {
    name?: string;
    location?: string;
    coords?: {
      address?: string;
      location?: string;
      elevation?: number;
      coords?: { lat?: number; lon?: number };
    };
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describeError(msg: string): string {
  if (msg.includes('applicationKey-invalid')) return 'Ambient rejected AMBIENT_APPLICATION_KEY. Check the key at ambientweather.net/account.';
  if (msg.includes('apiKey-invalid') || msg.includes('apiKey-missing'))
    return 'Ambient rejected AMBIENT_API_KEY. Check the key at ambientweather.net/account.';
  return msg;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function time(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

export function stationIdFor(mac: string): string {
  return `ambient-${mac.toLowerCase().replace(/[^0-9a-f]/g, '')}`;
}

/** Translate an Ambient record into the normalized model. Exported for tests. */
export function mapAmbientRecord(stationId: string, d: AmbientRecord): Observation | undefined {
  const t = num(d.dateutc);
  if (t === undefined) return undefined;

  const values: ObservationValues = compact({
    tempF: num(d.tempf),
    feelsLikeF: num(d.feelsLike),
    dewPointF: num(d.dewPoint),
    humidity: num(d.humidity),
    indoorTempF: num(d.tempinf),
    indoorHumidity: num(d.humidityin),
    indoorFeelsLikeF: num(d.feelsLikein),
    indoorDewPointF: num(d.dewPointin),
    pressureRelInHg: num(d.baromrelin),
    pressureAbsInHg: num(d.baromabsin),
    windSpeedMph: num(d.windspeedmph),
    windGustMph: num(d.windgustmph),
    windDirDeg: num(d.winddir),
    windGustDirDeg: num(d.windgustdir),
    windSpeedAvg2mMph: num(d.windspdmph_avg2m),
    windSpeedAvg10mMph: num(d.windspdmph_avg10m),
    windDirAvg10mDeg: num(d.winddir_avg10m),
    maxDailyGustMph: num(d.maxdailygust),
    rainRateInHr: num(d.hourlyrainin),
    rainEventIn: num(d.eventrainin),
    rainDailyIn: num(d.dailyrainin),
    rain24hIn: num(d['24hourrainin']),
    rainWeeklyIn: num(d.weeklyrainin),
    rainMonthlyIn: num(d.monthlyrainin),
    rainYearlyIn: num(d.yearlyrainin),
    lastRain: time(d.lastRain),
    solarWm2: num(d.solarradiation),
    uvIndex: num(d.uv),
    lightningDay: num(d.lightning_day),
    lightningHour: num(d.lightning_hour),
    lightningDistanceMi: num(d.lightning_distance),
    lightningTime: time(d.lightning_time),
    pm25: num(d.pm25),
    pm25Avg24h: num(d.pm25_24h),
    pm25Indoor: num(d.pm25_in),
    pm25IndoorAvg24h: num(d.pm25_in_24h),
    co2Ppm: num(d.co2) ?? num(d.co2_in_aqin),
  });

  const sensors: ExtraSensor[] = [];
  for (let i = 1; i <= 10; i++) {
    const s: ExtraSensor = compact({
      id: `temp${i}`,
      label: `Sensor ${i}`,
      tempF: num(d[`temp${i}f`]),
      humidity: num(d[`humidity${i}`]),
      feelsLikeF: num(d[`feelsLike${i}`]),
      dewPointF: num(d[`dewPoint${i}`]),
    });
    if (s.tempF !== undefined || s.humidity !== undefined) sensors.push(s);
  }

  // Ambient battery fields mostly use 1 = OK, but a few use 1 = low.
  const batteries: BatteryStatus[] = [];
  const okWhenOne: [string, string][] = [
    ['battout', 'Outdoor sensor'],
    ['battin', 'Indoor sensor'],
    ['batt_25', 'PM2.5 sensor'],
    ['batt_co2', 'CO₂ sensor'],
    ['batt_cellgateway', 'Cellular gateway'],
  ];
  for (let i = 1; i <= 10; i++) okWhenOne.push([`batt${i}`, `Sensor ${i}`]);
  for (let i = 1; i <= 4; i++) okWhenOne.push([`battsm${i}`, `Soil sensor ${i}`]);
  for (const [key, label] of okWhenOne) {
    const v = num(d[key]);
    if (v !== undefined) batteries.push({ id: key, label, ok: v === 1 });
  }
  const okWhenZero: [string, string][] = [['batt_lightning', 'Lightning detector']];
  for (let i = 1; i <= 4; i++) okWhenZero.push([`batleak${i}`, `Leak sensor ${i}`]);
  for (const [key, label] of okWhenZero) {
    const v = num(d[key]);
    if (v !== undefined) batteries.push({ id: key, label, ok: v === 0 });
  }

  return {
    stationId,
    time: t,
    values,
    ...(sensors.length ? { sensors } : {}),
    ...(batteries.length ? { batteries } : {}),
  };
}

function toStation(dev: AmbientDevice): StationInfo {
  const info = dev.info ?? {};
  const coords = info.coords ?? {};
  return compact({
    id: stationIdFor(dev.macAddress),
    name: info.name || 'Weather station',
    driver: 'ambient-cloud',
    model: 'Ambient Weather',
    location: coords.location || info.location || coords.address,
    latitude: num(coords.coords?.lat),
    longitude: num(coords.coords?.lon),
    elevationM: num(coords.elevation),
    timezone: typeof dev.lastData?.tz === 'string' ? dev.lastData.tz : undefined,
  });
}

class AmbientCloudDriver implements StationDriver {
  readonly type = 'ambient-cloud';
  /** Stations upload to AmbientWeather.net at most once a minute. */
  readonly expectedIntervalMs = 60_000;
  private socket?: Socket;
  private ctx?: DriverContext;
  private watchdog?: NodeJS.Timeout;
  private stopped = false;
  private lastRealtimeAt = 0;
  private lastRequestAt = 0;
  private devices = new Map<string, AmbientDevice>();

  constructor(
    private readonly apiKey: string,
    private readonly applicationKey: string,
    private readonly macFilter: string[],
    private readonly backfillDays: number,
  ) {}

  async start(ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    ctx.onStatus({ state: 'connecting', message: 'Contacting AmbientWeather.net' });

    // Discovery + catch-up run in the background so a slow/offline cloud never blocks startup.
    void this.bootstrap();
    this.connectRealtime();
    this.watchdog = setInterval(() => void this.checkStale(), WATCHDOG_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.watchdog) clearInterval(this.watchdog);
    this.socket?.disconnect();
  }

  private wanted(mac: string): boolean {
    if (this.macFilter.length === 0) return true;
    const norm = mac.toLowerCase().replace(/[^0-9a-f]/g, '');
    return this.macFilter.includes(norm);
  }

  private async bootstrap(): Promise<void> {
    const ctx = this.ctx!;
    let attempt = 0;
    while (!this.stopped) {
      try {
        await this.refreshDevices();
        break;
      } catch (err) {
        attempt++;
        const delay = Math.min(300_000, 5_000 * 2 ** Math.min(attempt, 6));
        ctx.log.warn({ err: String(err) }, `Ambient device lookup failed; retrying in ${delay / 1000}s`);
        ctx.onStatus({ state: 'error', message: describeError(String(err instanceof Error ? err.message : err)) });
        await sleep(delay);
      }
    }
    for (const dev of this.devices.values()) {
      if (this.stopped) return;
      try {
        await this.backfill(dev);
      } catch (err) {
        ctx.log.warn({ err: String(err) }, `Backfill failed for ${dev.macAddress}`);
      }
    }
  }

  private async request<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const wait = this.lastRequestAt + REQUEST_SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();

    const url = new URL(REST_BASE + path);
    url.searchParams.set('applicationKey', this.applicationKey);
    url.searchParams.set('apiKey', this.apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) {
      await sleep(2_000);
      return this.request(path, params);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ambient API ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  private async refreshDevices(): Promise<void> {
    const ctx = this.ctx!;
    const devices = (await this.request<AmbientDevice[]>('/devices')).filter((d) => this.wanted(d.macAddress));
    if (devices.length === 0) {
      throw new Error(
        this.macFilter.length
          ? 'No device on this account matches AMBIENT_MAC_ADDRESS'
          : 'No devices found on this Ambient Weather account',
      );
    }
    for (const d of devices) this.devices.set(d.macAddress, d);
    ctx.onStations(devices.map(toStation));
    for (const d of devices) {
      if (d.lastData) {
        const obs = mapAmbientRecord(stationIdFor(d.macAddress), d.lastData);
        if (obs) ctx.onObservation(obs);
      }
    }
  }

  /** Page backwards through 5-minute history until we reach what's already stored. */
  private async backfill(dev: AmbientDevice): Promise<void> {
    const ctx = this.ctx!;
    if (this.backfillDays <= 0) return;
    const id = stationIdFor(dev.macAddress);
    const floor = Math.max(ctx.lastStoredTime(id) ?? 0, Date.now() - this.backfillDays * 86_400_000);
    let endDate = Date.now();
    let total = 0;
    const maxPages = Math.ceil(this.backfillDays) + 1;

    for (let page = 0; page < maxPages && !this.stopped; page++) {
      const recs = await this.request<AmbientRecord[]>(`/devices/${encodeURIComponent(dev.macAddress)}`, {
        endDate,
        limit: PAGE_LIMIT,
      });
      if (!recs.length) break;
      const batch: Observation[] = [];
      let oldest = Infinity;
      for (const r of recs) {
        const t = num(r.dateutc);
        if (t === undefined) continue;
        oldest = Math.min(oldest, t);
        if (t <= floor) continue;
        const obs = mapAmbientRecord(id, r);
        if (obs) batch.push(obs);
      }
      if (batch.length) ctx.onBackfill(batch);
      total += batch.length;
      if (oldest <= floor || recs.length < PAGE_LIMIT || !Number.isFinite(oldest)) break;
      endDate = oldest;
    }
    if (total) ctx.log.info(`Backfilled ${total} records for ${dev.info?.name ?? dev.macAddress}`);
  }

  private connectRealtime(): void {
    const ctx = this.ctx!;
    const socket = io(REALTIME_URL, {
      query: { api: '1', applicationKey: this.applicationKey },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 60_000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      ctx.log.info('Ambient realtime connected; subscribing');
      socket.emit('subscribe', { apiKeys: [this.apiKey] });
    });

    socket.on('subscribed', (payload: { devices?: AmbientDevice[] }) => {
      const devices = (payload?.devices ?? []).filter((d) => d?.macAddress && this.wanted(d.macAddress));
      if (devices.length) {
        for (const d of devices) this.devices.set(d.macAddress, { ...this.devices.get(d.macAddress), ...d });
        ctx.onStations(devices.map(toStation));
      }
      if (!devices.length && !this.devices.size) {
        ctx.onStatus({ state: 'error', message: 'Realtime subscription returned no devices. Check AMBIENT_API_KEY.' });
        return;
      }
      this.lastRealtimeAt = Date.now();
      ctx.onStatus({ state: 'connected', message: 'Realtime feed active' });
    });

    socket.on('data', (data: AmbientRecord) => {
      if (!data?.macAddress || !this.wanted(data.macAddress)) return;
      this.lastRealtimeAt = Date.now();
      const obs = mapAmbientRecord(stationIdFor(data.macAddress), data);
      if (obs) ctx.onObservation(obs);
    });

    socket.on('disconnect', (reason) => {
      if (this.stopped) return;
      ctx.log.warn(`Ambient realtime disconnected: ${reason}`);
      ctx.onStatus({ state: 'degraded', message: 'Realtime feed lost; reconnecting' });
    });

    socket.on('connect_error', (err) => {
      ctx.log.warn(`Ambient realtime connect error: ${err.message}`);
      // Before any device is known this is a setup problem (bad keys, no network), not a blip.
      ctx.onStatus({
        state: this.devices.size ? 'degraded' : 'error',
        message: describeError(err.message),
      });
    });
  }

  /** Poll REST when realtime is quiet so the dashboard keeps moving. */
  private async checkStale(): Promise<void> {
    if (this.stopped || !this.ctx || this.devices.size === 0) return;
    if (Date.now() - this.lastRealtimeAt < STALE_AFTER_MS) return;
    try {
      await this.refreshDevices();
      this.ctx.onStatus({ state: 'degraded', message: 'Realtime quiet; polling REST API' });
    } catch (err) {
      this.ctx.onStatus({ state: 'error', message: String(err instanceof Error ? err.message : err) });
    }
  }
}

export const ambientCloudDriver: DriverDefinition = {
  type: 'ambient-cloud',
  description: 'Ambient Weather Network cloud API (REST + realtime)',
  env: [
    { name: 'AMBIENT_API_KEY', required: true, description: 'API key from ambientweather.net/account' },
    { name: 'AMBIENT_APPLICATION_KEY', required: true, description: 'Application key from ambientweather.net/account' },
    {
      name: 'AMBIENT_MAC_ADDRESS',
      required: false,
      description: 'Comma-separated MAC address(es) to show; defaults to all devices on the account',
    },
  ],
  create(env, { backfillDays }) {
    const macs = (env.AMBIENT_MAC_ADDRESS ?? '')
      .split(',')
      .map((m) => m.toLowerCase().replace(/[^0-9a-f]/g, ''))
      .filter(Boolean);
    return new AmbientCloudDriver(env.AMBIENT_API_KEY!, env.AMBIENT_APPLICATION_KEY!, macs, backfillDays);
  },
};
