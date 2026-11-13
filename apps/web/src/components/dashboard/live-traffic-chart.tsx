'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Radio, ArrowDown, ArrowUp, Activity } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';

function fmtBps(bps: number) {
  const n = Number(bps || 0);
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} Gbps`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} Mbps`;
  return `${Math.max(0, n / 1e3).toFixed(0)} Kbps`;
}

export function LiveTrafficChart() {
  const { token } = useAuth();
  const [down, setDown] = useState(0);
  const [up, setUp] = useState(0);
  const [history, setHistory] = useState<number[]>(() => Array(24).fill(0));
  const [online, setOnline] = useState(0);
  const [sourceOk, setSourceOk] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch<any>('/api/network/sessions', {}, token);
      const rx = Number(res?.summary?.aggRxBps || 0);
      const tx = Number(res?.summary?.aggTxBps || 0);
      setDown(rx); setUp(tx); setOnline(Number(res?.summary?.online || 0));
      setHistory(h => [...h.slice(-23), rx + tx]);
      setSourceOk(true);
    } catch {
      setSourceOk(false);
    }
  }, [token]);

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const { points, areaPoints } = useMemo(() => {
    const width = 600, height = 140;
    const vals = history.length ? history : [0];
    const max = Math.max(1, ...vals);
    const min = 0;
    const pts = vals.map((val, idx) => {
      const x = vals.length === 1 ? width : (idx / (vals.length - 1)) * width;
      const y = height - ((val - min) / (max - min || 1)) * (height - 20) - 10;
      return `${x},${y}`;
    }).join(' ');
    return { points: pts, areaPoints: `0,${height} ${pts} ${width},${height}` };
  }, [history]);

  return (
    <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-sm flex flex-col justify-between h-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground tracking-tight">Live Network Throughput</h3>
            <p className="text-[11px] text-muted-foreground">Aggregated from active subscriber sessions ({online} online) • auto-refresh</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <ArrowDown className="w-3.5 h-3.5" />
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold tracking-wider block text-cyan-400/70">RX (Down)</span>
              <span className="font-mono text-xs font-bold">{fmtBps(down)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <ArrowUp className="w-3.5 h-3.5" />
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold tracking-wider block text-indigo-400/70">TX (Up)</span>
              <span className="font-mono text-xs font-bold">{fmtBps(up)}</span>
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
          <span className={`w-1.5 h-1.5 rounded-full ${sourceOk ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
          <span>{sourceOk ? 'Live from /api/network/sessions • 5s refresh' : 'Awaiting session telemetry...'}</span>
        </div>
      </div>
    </div>
  );
}
