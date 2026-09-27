import { formatNumber } from '@training/core';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatShortDate, parseDate } from '../lib/dates.ts';

export interface ChartSeries {
  id: string;
  label: string;
  /** Jeton de couleur : 1 ou 2 (palette validée clair/sombre). */
  color: 1 | 2;
  /** `line` : courbe + points ; `dots` : points seuls. */
  kind?: 'line' | 'dots';
  points: { x: string; y: number | null }[];
}

interface Props {
  title: string;
  series: ChartSeries[];
  unit?: string;
  height?: number;
  /** Ligne de référence horizontale (ex. objectif). */
  reference?: { y: number; label: string };
  /** Précise la nature de la valeur (ex. « estimation »). */
  note?: string;
}

const PAD = { top: 12, right: 16, bottom: 26, left: 44 };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

/** Courbe temporelle SVG : axe unique, grille discrète, réticule + info-bulle au survol. */
export function LineChart({ title, series, unit = '', height = 180, reference, note }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<string | null>(null);
  const titleId = useId();

  const model = useMemo(() => {
    const xs = [...new Set(series.flatMap((s) => s.points.filter((p) => p.y != null).map((p) => p.x)))].sort();
    const ys = series.flatMap((s) => s.points.map((p) => p.y).filter((y): y is number => y != null));
    if (reference) ys.push(reference.y);
    if (xs.length === 0 || ys.length === 0) return null;
    const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
    const t0 = parseDate(xs[0]!).getTime();
    const t1 = parseDate(xs[xs.length - 1]!).getTime();
    return { xs, ticks, yMin: ticks[0]!, yMax: ticks[ticks.length - 1]!, t0, t1 };
  }, [series, reference]);

  const hasData = model !== null;
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasData]);

  if (!model) return <p className="muted small">{title} : pas encore de données.</p>;

  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (d: string) =>
    PAD.left + (model.t1 === model.t0 ? innerW / 2 : ((parseDate(d).getTime() - model.t0) / (model.t1 - model.t0)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - model.yMin) / (model.yMax - model.yMin)) * innerH;
  const xLabels = model.xs.length <= 6 ? model.xs : [0, 0.33, 0.66, 1].map((f) => model.xs[Math.round(f * (model.xs.length - 1))]!);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = model.xs[0]!;
    for (const d of model.xs) if (Math.abs(x(d) - px) < Math.abs(x(best) - px)) best = d;
    setHover(best);
  };

  const fmt = (v: number) => `${formatNumber(v, 1)}${unit ? ` ${unit}` : ''}`;
  const hoverX = hover ? x(hover) : 0;

  return (
    <figure className="chart" aria-labelledby={titleId}>
      <figcaption id={titleId} className="chart-title">
        {title}
        {note && <span className="chart-note"> · {note}</span>}
      </figcaption>
      {series.length > 1 && (
        <div className="chart-legend">
          {series.map((s) => (
            <span key={s.id}>
              <i className={`legend-key legend-${s.kind ?? 'line'} chart-c${s.color}`} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="chart-body" ref={bodyRef}>
        <svg
          width="100%"
          height={height}
          role="img"
          aria-label={title}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {model.ticks.map((t) => (
            <g key={t}>
              <line className="chart-gridline" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="chart-axis" x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
                {formatNumber(t, 1)}
              </text>
            </g>
          ))}
          {xLabels.map((d, i) => (
            <text
              key={`${d}-${i}`}
              className="chart-axis"
              x={x(d)}
              y={height - 8}
              textAnchor={i === 0 && xLabels.length > 1 ? 'start' : i === xLabels.length - 1 && xLabels.length > 1 ? 'end' : 'middle'}
            >
              {formatShortDate(d)}
            </text>
          ))}
          {reference && (
            <g>
              <line className="chart-reference" x1={PAD.left} x2={width - PAD.right} y1={y(reference.y)} y2={y(reference.y)} />
              <text className="chart-axis" x={width - PAD.right} y={y(reference.y) - 4} textAnchor="end">
                {reference.label}
              </text>
            </g>
          )}
          {series.map((s) => {
            const pts = s.points.filter((p): p is { x: string; y: number } => p.y != null);
            const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
            return (
              <g key={s.id} className={`chart-c${s.color}`}>
                {(s.kind ?? 'line') === 'line' && pts.length > 1 && <path className="chart-line" d={path} />}
                {(s.kind === 'dots' || pts.length <= 40) &&
                  pts.map((p, i) => <circle key={i} className="chart-dot" cx={x(p.x)} cy={y(p.y)} r={s.kind === 'dots' ? 3.5 : 4} />)}
              </g>
            );
          })}
          {hover && <line className="chart-crosshair" x1={hoverX} x2={hoverX} y1={PAD.top} y2={PAD.top + innerH} />}
        </svg>
        {hover && (
          <div
            className="chart-tooltip"
            style={{ left: Math.min(Math.max(hoverX, 80), width - 80) }}
            role="status"
          >
            <div className="chart-tooltip-date">{formatShortDate(hover)}</div>
            {series.map((s) => {
              const p = s.points.find((q) => q.x === hover);
              if (!p || p.y == null) return null;
              return (
                <div key={s.id} className="chart-tooltip-row">
                  <i className={`legend-key legend-${s.kind ?? 'line'} chart-c${s.color}`} />
                  <strong>{fmt(p.y)}</strong>
                  <span>{s.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </figure>
  );
}
