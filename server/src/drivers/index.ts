import { ambientCloudDriver } from './ambient-cloud.js';
import type { DriverDefinition } from './driver.js';
import { simulatorDriver } from './simulator.js';

/**
 * Registry of supported station drivers. To add a new station model, implement
 * `StationDriver` in a new file that maps its data into the normalized
 * `Observation` model, export a `DriverDefinition`, and add it here.
 */
export const drivers: Record<string, DriverDefinition> = {
  [ambientCloudDriver.type]: ambientCloudDriver,
  [simulatorDriver.type]: simulatorDriver,
};

export type { DriverContext, DriverDefinition, StationDriver } from './driver.js';
