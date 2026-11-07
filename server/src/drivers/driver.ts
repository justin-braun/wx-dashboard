import type { FastifyBaseLogger } from 'fastify';
import type { DriverStatus, Observation, StationInfo } from '../types.js';

/**
 * Callbacks the app hands to a driver. Drivers push data in; they never touch
 * storage or clients directly.
 */
export interface DriverContext {
  log: FastifyBaseLogger;
  /** Announce (or update) the stations this driver provides. */
  onStations(stations: StationInfo[]): void;
  /** A live reading. */
  onObservation(obs: Observation): void;
  /** Historical readings fetched to fill gaps (stored, not broadcast as live). */
  onBackfill(obs: Observation[]): void;
  onStatus(status: Omit<DriverStatus, 'since'>): void;
  /** Newest stored reading time for a station, so drivers backfill only what's missing. */
  lastStoredTime(stationId: string): number | undefined;
}

export interface StationDriver {
  readonly type: string;
  start(ctx: DriverContext): Promise<void>;
  stop(): Promise<void>;
}

export interface DriverDefinition {
  type: string;
  description: string;
  /** Environment variables this driver reads, for docs and startup validation. */
  env: { name: string; required: boolean; description: string }[];
  create(env: NodeJS.ProcessEnv, settings: { backfillDays: number }): StationDriver;
}
