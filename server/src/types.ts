/**
 * Normalized data model shared by every station driver.
 *
 * Drivers translate their vendor-specific payloads into these shapes so the
 * storage layer, API and dashboard never need to know which hardware is
 * attached. Canonical units are imperial (what most consumer stations report
 * natively); the dashboard converts for display.
 */

export interface ObservationValues {
  // Outdoor
  tempF?: number;
  feelsLikeF?: number;
  dewPointF?: number;
  humidity?: number; // %

  // Indoor
  indoorTempF?: number;
  indoorHumidity?: number;
  indoorFeelsLikeF?: number;
  indoorDewPointF?: number;

  // Pressure
  pressureRelInHg?: number;
  pressureAbsInHg?: number;

  // Wind
  windSpeedMph?: number;
  windGustMph?: number;
  windDirDeg?: number;
  windGustDirDeg?: number;
  windSpeedAvg2mMph?: number;
  windSpeedAvg10mMph?: number;
  windDirAvg10mDeg?: number;
  maxDailyGustMph?: number;

  // Rain
  rainRateInHr?: number;
  rainEventIn?: number;
  rainHourlyIn?: number;
  rainDailyIn?: number;
  rain24hIn?: number;
  rainWeeklyIn?: number;
  rainMonthlyIn?: number;
  rainYearlyIn?: number;
  lastRain?: number; // epoch ms

  // Sun
  solarWm2?: number;
  uvIndex?: number;

  // Lightning
  lightningDay?: number;
  lightningHour?: number;
  lightningDistanceMi?: number;
  lightningTime?: number; // epoch ms

  // Air quality
  pm25?: number;
  pm25Avg24h?: number;
  pm25Indoor?: number;
  pm25IndoorAvg24h?: number;
  co2Ppm?: number;
}

export type MetricKey = keyof ObservationValues;

export interface ExtraSensor {
  /** Stable key, e.g. "temp1". */
  id: string;
  label: string;
  tempF?: number;
  humidity?: number;
  feelsLikeF?: number;
  dewPointF?: number;
}

export interface BatteryStatus {
  id: string;
  label: string;
  ok: boolean;
}

export interface Observation {
  stationId: string;
  /** Epoch milliseconds. */
  time: number;
  values: ObservationValues;
  sensors?: ExtraSensor[];
  batteries?: BatteryStatus[];
}

export interface StationInfo {
  id: string;
  name: string;
  driver: string;
  model?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  elevationM?: number;
  /** IANA time zone, used for "today" boundaries. */
  timezone?: string;
}

export type ConnectionState = 'connecting' | 'connected' | 'degraded' | 'disconnected' | 'error';

export interface DriverStatus {
  state: ConnectionState;
  message?: string;
  since: number;
}
