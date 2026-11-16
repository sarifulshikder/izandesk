'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Activity } from 'lucide-react';

function fmtBps(bps: number) {
  const n = Number(bps || 0);
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} Gbps`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} Mbps`;
  return `${Math.max(0, n / 1e3).toFixed(0)} Kbps`;
}

export function LiveTrafficChart({ rx, tx, online }: { rx: number; tx: number; online: number }) {
  const [history, setHistory] = useState<number[]>(() => Array(30).fill(0));

  useEffect(() => {
    setHistory((h) => [...h.slice(-29), Number(rx || 0) + Number(tx || 0)]);
  }, [rx, tx]);

  const { points, areaPoints } = useMemo(() => {
    const width = 600, height = 140;
    const vals = history.length ? history : [0];
    const max = Math.max(1, ...vals);
    const pts = vals.map((val, idx) => {
      const x = vals.length === 1 ? width : (idx / (vals.length - 1)) * width;
      const y = height - ((val - 0) / (max - 0 || 1)) * (height - 20) - 10;
      return `${x},${y}`;
    }).join(' ');
    return { points: pts, areaPoints: `0,${height} ${pts} ${width},${height}` };
  }, [history]);

  return (
    <div className="card p-4 h-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground tracking-tight">Live Network Throughput</h3>
            <p className="text-[11px] text-muted-foreground">Aggregated active subscriber sessions ({online} online) • 10s refresh</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <ArrowDown className="w-3.5 h-3.5" />
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold tracking-wider block text-cyan-400/70">RX (Down)</span>
              <span className="font-mono text-xs font-bold">{fmtBps(rx)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <ArrowUp className="w-3.5 h-3.5" />
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold tracking-wider block text-indigo-400/70">TX (Up)</span>
              <span className="font-mono text-xs font-bold">{fmtBps(tx)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full h-40 relative overflow-hidden rounded-xl bg-gradient-to-b from-muted/30 to-muted/10 border border-border/40 p-2">
        <svg viewBox="0 0 600 140" className="w-full h-full overflow-visible" preserveAspectRatio="none">
          <defs>
            <linearGradient id="trafficGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <polygon points={areaPoints} fill="url(#trafficGradient)" />
          <polyline fill="none" stroke="#06B6D4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
        </svg>
        <div className="absolute bottom-2 left-3 text-[10px] font-mono text-muted-foreground flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Live from /api/network/sessions</span>
        </div>
      </div>
    </div>
  );
}
