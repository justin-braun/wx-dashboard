import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Observation, StationInfo } from './types.js';

type Row = { ts: number; data: string };

/**
 * SQLite storage. Observations are stored as JSON documents keyed by
 * (station, time) so new metrics or station models need no migrations.
 */
export class Store {
  private db: Database.Database;
  private stmts;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, 'wx.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stations (
        id TEXT PRIMARY KEY,
        info TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS observations (
        station_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (station_id, ts)
      ) WITHOUT ROWID;
    `);
    this.stmts = {
      upsertStation: this.db.prepare(
        `INSERT INTO stations (id, info, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET info = excluded.info, updated_at = excluded.updated_at`,
      ),
      stations: this.db.prepare(`SELECT info FROM stations ORDER BY updated_at DESC`),
      insert: this.db.prepare(`INSERT OR REPLACE INTO observations (station_id, ts, data) VALUES (?, ?, ?)`),
      latest: this.db.prepare(`SELECT ts, data FROM observations WHERE station_id = ? ORDER BY ts DESC LIMIT 1`),
      lastTime: this.db.prepare(`SELECT MAX(ts) AS ts FROM observations WHERE station_id = ?`),
      range: this.db.prepare(
        `SELECT ts, data FROM observations WHERE station_id = ? AND ts >= ? AND ts <= ? ORDER BY ts`,
      ),
      prune: this.db.prepare(`DELETE FROM observations WHERE ts < ?`),
    };
  }

  upsertStation(s: StationInfo): void {
    this.stmts.upsertStation.run(s.id, JSON.stringify(s), Date.now());
  }

  stations(): StationInfo[] {
    return (this.stmts.stations.all() as { info: string }[]).map((r) => JSON.parse(r.info));
  }

  insert(observations: Observation[]): void {
    const tx = this.db.transaction((list: Observation[]) => {
      for (const o of list) this.stmts.insert.run(o.stationId, o.time, encode(o));
    });
    tx(observations);
  }

  latest(stationId: string): Observation | undefined {
    const row = this.stmts.latest.get(stationId) as Row | undefined;
    return row ? decode(stationId, row) : undefined;
  }

  lastTime(stationId: string): number | undefined {
    const row = this.stmts.lastTime.get(stationId) as { ts: number | null };
    return row.ts ?? undefined;
  }

  range(stationId: string, from: number, to: number): Observation[] {
    return (this.stmts.range.all(stationId, from, to) as Row[]).map((r) => decode(stationId, r));
  }

  prune(before: number): number {
    return this.stmts.prune.run(before).changes;
  }

  close(): void {
    this.db.close();
  }
}

function encode(o: Observation): string {
  return JSON.stringify({ values: o.values, sensors: o.sensors, batteries: o.batteries });
}

function decode(stationId: string, row: Row): Observation {
  const d = JSON.parse(row.data);
  return { stationId, time: row.ts, values: d.values ?? {}, sensors: d.sensors, batteries: d.batteries };
}
