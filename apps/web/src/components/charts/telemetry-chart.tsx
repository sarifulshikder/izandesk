'use client';

import React, { useMemo } from 'react';

export interface TelemetrySeries {
  label: string;
  color: string;
  values: Array<number | null>;
}

export function TelemetryChart({
  title,
  subtitle,
  labels,
  series,
  unit = '',
  height = 170,
  emptyText = 'No historical telemetry samples recorded yet.',
}: {
  title: string;
  subtitle?: string;
  labels: string[];
  series: TelemetrySeries[];
  unit?: string;
  height?: number;
  emptyText?: string;
}) {
  const stats = useMemo(() => {
    const allNums: number[] = [];
    for (const s of series) {
      for (const v of s.values) {
        if (v !== null && v !== undefined && Number.isFinite(Number(v))) allNums.push(Number(v));
      }
    }
    if (!allNums.length) return null;
    let min = Math.min(...allNums);
    let max = Math.max(...allNums);
    if (min === max) {
      min = min > 0 ? 0 : min - 1;
      max = max + 1;
    }
    const span = max - min || 1;
    return { min, max, span };
  }, [series]);

  const width = 640;
  const padL = 10;
  const padR = 10;
  const padT = 12;
  const padB = 22;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const paths = useMemo(() => {
    if (!stats || labels.length === 0) return [];
    const n = labels.length;
    return series.map((s) => {
      const pts: Array<{ x: number; y: number; v: number }> = [];
      for (let i = 0; i < n; i += 1) {
        const raw = s.values[i];
        if (raw === null || raw === undefined || !Number.isFinite(Number(raw))) continue;
        const v = Number(raw);
        const x = n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW;
        const y = padT + plotH - ((v - stats.min) / stats.span) * plotH;
        pts.push({ x, y, v });
      }
      if (!pts.length) return { ...s, d: '', latest: null as number | null, avg: null as number | null };
      const d = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const latest = pts[pts.length - 1].v;
      const avg = pts.reduce((a, b) => a + b.v, 0) / pts.length;
      return { ...s, d, latest, avg };
    });
  }, [stats, labels.length, series, plotW, plotH]);

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold text-sm">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {paths.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5 tabular-nums">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: s.color }} />
              <span className="text-muted-foreground">{s.label}:</span>
              <b className="text-foreground">
                {s.latest !== null ? `${s.latest.toFixed(2).replace(/\.00$/, '')}${unit}` : '—'}
              </b>
            </span>
          ))}
        </div>
      </div>

      {!stats || !labels.length ? (
        <div className="text-xs text-muted-foreground py-8 text-center border border-dashed border-border rounded-xl">
          {emptyText}
        </div>
      ) : (
        <div className="w-full overflow-hidden">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto block select-none">
            {[0, 0.5, 1].map((t) => {
              const y = padT + plotH * t;
              const val = stats.max - stats.span * t;
              return (
                <g key={t}>
                  <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="currentColor" strokeOpacity="0.1" strokeDasharray="3 3" />
                  <text x={padL + 2} y={Math.max(10, y - 3)} fontSize="9" fill="currentColor" fillOpacity="0.55">
                    {val.toFixed(1).replace(/\.0$/, '')}{unit}
                  </text>
                </g>
              );
            })}
            {paths.map((s) => (
              s.d ? (
                <path
                  key={s.label}
                  d={s.d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null
            ))}
            {labels.length > 0 && (
              <>
                <text x={padL} y={height - 4} fontSize="9" fill="currentColor" fillOpacity="0.55">
                  {labels[0]}
                </text>
                {labels.length > 2 && (
                  <text x={width / 2} y={height - 4} textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity="0.55">
                    {labels[Math.floor(labels.length / 2)]}
                  </text>
                )}
                <text x={width - padR} y={height - 4} textAnchor="end" fontSize="9" fill="currentColor" fillOpacity="0.55">
                  {labels[labels.length - 1]}
                </text>
              </>
            )}
          </svg>
        </div>
      )}
    </div>
  );
}
