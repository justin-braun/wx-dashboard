import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Build-time version (set by CI) or the server package version. */
function appVersion(): string {
  if (process.env.APP_VERSION?.trim()) return process.env.APP_VERSION.trim();
  try {
    return JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8')).version ?? 'dev';
  } catch {
    return 'dev';
  }
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got "${raw}")`);
  return n;
}

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  webDir: string;
  driver: string;
  retentionDays: number;
  backfillDays: number;
  storeIntervalMs: number;
  logLevel: string;
  version: string;
}

export function loadConfig(): AppConfig {
  return {
    host: process.env.HOST ?? '0.0.0.0',
    port: int('PORT', 8080),
    dataDir: process.env.DATA_DIR ?? path.resolve(here, '../../data'),
    webDir: process.env.WEB_DIR ?? path.resolve(here, '../../web/dist'),
    driver: (process.env.STATION_DRIVER ?? 'ambient-cloud').trim(),
    retentionDays: int('RETENTION_DAYS', 365),
    backfillDays: int('BACKFILL_DAYS', 7),
    storeIntervalMs: int('STORE_INTERVAL_SECONDS', 60) * 1000,
    logLevel: process.env.LOG_LEVEL ?? 'info',
    version: appVersion(),
  };
}
