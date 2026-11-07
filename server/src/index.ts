import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { downsample, startOfDay, summarize, type DailySummary } from './analytics.js';
import { loadConfig } from './config.js';
import { Store } from './db.js';
import { drivers, type StationDriver } from './drivers/index.js';
import type { DriverStatus, Observation, StationInfo } from './types.js';

const config = loadConfig();
const app = Fastify({ logger: { level: config.logLevel } });
const store = new Store(config.dataDir);

// ---------------------------------------------------------------- state

const stations = new Map<string, StationInfo>();
for (const s of store.stations()) stations.set(s.id, s);

const latest = new Map<string, Observation>();
const lastStoredAt = new Map<string, number>();
const summaries = new Map<string, DailySummary>();
for (const id of stations.keys()) {
  const obs = store.latest(id);
  if (obs) {
    latest.set(id, obs);
    lastStoredAt.set(id, obs.time);
  }
}

let status: DriverStatus = { state: 'connecting', since: Date.now() };

function computeSummary(stationId: string): DailySummary | undefined {
  const obs = latest.get(stationId);
  if (!obs) return undefined;
  const tz = stations.get(stationId)?.timezone;
  const dayStart = startOfDay(obs.time, tz);
  const from = Math.min(dayStart, obs.time - 3.5 * 3_600_000);
  const s = summarize(store.range(stationId, from, obs.time), obs, dayStart);
  summaries.set(stationId, s);
  return s;
}
for (const id of latest.keys()) computeSummary(id);

// ---------------------------------------------------------------- clients

const clients = new Set<WebSocket>();

function broadcast(msg: unknown): void {
  const data = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
}

function snapshot() {
  return {
    type: 'snapshot',
    stations: [...stations.values()],
    latest: Object.fromEntries(latest),
    summaries: Object.fromEntries(summaries),
    status,
    driver: config.driver,
    version: config.version,
  };
}

// ---------------------------------------------------------------- driver

const ctx = {
  log: app.log,
  onStations(list: StationInfo[]) {
    for (const s of list) {
      stations.set(s.id, { ...stations.get(s.id), ...s });
      store.upsertStation(stations.get(s.id)!);
    }
    broadcast({ type: 'stations', stations: [...stations.values()] });
  },
  onObservation(obs: Observation) {
    const prev = latest.get(obs.stationId);
    if (prev && obs.time < prev.time) return; // stale (e.g. REST poll behind realtime)
    latest.set(obs.stationId, obs);

    // Store at most once per interval; broadcast every reading.
    const last = lastStoredAt.get(obs.stationId) ?? 0;
    if (obs.time - last >= config.storeIntervalMs) {
      store.insert([obs]);
      lastStoredAt.set(obs.stationId, obs.time);
    }
    const summary = computeSummary(obs.stationId);
    broadcast({ type: 'observation', observation: obs, summary });
  },
  onBackfill(list: Observation[]) {
    if (!list.length) return;
    store.insert(list);
    const id = list[0].stationId;
    const newest = list.reduce((a, b) => (b.time > a.time ? b : a));
    lastStoredAt.set(id, Math.max(lastStoredAt.get(id) ?? 0, newest.time));
    if (!latest.has(id) || newest.time > latest.get(id)!.time) latest.set(id, newest);
    const summary = computeSummary(id);
    broadcast({ type: 'backfill', stationId: id, count: list.length, summary });
  },
  onStatus(s: Omit<DriverStatus, 'since'>) {
    if (s.state === status.state && s.message === status.message) return;
    status = { ...s, since: Date.now() };
    broadcast({ type: 'status', status });
  },
  lastStoredTime: (id: string) => store.lastTime(id),
};

let driver: StationDriver | undefined;

async function startDriver(): Promise<void> {
  const def = drivers[config.driver];
  if (!def) {
    const msg = `Unknown STATION_DRIVER "${config.driver}". Available: ${Object.keys(drivers).join(', ')}`;
    app.log.error(msg);
    ctx.onStatus({ state: 'error', message: msg });
    return;
  }
  const missing = def.env.filter((e) => e.required && !process.env[e.name]?.trim()).map((e) => e.name);
  if (missing.length) {
    const msg = `Missing required setting(s) for ${def.type}: ${missing.join(', ')}`;
    app.log.error(msg);
    ctx.onStatus({ state: 'error', message: msg });
    return;
  }
  driver = def.create(process.env, { backfillDays: config.backfillDays });
  app.log.info(`wx-dashboard ${config.version} starting driver: ${def.type} (${def.description})`);
  await driver.start(ctx);
}

// ---------------------------------------------------------------- routes

await app.register(fastifyWebsocket);

app.get('/ws', { websocket: true }, (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify(snapshot()));
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
});

app.get('/api/health', async () => ({
  ok: true,
  version: config.version,
  driver: config.driver,
  status,
  stations: stations.size,
  clients: clients.size,
}));

app.get('/api/stations', async () => [...stations.values()]);

app.get<{ Params: { id: string } }>('/api/stations/:id/current', async (req, reply) => {
  const obs = latest.get(req.params.id);
  if (!obs) return reply.code(404).send({ error: 'No data for station' });
  return { observation: obs, summary: summaries.get(req.params.id) };
});

app.get<{ Params: { id: string }; Querystring: { hours?: string } }>(
  '/api/stations/:id/history',
  async (req, reply) => {
    if (!stations.has(req.params.id)) return reply.code(404).send({ error: 'Unknown station' });
    const hours = Math.min(24 * 31, Math.max(1, Number(req.query.hours ?? 24) || 24));
    const to = Date.now();
    const from = to - hours * 3_600_000;
    const rows = store.range(req.params.id, from, to);
    const live = latest.get(req.params.id);
    if (live && live.time > (rows.at(-1)?.time ?? 0) && live.time >= from) rows.push(live);
    return { from, to, ...downsample(rows, from, to) };
  },
);

if (fs.existsSync(path.join(config.webDir, 'index.html'))) {
  await app.register(fastifyStatic, { root: config.webDir, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });
} else {
  app.log.warn(`Web build not found at ${config.webDir}; serving API only`);
}

// ---------------------------------------------------------------- lifecycle

const pingTimer = setInterval(() => {
  for (const ws of clients) if (ws.readyState === ws.OPEN) ws.ping();
}, 30_000);

const pruneTimer = setInterval(
  () => {
    if (config.retentionDays <= 0) return;
    const removed = store.prune(Date.now() - config.retentionDays * 86_400_000);
    if (removed) app.log.info(`Pruned ${removed} observations older than ${config.retentionDays} days`);
  },
  6 * 3_600_000,
);

// Roll daily summaries over at midnight even if no new data arrives.
const midnightTimer = setInterval(() => {
  for (const [id, s] of summaries) {
    const tz = stations.get(id)?.timezone;
    if (startOfDay(Date.now(), tz) !== s.dayStart) {
      const fresh = computeSummary(id);
      if (fresh) broadcast({ type: 'summary', stationId: id, summary: fresh });
    }
  }
}, 60_000);

async function shutdown(signal: string) {
  app.log.info(`${signal} received, shutting down`);
  clearInterval(pingTimer);
  clearInterval(pruneTimer);
  clearInterval(midnightTimer);
  await driver?.stop().catch(() => {});
  await app.close().catch(() => {});
  store.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
startDriver().catch((err) => {
  app.log.error(err, 'Driver failed to start');
  ctx.onStatus({ state: 'error', message: String(err?.message ?? err) });
});
