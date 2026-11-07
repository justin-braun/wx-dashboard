import type { Observation, StationInfo } from '../types.js';
import type { DriverContext, DriverDefinition, StationDriver } from './driver.js';

/**
 * Synthetic station for demos and development: no hardware or API keys needed.
 * Produces smooth diurnal cycles plus noise, and backfills history on start.
 */

const STATION: StationInfo = {
  id: 'simulator',
  name: 'Demo Station',
  driver: 'simulator',
  model: 'Simulated',
  location: 'Nowhere in particular',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

// Deterministic pseudo-noise so backfilled history looks stable between restarts.
function noise(t: number, seed: number): number {
  const x = Math.sin(t / 997_000 + seed) * 10_000;
  return (x - Math.floor(x)) * 2 - 1;
}

function synth(t: number, rainState: { daily: number; event: number; day: number }): Observation {
  const day = new Date(t);
  const hourFrac = (day.getHours() * 60 + day.getMinutes()) / 1440;
  const diurnal = Math.sin((hourFrac - 0.35) * 2 * Math.PI); // peak mid-afternoon
  const weather = Math.sin(t / (3.1 * 86_400_000)); // multi-day swings

  const tempF = 58 + 12 * diurnal + 6 * weather + noise(t, 1) * 0.6;
  const humidity = Math.max(20, Math.min(99, 62 - 20 * diurnal - 10 * weather + noise(t, 2) * 3));
  const dewPointF = tempF - (100 - humidity) / 2.8;
  const windSpeed = Math.max(0, 6 + 4 * diurnal + 3 * noise(t, 3));
  const gust = windSpeed + Math.abs(noise(t, 4)) * 7;
  const sun = Math.max(0, Math.sin((hourFrac - 0.25) * 2 * Math.PI));
  const raining = weather < -0.75;

  const dayKey = Math.floor((t - day.getTimezoneOffset() * 60_000) / 86_400_000);
  if (dayKey !== rainState.day) {
    rainState.day = dayKey;
    rainState.daily = 0;
  }
  const rate = raining ? r2(0.05 + Math.abs(noise(t, 5)) * 0.25) : 0;
  rainState.daily += rate / 720; // 5s ticks are tiny; backfill steps compensate below
  if (raining) rainState.event += rate / 720;
  else rainState.event = 0;

  return {
    stationId: STATION.id,
    time: t,
    values: {
      tempF: r1(tempF),
      feelsLikeF: r1(tempF - (windSpeed > 3 && tempF < 50 ? windSpeed * 0.4 : 0)),
      dewPointF: r1(dewPointF),
      humidity: Math.round(humidity),
      indoorTempF: r1(70 + diurnal * 1.5),
      indoorHumidity: Math.round(42 + weather * 4),
      pressureRelInHg: r2(29.92 + 0.25 * weather + noise(t, 6) * 0.005),
      pressureAbsInHg: r2(29.62 + 0.25 * weather),
      windSpeedMph: r1(windSpeed),
      windGustMph: r1(gust),
      windDirDeg: Math.round((220 + 40 * Math.sin(t / 3_600_000) + noise(t, 7) * 15 + 360) % 360),
      windSpeedAvg10mMph: r1(6 + 4 * diurnal),
      maxDailyGustMph: r1(gust + 4),
      rainRateInHr: rate,
      rainDailyIn: r2(rainState.daily),
      rainEventIn: r2(rainState.event),
      rainMonthlyIn: r2(1.2 + rainState.daily),
      rainYearlyIn: r2(24.6 + rainState.daily),
      solarWm2: r1(sun * (820 - 300 * Math.max(0, -weather))),
      uvIndex: Math.round(sun * 8 * (weather > -0.5 ? 1 : 0.4)),
      lightningDay: raining ? 3 : 0,
      lightningDistanceMi: raining ? 8 : undefined,
    },
    batteries: [
      { id: 'battout', label: 'Outdoor sensor', ok: true },
      { id: 'battin', label: 'Indoor sensor', ok: true },
    ],
  };
}

class SimulatorDriver implements StationDriver {
  readonly type = 'simulator';
  private timer?: NodeJS.Timeout;
  private rain = { daily: 0, event: 0, day: -1 };

  constructor(
    private readonly intervalMs: number,
    private readonly backfillDays: number,
  ) {}

  get expectedIntervalMs(): number {
    return this.intervalMs;
  }

  async start(ctx: DriverContext): Promise<void> {
    ctx.onStations([STATION]);
    const now = Date.now();
    const from = Math.max(ctx.lastStoredTime(STATION.id) ?? 0, now - this.backfillDays * 86_400_000);
    const step = 5 * 60_000;
    const batch: Observation[] = [];
    for (let t = Math.ceil(from / step) * step; t < now; t += step) {
      // Each backfill step stands for 60 five-second ticks of rain accumulation.
      for (let i = 0; i < 59; i++) synth(t, this.rain);
      batch.push(synth(t, this.rain));
    }
    if (batch.length) ctx.onBackfill(batch);
    ctx.onStatus({ state: 'connected', message: 'Simulated feed' });

    const tick = () => ctx.onObservation(synth(Date.now(), this.rain));
    tick();
    this.timer = setInterval(tick, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }
}

export const simulatorDriver: DriverDefinition = {
  type: 'simulator',
  description: 'Synthetic demo data; no hardware required',
  env: [{ name: 'SIMULATOR_INTERVAL_SECONDS', required: false, description: 'Seconds between readings (default 5)' }],
  create(env, { backfillDays }) {
    const secs = Number(env.SIMULATOR_INTERVAL_SECONDS ?? 5);
    return new SimulatorDriver(Math.max(1, Number.isFinite(secs) ? secs : 5) * 1000, backfillDays);
  },
};
