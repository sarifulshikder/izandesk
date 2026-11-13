'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Package, Radio, AlertOctagon, CheckCircle2, RefreshCw, ExternalLink } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';

export function OltTelemetryCard() {
  const { token } = useAuth();
  const [olts, setOlts] = useState<any[]>([]);
  const [onus, setOnus] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [oRes, uRes] = await Promise.all([
        apiFetch<any>('/api/olts', {}, token).catch(() => ({ data: [] })),
        apiFetch<any>('/api/onus', {}, token).catch(() => ({ data: [] })),
      ]);
      setOlts((oRes.data || []).slice(0, 4));
      setOnus(uRes.data || []);
    } catch {
      setOlts([]); setOnus([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const critical = onus.filter(u => String(u.optical_status).toUpperCase() === 'CRITICAL' || String(u.status).toUpperCase() === 'LOS').length;
  const online = olts.filter(o => String(o.status).toUpperCase() === 'ONLINE').length;

  return (
    <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 shrink-0">
            <Package className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground tracking-tight">FTTH OLT & ONUs</h3>
            <p className="text-[11px] text-muted-foreground">SNMP telemetry, discovery and optical status</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={load} className="p-1.5 rounded-lg border border-border hover:bg-muted" title="Refresh"><RefreshCw className={`w-3.5 h-3.5 ${loading?'animate-spin':''}`} /></button>
          <Link href="/olts" className="p-1.5 rounded-lg border border-border hover:bg-muted" title="Open OLTs"><ExternalLink className="w-3.5 h-3.5" /></Link>
        </div>
      </div>
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${online === olts.length && olts.length ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
          {olts.length ? `${online}/${olts.length} OLTs Online` : 'No OLTs configured'}
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-border bg-muted/30">{onus.length} ONUs tracked</span>
        {critical > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full border bg-red-500/10 text-red-400 border-red-500/20">{critical} critical/LOS</span>}
      </div>

      <div className="space-y-3">
        {olts.map((olt) => {
          const isOnline = String(olt.status).toUpperCase() === 'ONLINE';
          const oltOnus = onus.filter(u => u.olt_id === olt.id);
          const oltCritical = oltOnus.filter(u => String(u.optical_status).toUpperCase() === 'CRITICAL' || String(u.status).toUpperCase() === 'LOS').length;
          return (
            <div key={olt.id} className="p-3.5 rounded-xl bg-muted/40 border border-border/60 hover:border-primary/40 transition-all">
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                  <span className="text-xs font-bold text-foreground truncate">{olt.name}</span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">{olt.host || '-'}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                <div className="flex items-center gap-1.5"><Radio className="w-3.5 h-3.5 text-cyan-400" /><span>{olt.vendor || 'OLT'} {olt.model ? `• ${olt.model}` : ''}</span></div>
                <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /><span>{oltOnus.length} ONUs</span></div>
                <div className="text-right">
                  {oltCritical > 0 ? (
                    <span className="text-rose-400 font-semibold inline-flex items-center justify-end gap-1"><AlertOctagon className="w-3 h-3" /> {oltCritical} Critical</span>
                  ) : (
                    <span className={`${isOnline ? 'text-emerald-400' : 'text-muted-foreground'} font-medium`}>{isOnline ? 'Normal' : String(olt.status || 'UNKNOWN')}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!olts.length && <div className="text-xs text-muted-foreground p-4 text-center border border-dashed border-border rounded-xl">{loading ? 'Loading OLTs...' : 'No OLT devices configured yet.'}</div>}
      </div>
    </div>
  );
}
