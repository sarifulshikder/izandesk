'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { ArrowLeft, RefreshCw, Users, Wallet, BadgePercent, Globe, Activity, UserCheck, UserX, Clock3, WifiOff, Ban } from 'lucide-react';

type AnyObj = Record<string, any>;
const money = (v: any) => `৳${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function StatCard({ label, value, icon: Icon, tone = 'default' }: { label: string; value: any; icon: any; tone?: string }) {
  const tones: Record<string, string> = {
    default: 'border-border bg-card',
    green: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400',
    amber: 'border-amber-500/20 bg-amber-500/5 text-amber-400',
    red: 'border-red-500/20 bg-red-500/5 text-red-400',
    blue: 'border-cyan-500/20 bg-cyan-500/5 text-cyan-400',
    gray: 'border-slate-500/20 bg-slate-500/5 text-slate-300',
  };
  return (
    <div className={`p-4 rounded-2xl border ${tones[tone] || tones.default}`}>
      <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" />{label}</div>
      <div className="text-xl font-black mt-1">{value}</div>
    </div>
  );
}

export default function ResellerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const [reseller, setReseller] = useState<AnyObj | null>(null);
  const [subs, setSubs] = useState<AnyObj[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true); setErr(null);
    try {
      const [d, s] = await Promise.all([
        apiFetch<any>(`/api/resellers/${id}`, {}, token),
        apiFetch<any>(`/api/resellers/${id}/subscribers`, {}, token).catch(() => ({ data: [] })),
      ]);
      setReseller(d.data);
      setSubs(s.data || []);
    } catch (e: any) { setErr(e.message || 'Failed to load reseller'); }
    finally { setLoading(false); }
  }, [token, id]);

  useEffect(() => { load(); }, [load]);

  const stats = reseller?.stats || {};
  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/resellers" className="p-2 rounded-xl border border-border bg-card hover:bg-muted"><ArrowLeft className="w-4 h-4" /></Link>
          <div>
            <h1 className="text-2xl font-black tracking-tight">{reseller?.name || 'Reseller'}</h1>
            <p className="text-sm text-muted-foreground">{reseller?.company_name || reseller?.code || 'Reseller profile'}{reseller?.tier ? ` • ${reseller.tier}` : ''}</p>
          </div>
        </div>
        <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </div>

      {err && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{err}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Wallet Balance" value={money(reseller?.wallet_balance)} icon={Wallet} tone="green" />
        <StatCard label="Total Subscribers" value={stats.total ?? reseller?.subscriber_count ?? subs.length} icon={Users} />
        <StatCard label="Buying Margin" value={`${Number(reseller?.buying_margin_percent || 0)}%`} icon={BadgePercent} />
        <StatCard label="Portal" value={reseller?.subdomain ? `${reseller.subdomain}.` : (reseller?.custom_domain || 'Not set')} icon={Globe} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="font-bold mb-3">Subscriber Status</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <StatCard label="Active" value={stats.active ?? 0} icon={UserCheck} tone="green" />
          <StatCard label="Online" value={stats.online ?? 0} icon={Activity} tone="blue" />
          <StatCard label="Offline" value={stats.offline ?? 0} icon={WifiOff} tone="gray" />
          <StatCard label="Suspended" value={stats.suspended ?? 0} icon={UserX} tone="red" />
          <StatCard label="Expired" value={stats.expired ?? 0} icon={Clock3} tone="amber" />
          <StatCard label="Pending" value={stats.pending ?? 0} icon={Clock3} />
          <StatCard label="Terminated" value={stats.terminated ?? 0} icon={Ban} tone="gray" />
          <StatCard label="Total" value={stats.total ?? subs.length} icon={Users} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-card p-4 lg:col-span-1">
          <h2 className="font-bold mb-3">Reseller Info</h2>
          <div className="space-y-2 text-sm">
            {[
              ['Code', reseller?.code], ['Status', reseller?.status], ['Email', reseller?.email],
              ['Phone', reseller?.phone], ['Subdomain', reseller?.subdomain ? `${reseller.subdomain}.` : '-'],
              ['Custom Domain', reseller?.custom_domain], ['Brand', reseller?.brand_name], ['Portal Title', reseller?.portal_title],
            ].map(([k, v]: any) => (
              <div key={k} className="flex justify-between gap-3 border-b border-border/50 pb-1.5"><span className="text-muted-foreground">{k}</span><span className="font-medium text-right break-all">{String(v ?? '-')}</span></div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/resellers/wallet" className="px-3 py-2 rounded-xl border border-border bg-muted/30 text-xs font-medium">Wallet & Recharge</Link>
            <Link href="/resellers/renew" className="px-3 py-2 rounded-xl border border-border bg-muted/30 text-xs font-medium">Renew Subscriber</Link>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 lg:col-span-2">
          <h2 className="font-bold mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-primary" />Subscribers under {reseller?.name || 'reseller'}</h2>
          <div className="overflow-auto max-h-[420px]">
            <table className="w-full text-xs"><thead className="text-muted-foreground uppercase sticky top-0 bg-card"><tr className="border-b border-border"><th className="text-left py-2 px-2">Subscriber</th><th className="text-left py-2 px-2">Package</th><th className="text-left py-2 px-2">Due</th><th className="text-left py-2 px-2">Status</th></tr></thead>
              <tbody>{subs.map(s => (
                <tr key={s.id} className="border-b border-border/50"><td className="py-2 px-2"><div className="font-medium">{s.full_name}</div><div className="text-muted-foreground font-mono">{s.client_code || s.username}</div></td><td className="py-2 px-2">{s.package_name || '-'}<div className="text-muted-foreground">{money(s.monthly_bill)}</div></td><td className="py-2 px-2 font-semibold text-amber-400">{money(s.current_due)}</td><td className="py-2 px-2"><span className="px-2 py-0.5 rounded-full border border-border">{s.status}</span></td></tr>
              ))}{!subs.length && <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No subscribers assigned to this reseller yet.</td></tr>}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
