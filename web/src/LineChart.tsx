import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { dateTime } from './format';

export interface ChartSeries {
  key: string;
  label: string;
  /** CSS color, normally a var(--series-n) token. */
  color: string;
}

export type ChartPoint = { t: number } & Record<string, number | undefined>;

interface Props {
  points: ChartPoint[];
  series: ChartSeries[];
  from: number;
  to: number;
  /** Break the line where consecutive points are further apart than this. */
  gapMs: number;
  format: (v: number) => string;
  unit: string;
  height?: number;
  area?: boolean;
  zeroBased?: boolean;
  label: string;
}

const M = { top: 26, right: 56, bottom: 26, left: 52 };

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function yTicks(min: number, max: number, count: number): { values: number[]; digits: number } {
  const step = niceStep(max - min || 1, count);
  const values: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) values.push(Number(v.toFixed(10)));
  const frac = String(Number(step.toPrecision(6))).split('.')[1] ?? '';
  return { values, digits: Math.min(3, frac.length) };
}

const HOUR = 3_600_000;
const STEPS_H = [1, 2, 3, 6, 12, 24, 48, 72, 168];

function xTicks(from: number, to: number, width: number): { t: number; label: string }[] {
  const maxTicks = Math.max(2, Math.floor(width / 84));
  const stepH = STEPS_H.find((h) => (to - from) / (h * HOUR) <= maxTicks) ?? 336;
  const out: { t: number; label: string }[] = [];
  const d = new Date(from);
  if (stepH < 24) {
    d.setMinutes(0, 0, 0);
    while (d.getTime() < from || d.getHours() % stepH !== 0) d.setHours(d.getHours() + 1);
    for (; d.getTime() <= to; d.setHours(d.getHours() + stepH)) {
      const t = d.getTime();
      const label =
        d.getHours() === 0
          ? d.toLocaleDateString(undefined, { weekday: 'short' })
          : d.toLocaleTimeString(undefined, { hour: 'numeric' });
      out.push({ t, label });
    }
  } else {
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < from) d.setDate(d.getDate() + 1);
    const stepD = stepH / 24;
    for (; d.getTime() <= to; d.setDate(d.getDate() + stepD)) {
      out.push({ t: d.getTime(), label: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) });
    }
  }
  return out;
}

