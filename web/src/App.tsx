import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AirCard,
  has,
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
import { Icon, type IconName } from './Icons';
import {
  useHistory,
  useLiveStation,
  useNow,
  useStored,
  type Cadence,
  type History,
  type LiveState,
  type Observation,
} from './hooks';
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
        <ConnectionPill live={live} obs={obs} cadence={station ? live.cadence[station.id] : undefined} now={now} />
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
          <CardGrid
            items={[
              { key: 'outdoor', span: 2, node: <TemperatureCard obs={obs} summary={summary} system={system} /> },
              { key: 'wind', span: 2, node: <WindCard obs={obs} summary={summary} system={system} /> },
              has.indoor(obs) && { key: 'indoor', span: 2, node: <IndoorCard obs={obs} summary={summary} system={system} /> },
              { key: 'pressure', span: 1, node: <PressureCard obs={obs} summary={summary} system={system} /> },
              { key: 'rain', span: 1, node: <RainCard obs={obs} system={system} now={now} /> },
              has.sun(obs) && { key: 'sun', span: 1, node: <SunCard obs={obs} summary={summary} system={system} /> },
              has.lightning(obs) && { key: 'lightning', span: 1, node: <LightningCard obs={obs} system={system} now={now} /> },
              has.air(obs) && { key: 'air', span: 1, node: <AirCard obs={obs} system={system} /> },
              has.sensors(obs) && { key: 'sensors', span: 1, node: <SensorsCard obs={obs} system={system} /> },
            ]}
          />

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

// ---------------------------------------------------------------- card grid

interface GridItem {
  key: string;
  /** Preferred width in columns. */
  span: number;
  node: ReactNode;
}

/**
 * Lays cards out in as many columns as fit, then widens the last card of any
 * unfinished row so every row spans the full width (no ragged gaps).
 */
function CardGrid({ items }: { items: (GridItem | false)[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = width >= 1080 ? 4 : width >= 600 ? 2 : 1;
  const placed: GridItem[] = [];
  let row: GridItem[] = [];
  let used = 0;
  // Share a short row's leftover columns among its cards, starting with the smallest.
  const closeRow = () => {
    let extra = cols - used;
    const order = [...row].sort((a, b) => a.span - b.span);
    for (let i = 0; extra > 0 && order.length; i = (i + 1) % order.length, extra--) order[i].span++;
    row = [];
    used = 0;
  };
  for (const item of items) {
    if (!item) continue;
    const cell = { ...item, span: Math.min(item.span, cols) };
    if (used + cell.span > cols) closeRow();
    placed.push(cell);
    row.push(cell);
    used += cell.span;
    if (used === cols) {
      row = [];
      used = 0;
    }
  }
  if (used > 0) closeRow();

  return (
    <div className="grid" ref={ref} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {placed.map((p) => (
        <div key={p.key} className="grid-cell" style={{ gridColumn: `span ${p.span}` }}>
          {p.node}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- header pieces

function ConnectionPill({ live, obs, cadence, now }: { live: LiveState; obs?: Observation; cadence?: Cadence; now: number }) {
  const age = obs ? now - obs.time : undefined;
  // Ambient rounds reading times down to the minute, so "updated" uses when it actually arrived.
  const updatedAt = cadence?.lastReceivedAt ?? obs?.time;
  let level: 'good' | 'warning' | 'serious' | 'critical' | 'muted';
  let text: string;
  let showCountdown = false;
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
    text = `Polling · ${ago(updatedAt, now)}`;
    showCountdown = true;
  } else if (obs && live.status?.state === 'connected') {
    level = 'good';
    text = `Live · ${ago(updatedAt, now)}`;
    showCountdown = true;
  } else {
    level = 'muted';
    text = 'Connecting';
  }

  const details = [live.status?.message];
  if (cadence?.intervalMs)
    details.push(`Readings arrive about every ${duration(cadence.intervalMs)}${cadence.measured ? '' : ' (expected)'}`);
  if (obs) details.push(`Station time ${dateTime(obs.time)}`);

  return (
    <div className={`pill pill-${level}`} title={details.filter(Boolean).join('\n') || text}>
      <StatusIcon level={level} />
      <span>{text}</span>
      {showCountdown && cadence && <Countdown cadence={cadence} now={now} />}
    </div>
  );
}

function duration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${String(r).padStart(2, '0')}s` : `${m} min`;
}

/** Ring that fills toward the next expected reading, with the time remaining. */
function Countdown({ cadence, now }: { cadence: Cadence; now: number }) {
  const interval = cadence.intervalMs;
  if (!interval) return null;
  const elapsed = Math.max(0, now - cadence.lastReceivedAt);
  const remaining = interval - elapsed;
  const fraction = Math.min(1, elapsed / interval);
  const label =
    remaining > 0
      ? `next in ${cadence.measured ? '' : '~'}${duration(remaining)}`
      : elapsed < interval * 2
        ? 'update due'
        : 'waiting for update';
  const r = 6;
  const circ = 2 * Math.PI * r;
  return (
    <span className="countdown">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r={r} className="countdown-track" />
        <circle
          cx="8"
          cy="8"
          r={r}
          className="countdown-fill"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - fraction)}
          transform="rotate(-90 8 8)"
        />
      </svg>
      <span>{label}</span>
    </span>
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
      <Icon name="battery" />
      <span>Low battery: {low.map((b) => b.label).join(', ')}</span>
    </div>
  );
}

// ---------------------------------------------------------------- charts

interface ChartDef {
  title: string;
  icon: IconName;
  kind: Kind;
  series: (ChartSeries & { key: string })[];
  area?: boolean;
  zeroBased?: boolean;
}

// Categorical slots in fixed order; color stays with the entity across charts.
const CHARTS: ChartDef[] = [
  {
    title: 'Temperature',
    icon: 'thermometer',
    kind: 'temp',
    series: [
      { key: 'tempF', label: 'Temperature', color: 'var(--series-2)' },
      { key: 'feelsLikeF', label: 'Feels like', color: 'var(--series-3)' },
      { key: 'dewPointF', label: 'Dew point', color: 'var(--series-1)' },
    ],
  },
  {
    title: 'Humidity',
    icon: 'droplet',
    kind: 'percent',
    series: [
      { key: 'humidity', label: 'Outdoor', color: 'var(--series-1)' },
      { key: 'indoorHumidity', label: 'Indoor', color: 'var(--series-2)' },
    ],
  },
  {
    title: 'Wind',
    icon: 'wind',
    kind: 'speed',
    zeroBased: true,
    series: [
      { key: 'windSpeedMph', label: 'Speed', color: 'var(--series-1)' },
      { key: 'windGustMph', label: 'Gust', color: 'var(--series-2)' },
    ],
  },
  { title: 'Pressure', icon: 'gauge', kind: 'pressure', series: [{ key: 'pressureRelInHg', label: 'Pressure', color: 'var(--series-1)' }] },
  {
    title: 'Rain today (accumulated)',
    icon: 'rain',
    kind: 'rain',
    area: true,
    zeroBased: true,
    series: [{ key: 'rainDailyIn', label: 'Rain', color: 'var(--series-1)' }],
  },
  {
    title: 'Solar radiation',
    icon: 'sun',
    kind: 'solar',
    area: true,
    zeroBased: true,
    series: [{ key: 'solarWm2', label: 'Solar', color: 'var(--series-1)' }],
  },
  {
    title: 'Indoor temperature',
    icon: 'home',
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
        <h3>
          <Icon name={def.icon} />
          {def.title}
        </h3>
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
