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
        <h1 className="page-title">Add Reseller</h1>
        <div className="alert alert-warning">You do not have permission to create resellers.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="page-header flex items-center gap-3">
        <Link href="/resellers" className="btn btn-outline btn-icon"><ArrowLeft className="w-4 h-4" /></Link>
        <div>
          <h1 className="page-title">Add Reseller</h1>
          <p className="text-sm text-muted-foreground">Create a new reseller. After creation you will be redirected to the reseller's page.</p>
        </div>
      </div>

      {err && <div className="alert alert-danger">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="card p-4 space-y-4">
        <h2 className="font-bold flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" />Reseller Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            ['Name *', 'name'], ['Company', 'company_name'], ['Email', 'email'], ['Phone', 'phone'],
            ['Subdomain', 'subdomain'], ['Brand Name', 'brand_name'], ['Portal Title', 'portal_title'],
          ].map(([label, key]: any) => (
            <label key={key} className="block">
              <div className="form-label">{label}</div>
              <input className="form-control" value={form[key] || ''} onChange={e => setForm((v: any) => ({ ...v, [key]: e.target.value }))} />
            </label>
          ))}
          <label className="block">
            <div className="form-label">Tier</div>
            <input className="form-control" placeholder="STANDARD / SILVER / GOLD" value={form.tier} onChange={e => setForm((v: any) => ({ ...v, tier: e.target.value }))} />
          </label>
          <label className="block">
            <div className="form-label">Buying Margin %</div>
            <input className="form-control" type="number" value={form.buying_margin_percent} onChange={e => setForm((v: any) => ({ ...v, buying_margin_percent: e.target.value }))} />
          </label>
          <label className="block">
            <div className="form-label">Commission %</div>
            <input className="form-control" type="number" value={form.commission_percent} onChange={e => setForm((v: any) => ({ ...v, commission_percent: e.target.value }))} />
          </label>
          <label className="block">
            <div className="form-label">Initial Wallet Balance</div>
            <input className="form-control" type="number" value={form.wallet_balance} onChange={e => setForm((v: any) => ({ ...v, wallet_balance: e.target.value }))} />
          </label>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={create} disabled={saving} className="btn btn-primary"><Plus className="w-4 h-4" />{saving ? 'Creating...' : 'Create Reseller'}</button>
          <Link href="/resellers" className="btn btn-outline">Cancel</Link>
        </div>
      </div>
    </div>
  );
}
