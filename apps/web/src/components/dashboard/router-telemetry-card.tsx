'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Network, Cpu, HardDrive, RefreshCw, ExternalLink } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';

export function RouterTelemetryCard() {
  const { token } = useAuth();
  const [routers, setRouters] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await apiFetch<any>('/api/network/routers', {}, token);
      setRouters((res.data || []).slice(0, 4));
    } catch {
      setRouters([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const online = routers.filter(r => String(r.status).toUpperCase() === 'ONLINE').length;

  return (
    <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-secondary/10 border border-secondary/20 text-secondary shrink-0">
            <Network className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground tracking-tight">Routers & NAS</h3>
            <p className="text-[11px] text-muted-foreground">MikroTik API/REST and RADIUS integration</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={load} className="p-1.5 rounded-lg border border-border hover:bg-muted" title="Refresh"><RefreshCw className={`w-3.5 h-3.5 ${loading?'animate-spin':''}`} /></button>
          <Link href="/routers" className="p-1.5 rounded-lg border border-border hover:bg-muted" title="Open routers"><ExternalLink className="w-3.5 h-3.5" /></Link>
        </div>
      </div>
      <div className="mb-3">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${online === routers.length && routers.length ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
          {routers.length ? `${online}/${routers.length} Online` : 'No routers configured'}
        </span>
      </div>

      <div className="space-y-3">
        {routers.map((router) => {
          const isOnline = String(router.status).toUpperCase() === 'ONLINE';
          const memPct = router.memory_total_mb ? Math.round(((Number(router.memory_used_mb||0) / Number(router.memory_total_mb||1)) * 100)) : null;
          return (
            <div key={router.id} className="p-3.5 rounded-xl bg-muted/40 border border-border/60 hover:border-primary/40 transition-all">
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                  <span className="text-xs font-bold text-foreground truncate">{router.name}</span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">{router.host || router.ip || '-'}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-background/40">{router.integration_mode || router.type || 'API'}</span>
                {router.identity && <span className="text-[10px] text-muted-foreground truncate">{router.identity}</span>}
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                <div className="flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5 text-primary" /><span>CPU: {router.cpu_load != null ? `${router.cpu_load}%` : '-'}</span></div>
                <div className="flex items-center gap-1.5"><HardDrive className="w-3.5 h-3.5 text-secondary" /><span>RAM: {memPct != null ? `${memPct}%` : '-'}</span></div>
                <div className="text-right font-medium text-foreground">{isOnline ? 'Reachable' : String(router.status || 'UNKNOWN')}</div>
              </div>
            </div>
          );
        })}
        {!routers.length && <div className="text-xs text-muted-foreground p-4 text-center border border-dashed border-border rounded-xl">{loading ? 'Loading routers...' : 'No routers/NAS configured yet.'}</div>}
      </div>
    </div>
  );
}
