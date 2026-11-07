import { useEffect, useMemo, useState } from 'react';
import {
  AirCard,
  IndoorCard,
  LightningCard,
  PressureCard,
  RainCard,
  SensorsCard,
  StatusIcon,
  SunCard,
  TemperatureCard,
  WindCard,
} from './Cards';
import { ago, dateTime } from './format';
import { useHistory, useLiveStation, useNow, useStored, type History, type LiveState, type Observation } from './hooks';
import { LineChart, type ChartPoint, type ChartSeries } from './LineChart';
import { convert, spec, unit, type Kind, type UnitSystem } from './units';

type Theme = 'auto' | 'light' | 'dark';
const STALE_MS = 10 * 60_000;
const RANGES = [
  { hours: 6, label: '6 h' },
  { hours: 24, label: '24 h' },
  { hours: 48, label: '48 h' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
];

export function App() {
  const live = useLiveStation();
  const now = useNow();
  const [system, setSystem] = useStored<UnitSystem>('wx.units', 'imperial');
  const [theme, setTheme] = useStored<Theme>('wx.theme', 'auto');
  const [hours, setHours] = useStored<number>('wx.hours', 24);
  const [stationPref, setStationPref] = useStored<string>('wx.station', '');

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  const station = live.stations.find((s) => s.id === stationPref) ?? live.stations[0];
  const obs = station ? live.latest[station.id] : undefined;
  const summary = station ? live.summaries[station.id] : undefined;
  const history = useHistory(station?.id, hours, live.historyVersion, obs);

  useEffect(() => {
    document.title = station ? `${station.name} · Weather` : 'Weather Station';
  }, [station]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>{station?.name ?? 'Weather Station'}</h1>
          {station?.location && <span className="muted">{station.location}</span>}
        </div>
        <ConnectionPill live={live} obs={obs} now={now} />
        <div className="controls">
          {live.stations.length > 1 && (
            <select aria-label="Station" value={station?.id} onChange={(e) => setStationPref(e.target.value)}>
              {live.stations.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <Segmented
            label="Units"
            value={system}
            onChange={setSystem}
            options={[
              { value: 'imperial', label: '°F' },
              { value: 'metric', label: '°C' },
            ]}
          />
          <Segmented
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
      </header>

      {!obs ? (
        <EmptyState live={live} />
      ) : (
        <main>
          <BatteryNotice obs={obs} />
          <div className="grid">
            <TemperatureCard obs={obs} summary={summary} system={system} />
            <WindCard obs={obs} summary={summary} system={system} />
            <PressureCard obs={obs} summary={summary} system={system} />
            <RainCard obs={obs} system={system} now={now} />
            <SunCard obs={obs} summary={summary} system={system} />
            <IndoorCard obs={obs} system={system} />
            <LightningCard obs={obs} system={system} now={now} />
            <AirCard obs={obs} system={system} />
            <SensorsCard obs={obs} system={system} />
          </div>

          <section className="history">
            <div className="history-head">
              <h2>History</h2>
              <Segmented
                label="Time range"
                value={hours}
                onChange={setHours}
                options={RANGES.map((r) => ({ value: r.hours, label: r.label }))}
              />
            </div>
            {history.error && !history.data && <p className="muted">Could not load history: {history.error}</p>}
            {history.data && (
              <div className={`charts ${history.loading ? 'is-loading' : ''}`}>
                {CHARTS.map((c) => (
                  <ChartCard key={c.title} def={c} history={history.data!} system={system} />
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      <footer className="footer muted">
        {live.driver && <span>Source: {live.driver === 'ambient-cloud' ? 'Ambient Weather Network' : live.driver}</span>}
        {obs && <span>Observation time {dateTime(obs.time)}</span>}
        {live.version && <span>wx-dashboard {/^\d/.test(live.version) ? `v${live.version}` : live.version}</span>}
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- header pieces

function ConnectionPill({ live, obs, now }: { live: LiveState; obs?: Observation; now: number }) {
  const age = obs ? now - obs.time : undefined;
  let level: 'good' | 'warning' | 'serious' | 'critical' | 'muted';
  let text: string;
  let title = live.status?.message ?? '';
  if (!live.socketOpen) {
    level = 'serious';
    text = 'Reconnecting to server';
  } else if (live.status?.state === 'error') {
    level = 'critical';
    text = 'Station error';
  } else if (age !== undefined && age > STALE_MS) {
    level = 'warning';
    text = `Stale · ${ago(obs!.time, now)}`;
  } else if (live.status?.state === 'degraded') {
    level = 'warning';
    text = `Polling · ${ago(obs?.time, now)}`;
  } else if (obs && live.status?.state === 'connected') {
    level = 'good';
    text = `Live · ${ago(obs.time, now)}`;
  } else {
    level = 'muted';
    text = 'Connecting';
  }
  if (!title) title = text;
  return (
    <div className={`pill pill-${level}`} title={title} role="status">
      <StatusIcon level={level} />
      <span>{text}</span>
    </div>
  );
}

interface SegOption<T> {
  value: T;
  label: string;
}

function Segmented<T extends string | number>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: SegOption<T>[] }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function EmptyState({ live }: { live: LiveState }) {
  const err = live.status?.state === 'error';
  return (
    <main className="empty">
      <div className={`empty-card ${err ? 'is-error' : ''}`}>
        <StatusIcon level={err ? 'critical' : 'muted'} />
        <h2>{err ? 'Can’t reach the weather station' : 'Waiting for the first reading…'}</h2>
        {live.status?.message && <p>{live.status.message}</p>}
        {err && <p className="muted">Check the container’s environment settings and logs. See the README for setup.</p>}
      </div>
    </main>
  );
}

function BatteryNotice({ obs }: { obs: Observation }) {
  const low = obs.batteries?.filter((b) => !b.ok) ?? [];
  if (!low.length) return null;
  return (
    <div className="notice" role="alert">
      <StatusIcon level="warning" />
      <span>Low battery: {low.map((b) => b.label).join(', ')}</span>
    </div>
  );
}

// ---------------------------------------------------------------- charts

interface ChartDef {
  title: string;
  kind: Kind;
  series: (ChartSeries & { key: string })[];
  area?: boolean;
  zeroBased?: boolean;
}

// Categorical slots in fixed order; color stays with the entity across charts.
const CHARTS: ChartDef[] = [
  {
    title: 'Temperature',
    kind: 'temp',
    series: [
      { key: 'tempF', label: 'Temperature', color: 'var(--series-2)' },
      { key: 'dewPointF', label: 'Dew point', color: 'var(--series-1)' },
    ],
  },
  { title: 'Humidity', kind: 'percent', series: [{ key: 'humidity', label: 'Humidity', color: 'var(--series-1)' }] },
  {
    title: 'Wind',
    kind: 'speed',
    zeroBased: true,
    series: [
      { key: 'windSpeedMph', label: 'Speed', color: 'var(--series-1)' },
      { key: 'windGustMph', label: 'Gust', color: 'var(--series-2)' },
    ],
  },
  { title: 'Pressure', kind: 'pressure', series: [{ key: 'pressureRelInHg', label: 'Pressure', color: 'var(--series-1)' }] },
  {
    title: 'Rain today (accumulated)',
    kind: 'rain',
    area: true,
    zeroBased: true,
    series: [{ key: 'rainDailyIn', label: 'Rain', color: 'var(--series-1)' }],
  },
  {
    title: 'Solar radiation',
    kind: 'solar',
    area: true,
    zeroBased: true,
    series: [{ key: 'solarWm2', label: 'Solar', color: 'var(--series-1)' }],
  },
  {
    title: 'Indoor temperature',
    kind: 'temp',
    series: [{ key: 'indoorTempF', label: 'Indoor', color: 'var(--series-1)' }],
  },
];

function ChartCard({ def, history, system }: { def: ChartDef; history: History; system: UnitSystem }) {
  const [table, setTable] = useState(false);
  const points = useMemo<ChartPoint[]>(
    () =>
      history.points.map((p) => {
        const out: ChartPoint = { t: p.t };
        for (const s of def.series) out[s.key] = convert(def.kind, system, p[s.key as keyof typeof p] as number | undefined);
        return out;
      }),
    [history.points, def, system],
  );
  const hasData = points.some((p) => def.series.some((s) => typeof p[s.key] === 'number'));
  if (!hasData) return null;
  const u = unit(def.kind, system);
  // Points are already converted, so only apply the unit's display precision.
  const d = spec(def.kind, system).digits;
  const digits = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

  return (
    <section className="card chart-card">
      <header className="card-head">
        <h3>{def.title}</h3>
        <div className="chart-tools">
          {def.series.length > 1 && (
            <ul className="legend">
              {def.series.map((s) => (
                <li key={s.key}>
                  <span className="line-key" style={{ background: s.color }} />
                  {s.label}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="link-btn" aria-pressed={table} onClick={() => setTable(!table)}>
            {table ? 'Chart' : 'Table'}
          </button>
        </div>
      </header>
      {table ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                {def.series.map((s) => (
                  <th scope="col" key={s.key}>{s.label} ({u})</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.t}>
                  <td>{dateTime(p.t)}</td>
                  {def.series.map((s) => (
                    <td key={s.key}>{typeof p[s.key] === 'number' ? digits(p[s.key] as number) : '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <LineChart
          points={points}
          series={def.series}
          from={history.from}
          to={history.to}
          gapMs={Math.max(history.bucketMs * 3, 20 * 60_000)}
          format={digits}
          unit={u}
          area={def.area}
          zeroBased={def.zeroBased}
          label={`${def.title} chart`}
        />
      )}
    </section>
  );
}
