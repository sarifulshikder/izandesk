'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { ArrowLeft, Plus, Building2 } from 'lucide-react';

export default function AddResellerPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({
    name: '', company_name: '', tier: 'STANDARD', email: '', phone: '',
    subdomain: '', brand_name: '', portal_title: '',
    commission_percent: 10, buying_margin_percent: 15, wallet_balance: 0,
  });

  const canManage = ['SUPER_ADMIN', 'BILLING_OPERATOR'].includes(String(user?.role));

  const create = async () => {
    if (!token) return;
    if (!form.name?.trim()) { setErr('Reseller name is required'); return; }
    setSaving(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch<any>('/api/resellers', { method: 'POST', body: JSON.stringify(form) }, token);
      const id = r?.data?.id;
      setMsg('Reseller created successfully');
      if (id) {
        router.push(`/resellers/${id}`);
        router.refresh();
      } else {
        router.push('/resellers');
      }
    } catch (e: any) {
      setErr(e.message || 'Failed to create reseller');
    } finally { setSaving(false); }
  };

  if (!canManage) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-black tracking-tight">Add Reseller</h1>
        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm">You do not have permission to create resellers.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/resellers" className="p-2 rounded-xl border border-border bg-card hover:bg-muted"><ArrowLeft className="w-4 h-4" /></Link>
        <div>
          <h1 className="text-2xl font-black tracking-tight">Add Reseller</h1>
          <p className="text-sm text-muted-foreground">Create a new reseller. After creation you will be redirected to the reseller's page.</p>
        </div>
      </div>

      {err && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{err}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-bold flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" />Reseller Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            ['Name *', 'name'], ['Company', 'company_name'], ['Email', 'email'], ['Phone', 'phone'],
            ['Subdomain', 'subdomain'], ['Brand Name', 'brand_name'], ['Portal Title', 'portal_title'],
          ].map(([label, key]: any) => (
            <label key={key} className="block">
              <div className="text-xs text-muted-foreground mb-1">{label}</div>
              <input className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" value={form[key] || ''} onChange={e => setForm((v: any) => ({ ...v, [key]: e.target.value }))} />
            </label>
          ))}
          <label className="block">
            <div className="text-xs text-muted-foreground mb-1">Tier</div>
            <input className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" placeholder="STANDARD / SILVER / GOLD" value={form.tier} onChange={e => setForm((v: any) => ({ ...v, tier: e.target.value }))} />
          </label>
          <label className="block">
            <div className="text-xs text-muted-foreground mb-1">Buying Margin %</div>
            <input className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" type="number" value={form.buying_margin_percent} onChange={e => setForm((v: any) => ({ ...v, buying_margin_percent: e.target.value }))} />
          </label>
          <label className="block">
            <div className="text-xs text-muted-foreground mb-1">Commission %</div>
            <input className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" type="number" value={form.commission_percent} onChange={e => setForm((v: any) => ({ ...v, commission_percent: e.target.value }))} />
          </label>
          <label className="block">
            <div className="text-xs text-muted-foreground mb-1">Initial Wallet Balance</div>
            <input className="w-full p-2.5 rounded-xl border border-border bg-card text-sm" type="number" value={form.wallet_balance} onChange={e => setForm((v: any) => ({ ...v, wallet_balance: e.target.value }))} />
          </label>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={create} disabled={saving} className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"><Plus className="w-4 h-4" />{saving ? 'Creating...' : 'Create Reseller'}</button>
          <Link href="/resellers" className="px-4 py-2.5 rounded-xl border border-border bg-card text-sm">Cancel</Link>
        </div>
      </div>
    </div>
  );
}
