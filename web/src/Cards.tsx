import type { ReactNode } from 'react';
import type { DailySummary, Observation } from './hooks';
import { aqiFromPm25, ago, cardinal, clockTime, uvCategory } from './format';
import { fmt, unit, type Kind, type UnitSystem } from './units';

type Level = 'good' | 'warning' | 'serious' | 'critical';

interface CardProps {
  title: string;
  children: ReactNode;
  className?: string;
  aside?: ReactNode;
}

export function Card({ title, children, className = '', aside }: CardProps) {
  return (
    <section className={`card ${className}`}>
      <header className="card-head">
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Value({ kind, system, v, big, digits }: { kind: Kind; system: UnitSystem; v?: number; big?: boolean; digits?: number }) {
  return (
    <span className={big ? 'value value-big' : 'value'}>
      {fmt(kind, system, v, digits)}
      {v !== undefined && unit(kind, system) && <span className="value-unit">{unit(kind, system)}</span>}
    </span>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{children}</div>
    </div>
  );
}

export function StatusIcon({ level }: { level: Level | 'muted' }) {
  // Shape differs per level so state never rides on color alone.
  const common = { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true, className: `status-icon ${level}` };
  if (level === 'good') return <svg {...common}><circle cx="7" cy="7" r="6" /><path d="M4 7.2l2 2 4-4.4" className="glyph" /></svg>;
  if (level === 'warning' || level === 'serious') return <svg {...common}><path d="M7 1.2 13 12.5H1z" /><path d="M7 5v3.6M7 10.2v.1" className="glyph" /></svg>;
  if (level === 'critical') return <svg {...common}><circle cx="7" cy="7" r="6" /><path d="M4.6 4.6l4.8 4.8M9.4 4.6l-4.8 4.8" className="glyph" /></svg>;
  return <svg {...common}><circle cx="7" cy="7" r="5" /></svg>;
}

export function Badge({ level, children }: { level: Level; children: ReactNode }) {
  return (
    <span className="badge">
      <StatusIcon level={level} />
      {children}
    </span>
  );
}

function Trend({ delta, kind, system, threshold }: { delta?: number; kind: Kind; system: UnitSystem; threshold: number }) {
  if (delta === undefined) return null;
  const dir = delta > threshold ? 'up' : delta < -threshold ? 'down' : 'flat';
  const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→';
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  return (
    <span className="trend">
      <span aria-hidden="true">{arrow}</span> {sign}
      {fmt(kind, system, Math.abs(delta))} {unit(kind, system)}
    </span>
  );
}

// ---------------------------------------------------------------- hero

export function TemperatureCard({ obs, summary, system }: { obs: Observation; summary?: DailySummary; system: UnitSystem }) {
  const v = obs.values;
  const showFeels = v.feelsLikeF !== undefined && v.tempF !== undefined && Math.abs(v.feelsLikeF - v.tempF) >= 0.5;
  return (
    <Card title="Outdoor" className="card-hero">
      <div className="hero">
        <Value kind="temp" system={system} v={v.tempF} big />
        <div className="hero-side">
          {summary?.tempChange1h !== undefined && (
            <div className="hero-trend">
              <Trend delta={summary.tempChange1h} kind="tempDelta" system={system} threshold={0.2} />
              <span className="muted"> last hour</span>
            </div>
          )}
          <div className="secondary">
            Feels like <strong>{showFeels ? `${fmt('temp', system, v.feelsLikeF)}${unit('temp', system)}` : 'the same'}</strong>
          </div>
        </div>
      </div>
      <div className="stats">
        <Stat label="High today">
          <Value kind="temp" system={system} v={summary?.tempHigh?.value} />
          <span className="when">{clockTime(summary?.tempHigh?.time)}</span>
        </Stat>
        <Stat label="Low today">
          <Value kind="temp" system={system} v={summary?.tempLow?.value} />
          <span className="when">{clockTime(summary?.tempLow?.time)}</span>
        </Stat>
        <Stat label="Humidity">
          <Value kind="percent" system={system} v={v.humidity} />
        </Stat>
        <Stat label="Dew point">
          <Value kind="temp" system={system} v={v.dewPointF} />
        </Stat>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- wind

function Compass({ dir, gustDir, speed, system }: { dir?: number; gustDir?: number; speed?: number; system: UnitSystem }) {
  const size = 168;
  const c = size / 2;
  const r = c - 14;
  const pt = (deg: number, rad: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [c + rad * Math.cos(a), c + rad * Math.sin(a)] as const;
  };
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5);
  const marker = (deg: number, cls: string, len: number) => {
    const [tx, ty] = pt(deg, r - 2);
    const [lx, ly] = pt(deg - 7, r + len);
    const [rx, ry] = pt(deg + 7, r + len);
    return <path className={cls} d={`M${tx},${ty}L${lx},${ly}L${rx},${ry}Z`} />;
  };
  return (
    <svg className="compass" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={dir !== undefined ? `Wind from ${cardinal(dir)} (${Math.round(dir)} degrees)` : 'Wind direction unavailable'}>
      <circle cx={c} cy={c} r={r} className="compass-ring" />
      {ticks.map((d) => {
        const major = d % 90 === 0;
        const mid = d % 45 === 0;
        const [x1, y1] = pt(d, r - (major ? 9 : mid ? 7 : 4));
        const [x2, y2] = pt(d, r);
        return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} className={major || mid ? 'compass-tick major' : 'compass-tick'} />;
      })}
      {(['N', 'E', 'S', 'W'] as const).map((l, i) => {
        const [x, y] = pt(i * 90, r - 30);
        return <text key={l} x={x} y={y} dy="0.35em" textAnchor="middle" className="compass-label">{l}</text>;
      })}
      {gustDir !== undefined && marker(gustDir, 'compass-gust', -12)}
      {dir !== undefined && marker(dir, 'compass-needle', -18)}
      <text x={c} y={c - 2} textAnchor="middle" className="compass-speed">{fmt('speed', system, speed, 0)}</text>
      <text x={c} y={c + 16} textAnchor="middle" className="compass-unit">{unit('speed', system)}</text>
    </svg>
  );
}

export function WindCard({ obs, summary, system }: { obs: Observation; summary?: DailySummary; system: UnitSystem }) {
  const v = obs.values;
  return (
    <Card title="Wind" className="card-wind">
      <div className="wind">
        <Compass dir={v.windDirDeg} gustDir={v.windGustDirDeg} speed={v.windSpeedMph} system={system} />
        <div className="stats stats-col">
          <Stat label="Direction">
            <span className="value">{cardinal(v.windDirDeg)}</span>
            <span className="when">{v.windDirDeg !== undefined ? `${Math.round(v.windDirDeg)}°` : ''}</span>
          </Stat>
          <Stat label="Gust"><Value kind="speed" system={system} v={v.windGustMph} /></Stat>
          {v.windSpeedAvg10mMph !== undefined && (
            <Stat label="10-min average"><Value kind="speed" system={system} v={v.windSpeedAvg10mMph} /></Stat>
          )}
          <Stat label="Max gust today">
            <Value kind="speed" system={system} v={summary?.gustMax?.value} />
          </Stat>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- pressure

export function PressureCard({ obs, summary, system }: { obs: Observation; summary?: DailySummary; system: UnitSystem }) {
  const trend = summary?.pressureTrend;
  return (
    <Card title="Pressure">
      <Value kind="pressure" system={system} v={obs.values.pressureRelInHg} big />
      <div className="secondary">
        {trend ? (
          <>
            <span className="trend-word">{trend[0].toUpperCase() + trend.slice(1)}</span>{' '}
            <Trend delta={summary?.pressureChange3h} kind="pressureDelta" system={system} threshold={0.019} />
            <span className="muted"> in 3 h</span>
          </>
        ) : (
          <span className="muted">Trend available after 3 h of data</span>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- rain

export function RainCard({ obs, system, now }: { obs: Observation; system: UnitSystem; now: number }) {
  const v = obs.values;
  const raining = (v.rainRateInHr ?? 0) > 0;
  return (
    <Card title="Rain" aside={raining ? <Badge level="warning">Raining</Badge> : undefined}>
      <div className="split">
        <div>
          <div className="stat-label">Today</div>
          <Value kind="rain" system={system} v={v.rainDailyIn} big />
        </div>
        <div>
          <div className="stat-label">Rate</div>
          <Value kind="rainRate" system={system} v={v.rainRateInHr} />
        </div>
      </div>
      <div className="stats">
        {v.rainEventIn !== undefined && <Stat label="Event"><Value kind="rain" system={system} v={v.rainEventIn} /></Stat>}
        {v.rainWeeklyIn !== undefined && <Stat label="Week"><Value kind="rain" system={system} v={v.rainWeeklyIn} /></Stat>}
        {v.rainMonthlyIn !== undefined && <Stat label="Month"><Value kind="rain" system={system} v={v.rainMonthlyIn} /></Stat>}
        {v.rainYearlyIn !== undefined && <Stat label="Year"><Value kind="rain" system={system} v={v.rainYearlyIn} /></Stat>}
      </div>
      {v.lastRain !== undefined && <div className="footnote">Last rain {ago(v.lastRain, now)}</div>}
    </Card>
  );
}

// ---------------------------------------------------------------- sun

function Meter({ fraction, level, label }: { fraction: number; level: Level; label: string }) {
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
      <div className={`meter-fill ${level}`} style={{ width: `${Math.max(2, Math.min(100, fraction * 100))}%` }} />
    </div>
  );
}

export function SunCard({ obs, summary, system }: { obs: Observation; summary?: DailySummary; system: UnitSystem }) {
  const v = obs.values;
  const uv = uvCategory(v.uvIndex);
  if (v.uvIndex === undefined && v.solarWm2 === undefined) return null;
  return (
    <Card title="Sun">
      {v.uvIndex !== undefined && uv && (
        <div className="uv">
          <div className="split">
            <div>
              <div className="stat-label">UV index</div>
              <span className="value value-big">{v.uvIndex}</span>
            </div>
            <Badge level={uv.level}>{uv.label}</Badge>
          </div>
          <Meter fraction={v.uvIndex / 11} level={uv.level} label={`UV index ${v.uvIndex} of 11`} />
        </div>
      )}
      <div className="stats">
        <Stat label="Solar radiation"><Value kind="solar" system={system} v={v.solarWm2} /></Stat>
        <Stat label="Peak today"><Value kind="solar" system={system} v={summary?.solarMax?.value} /></Stat>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- indoor & extras

export function IndoorCard({ obs, system }: { obs: Observation; system: UnitSystem }) {
  const v = obs.values;
  if (v.indoorTempF === undefined && v.indoorHumidity === undefined) return null;
  return (
    <Card title="Indoor">
      <Value kind="temp" system={system} v={v.indoorTempF} big />
      <div className="stats">
        <Stat label="Humidity"><Value kind="percent" system={system} v={v.indoorHumidity} /></Stat>
        {v.indoorDewPointF !== undefined && <Stat label="Dew point"><Value kind="temp" system={system} v={v.indoorDewPointF} /></Stat>}
      </div>
    </Card>
  );
}

export function SensorsCard({ obs, system }: { obs: Observation; system: UnitSystem }) {
  if (!obs.sensors?.length) return null;
  return (
    <Card title="Sensors">
      <table className="mini-table">
        <tbody>
          {obs.sensors.map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.label}</th>
              <td><Value kind="temp" system={system} v={s.tempF} /></td>
              <td><Value kind="percent" system={system} v={s.humidity} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function LightningCard({ obs, system, now }: { obs: Observation; system: UnitSystem; now: number }) {
  const v = obs.values;
  if (v.lightningDay === undefined) return null;
  const recent = v.lightningTime !== undefined && now - v.lightningTime < 30 * 60_000;
  return (
    <Card title="Lightning" aside={recent ? <Badge level="serious">Nearby activity</Badge> : undefined}>
      <div className="split">
        <div>
          <div className="stat-label">Strikes today</div>
          <span className="value value-big">{v.lightningDay}</span>
        </div>
        {v.lightningHour !== undefined && (
          <div>
            <div className="stat-label">Last hour</div>
            <span className="value">{v.lightningHour}</span>
          </div>
        )}
      </div>
      <div className="stats">
        {v.lightningDistanceMi !== undefined && (
          <Stat label="Last distance"><Value kind="distance" system={system} v={v.lightningDistanceMi} /></Stat>
        )}
        {v.lightningTime !== undefined && <Stat label="Last strike"><span className="value">{ago(v.lightningTime, now)}</span></Stat>}
      </div>
    </Card>
  );
}

export function AirCard({ obs, system }: { obs: Observation; system: UnitSystem }) {
  const v = obs.values;
  if (v.pm25 === undefined && v.pm25Indoor === undefined && v.co2Ppm === undefined) return null;
  const pm = v.pm25 ?? v.pm25Indoor;
  const aqi = aqiFromPm25(pm);
  return (
    <Card title="Air quality" aside={aqi ? <Badge level={aqi.level}>{aqi.label}</Badge> : undefined}>
      {aqi && (
        <div>
          <div className="stat-label">AQI (PM2.5{v.pm25 === undefined ? ', indoor' : ''})</div>
          <span className="value value-big">{aqi.aqi}</span>
        </div>
      )}
      <div className="stats">
        {pm !== undefined && <Stat label="PM2.5"><Value kind="pm" system={system} v={pm} /></Stat>}
        {v.pm25Avg24h !== undefined && <Stat label="24 h average"><Value kind="pm" system={system} v={v.pm25Avg24h} /></Stat>}
        {v.co2Ppm !== undefined && <Stat label="CO₂"><span className="value">{Math.round(v.co2Ppm)}<span className="value-unit">ppm</span></span></Stat>}
      </div>
    </Card>
  );
}
