'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Activity } from 'lucide-react';

function fmtBps(bps: number) {
  const n = Number(bps || 0);
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} Gbps`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} Mbps`;
  return `${Math.max(0, n / 1e3).toFixed(0)} Kbps`;
}

type Point = { rx: number; tx: number };

export function LiveTrafficChart({ rx, tx, online }: { rx: number; tx: number; online: number }) {
  const [history, setHistory] = useState<Point[]>(() => Array.from({ length: 30 }, () => ({ rx: 0, tx: 0 })));

  useEffect(() => {
    setHistory((h) => [...h.slice(-29), { rx: Number(rx || 0), tx: Number(tx || 0) }]);
  }, [rx, tx]);

  const { rxPoints, txPoints, areaPoints, peak } = useMemo(() => {
    const width = 640, height = 150, pad = 8;
    const vals = history.length ? history : [{ rx: 0, tx: 0 }];
    const peakVal = Math.max(1, ...vals.map((v) => Math.max(v.rx, v.tx)));
    const toPts = (key: 'rx' | 'tx') => vals.map((val, idx) => {
      const x = vals.length === 1 ? width : (idx / (vals.length - 1)) * width;
      const y = height - (val[key] / peakVal) * (height - 24) - pad;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return {
      rxPoints: toPts('rx'),
      txPoints: toPts('tx'),
      areaPoints: `0,${height} ${toPts('rx')} ${width},${height}`,
      peak: peakVal,
    };
  }, [history]);

  return (
    <div className="card h-full">
      <div className="card-header">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="icon-tile shrink-0"><Activity /></span>
          <div className="min-w-0">
            <div className="card-title">Live Throughput</div>
            <div className="card-subtitle">Aggregated subscriber sessions · {online} online · 10s refresh</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-[color-mix(in_srgb,var(--primary)_22%,transparent)] bg-primary/6">
            <ArrowDown className="w-3 h-3 text-primary" />
            <div className="leading-none">
              <span className="text-[8px] uppercase font-bold tracking-[0.1em] text-primary/70 block mb-1">Down</span>
              <span className="font-mono text-[10.5px] font-semibold text-foreground tabular-nums">{fmtBps(rx)}</span>
            </div>
          </div>
          <div className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-[color-mix(in_srgb,var(--info)_22%,transparent)] bg-info/6">
            <ArrowUp className="w-3 h-3 text-info" />
            <div className="leading-none">
              <span className="text-[8px] uppercase font-bold tracking-[0.1em] text-info/70 block mb-1">Up</span>
              <span className="font-mono text-[10.5px] font-semibold text-foreground tabular-nums">{fmtBps(tx)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card-body p-4">
        <div className="chart-shell w-full h-[188px] relative overflow-hidden p-2">
          <svg viewBox="0 0 640 150" className="w-full h-full overflow-visible" preserveAspectRatio="none">
            <defs>
              <linearGradient id="trafficGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.01" />
              </linearGradient>
              <linearGradient id="txStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--info)" stopOpacity="0.55" />
                <stop offset="100%" stopColor="var(--info)" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((p) => (
              <line key={p} x1="0" x2="640" y1={150 * p} y2={150 * p} stroke="var(--border)" strokeWidth="0.6" strokeDasharray="3 5" opacity="0.65" />
            ))}
            <polygon points={areaPoints} fill="url(#trafficGradient)" />
            <polyline fill="none" stroke="url(#txStroke)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" points={txPoints} opacity="0.85" />
            <polyline fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={rxPoints} />
          </svg>
          <div className="absolute top-2.5 left-3 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Aggregate traffic
          </div>
          <div className="absolute top-2.5 right-3 text-[9px] font-mono text-muted-foreground tabular-nums">
            peak {fmtBps(peak)}
          </div>
          <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between text-[9px] font-mono text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              live
            </span>
            <span className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-[2px] rounded bg-primary" /> RX</span>
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-[2px] rounded bg-info" /> TX</span>
              <span className="opacity-70">5 min window</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
