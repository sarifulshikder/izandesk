'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, Wallet, Users, Building2, Plus, ChevronRight } from 'lucide-react';

type AnyObj = Record<string, any>;
const money = (v: any) => `৳${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ResellersOverviewPage() {
  const { token, user } = useAuth();
  const [resellers, setResellers] = useState<AnyObj[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canManage = ['SUPER_ADMIN', 'BILLING_OPERATOR'].includes(String(user?.role));

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setErr(null);
    try {
      const r = await apiFetch<any>('/api/resellers', {}, token);
      setResellers(r.data || []);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">All Resellers</h1>
          <p className="text-sm text-muted-foreground">Reseller overview. Open a reseller to view subscriber counts, status breakdown, and details.</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && <Link href="/resellers/add" className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><Plus className="w-4 h-4" />Add Reseller</Link>}
          <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
        </div>
      </div>
      {err && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {resellers.map(r => (
          <Link key={r.id} href={`/resellers/${r.id}`} className="group p-4 rounded-2xl border border-border bg-card hover:border-primary/40 hover:bg-muted/20 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><Building2 className="w-5 h-5" /></div>
                <div className="min-w-0">
                  <div className="font-bold truncate">{r.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.company_name || r.code}</div>
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-border shrink-0">{r.tier}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div className="p-2.5 rounded-xl bg-muted/30 border border-border/60"><div className="text-[11px] text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" />Subscribers</div><div className="font-bold">{r.subscriber_count ?? 0}</div></div>
              <div className="p-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20"><div className="text-[11px] text-emerald-300/80 flex items-center gap-1"><Wallet className="w-3 h-3" />Wallet</div><div className="font-bold text-emerald-400">{money(r.wallet_balance)}</div></div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate">{r.subdomain ? `${r.subdomain}.` : 'No subdomain'} • {r.status}</span>
              <span className="inline-flex items-center gap-1 text-primary group-hover:underline">View <ChevronRight className="w-3.5 h-3.5" /></span>
            </div>
          </Link>
        ))}
        {!resellers.length && !loading && <div className="md:col-span-2 xl:col-span-3 rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">No resellers found.{canManage ? ' Use “Add Reseller” to create one.' : ''}</div>}
      </div>
    </div>
  );
}