export function LineChart({ points, series, from, to, gapMs, format, unit, height = 200, area, zeroBased, label }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | undefined>();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const p of points)
      for (const s of series) {
        const v = p[s.key];
        if (typeof v === 'number') {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    if (!Number.isFinite(min)) {
      min = 0;
      max = 1;
    }
    if (zeroBased) min = Math.min(0, min);
    if (max - min < 1e-9) max = min + (Math.abs(min) || 1) * 0.1 + (zeroBased ? 0.1 : 0.5);
    const pad = (max - min) * 0.08;
    const lo = zeroBased && min >= 0 ? 0 : min - pad;
    const hi = max + pad;
    const ticks = yTicks(lo, hi, Math.max(3, Math.floor(height / 50)));
    const yMin = Math.min(lo, ticks.values[0]);
    const yMax = Math.max(hi, ticks.values[ticks.values.length - 1]);

    const iw = width - M.left - M.right;
    const ih = height - M.top - M.bottom;
    const x = (t: number) => M.left + ((t - from) / (to - from || 1)) * iw;
    const y = (v: number) => M.top + (1 - (v - yMin) / (yMax - yMin || 1)) * ih;

    const paths = series.map((s) => {
      let d = '';
      let a = '';
      let segStart: number | undefined;
      let prevT: number | undefined;
      let prevX = 0;
      const closeArea = () => {
        if (segStart !== undefined) a += `L${prevX.toFixed(1)},${y(yMin).toFixed(1)}L${segStart.toFixed(1)},${y(yMin).toFixed(1)}Z`;
      };
      for (const p of points) {
        const v = p[s.key];
        if (typeof v !== 'number') continue;
        const px = x(p.t);
        const py = y(v);
        const brk = prevT === undefined || p.t - prevT > gapMs;
        if (brk) {
          closeArea();
          segStart = px;
          a += `M${px.toFixed(1)},${py.toFixed(1)}`;
        } else a += `L${px.toFixed(1)},${py.toFixed(1)}`;
        d += `${brk ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
        prevT = p.t;
        prevX = px;
      }
      closeArea();
      return { s, d, a };
    });

    // Direct end labels; drop any that would collide with one already placed.
    const ends: { s: ChartSeries; x: number; y: number; v: number; showLabel: boolean }[] = [];
    for (const s of series) {
      for (let i = points.length - 1; i >= 0; i--) {
        const v = points[i][s.key];
        if (typeof v === 'number') {
          const ey = y(v);
          ends.push({ s, x: x(points[i].t), y: ey, v, showLabel: !ends.some((e) => e.showLabel && Math.abs(e.y - ey) < 15) });
          break;
        }
      }
    }

    return { x, y, yMin, yMax, ticks, paths, ends, iw, ih };
  }, [points, series, from, to, gapMs, width, height, zeroBased]);

  const xt = useMemo(() => xTicks(from, to, geo.iw), [from, to, geo.iw]);

  const nearest = (t: number): number | undefined => {
    if (!points.length) return undefined;
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(points[lo - 1].t - t) < Math.abs(points[lo].t - t)) lo--;
    return lo;
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < M.left - 8 || px > width - M.right + 8) return setHover(undefined);
    setHover(nearest(from + ((px - M.left) / geo.iw) * (to - from)));
  };

  const onKey = (e: KeyboardEvent) => {
    if (!points.length) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const cur = hover ?? points.length - 1;
      setHover(Math.max(0, Math.min(points.length - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1))));
    } else if (e.key === 'Escape') setHover(undefined);
  };

  const hp = hover !== undefined ? points[hover] : undefined;
  const hx = hp ? geo.x(hp.t) : 0;
  const tipLeft = hx > width / 2;

  return (
    <div className="chart" ref={wrap}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${label}. Use left and right arrow keys to read values.`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(undefined)}
        onKeyDown={onKey}
        onBlur={() => setHover(undefined)}
      >
        {geo.ticks.values.map((v) => (
          <g key={v}>
            <line className="gridline" x1={M.left} x2={width - M.right} y1={geo.y(v)} y2={geo.y(v)} />
            <text className="tick" x={M.left - 8} y={geo.y(v)} dy="0.32em" textAnchor="end">
              {v.toLocaleString(undefined, { minimumFractionDigits: geo.ticks.digits, maximumFractionDigits: geo.ticks.digits })}
            </text>
          </g>
        ))}
        <text className="tick unit" x={M.left - 8} y={M.top - 14} textAnchor="end">
          {unit}
        </text>
        <line className="axis" x1={M.left} x2={width - M.right} y1={M.top + geo.ih} y2={M.top + geo.ih} />
        {xt.map(({ t, label: l }) => (
          <text key={t} className="tick" x={geo.x(t)} y={height - 8} textAnchor="middle">
            {l}
          </text>
        ))}

        {area &&
          geo.paths.map(({ s, a }) => <path key={`a-${s.key}`} d={a} fill={s.color} fillOpacity={0.1} stroke="none" />)}
        {geo.paths.map(({ s, d }) => (
          <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {!hp &&
          geo.ends.map((e) => (
            <g key={e.s.key}>
              <circle cx={e.x} cy={e.y} r={4} fill={e.s.color} stroke="var(--surface-1)" strokeWidth={2} />
              {e.showLabel && (
                <text className="end-label" x={e.x + 8} y={e.y} dy="0.32em">
                  {format(e.v)}
                </text>
              )}
            </g>
          ))}

        {hp && (
          <g>
            <line className="crosshair" x1={hx} x2={hx} y1={M.top} y2={M.top + geo.ih} />
            {series.map((s) => {
              const v = hp[s.key];
              return typeof v === 'number' ? (
                <circle key={s.key} cx={hx} cy={geo.y(v)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
              ) : null;
            })}
          </g>
        )}
      </svg>

      {hp && (
        <div
          className="tooltip"
          role="status"
          style={tipLeft ? { right: width - hx + 12, top: M.top } : { left: hx + 12, top: M.top }}
        >
          <div className="tooltip-time">{dateTime(hp.t)}</div>
          {series.map((s) => {
            const v = hp[s.key];
            return (
              <div className="tooltip-row" key={s.key}>
                <span className="line-key" style={{ background: s.color }} />
                <strong>{typeof v === 'number' ? `${format(v)} ${unit}` : '—'}</strong>
                <span className="muted">{s.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
