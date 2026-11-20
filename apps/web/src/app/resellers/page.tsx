'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { ResellerPortal } from '@/components/resellers/reseller-portal';
import { RefreshCw, Wallet, Users, Building2, Plus, ChevronRight, Pencil, X, Save } from 'lucide-react';

type AnyObj = Record<string, any>;
const money = (v: any) => `৳${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ResellersOverviewPage() {
  const { token, user } = useAuth();
  const [resellers, setResellers] = useState<AnyObj[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<AnyObj | null>(null);
  const [editForm, setEditForm] = useState<AnyObj>({});
  const [saving, setSaving] = useState(false);
  const [topups, setTopups] = useState<AnyObj[]>([]);
  const [topupBusy, setTopupBusy] = useState<string | null>(null);
  const isResellerUser = user?.role === 'RESELLER';
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

  const loadTopups = useCallback(async () => { if (!token || !canManage) return; try { const r = await apiFetch<any>('/api/resellers/topups/pending', {}, token); setTopups(r.data || []); } catch {} }, [token, canManage]);
  useEffect(() => { load(); loadTopups(); }, [load, loadTopups]);
  const decideTopup = async (resellerId: string, id: string, approve: boolean) => { if (!token) return; setTopupBusy(id); setErr(null); try { await apiFetch<any>(`/api/resellers/${resellerId}/wallet/topups/${id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: JSON.stringify({ reason: approve ? undefined : 'Rejected by administrator' }) }, token); await Promise.all([loadTopups(), load()]); } catch (e: any) { setErr(e.message); } finally { setTopupBusy(null); } };

  const openEdit = (r: AnyObj) => {
    setErr(null);
    setEditForm({
      name: r.name || '', company_name: r.company_name || '', tier: r.tier || 'STANDARD',
      email: r.email || '', phone: r.phone || '', subdomain: r.subdomain || '',
      custom_domain: r.custom_domain || '', brand_name: r.brand_name || '',
      portal_title: r.portal_title || '', status: r.status || 'ACTIVE',
      commission_percent: r.commission_percent ?? 0, buying_margin_percent: r.buying_margin_percent ?? 0,
      credit_limit: r.credit_limit ?? 0, address: r.address || '', notes: r.notes || '',
    });
    setEditing(r);
  };

  const saveEdit = async () => {
    if (!token || !editing) return;
    if (!String(editForm.name || '').trim()) { setErr('Reseller name is required'); return; }
    setSaving(true); setErr(null);
    try {
      await apiFetch<any>(`/api/resellers/${editing.id}`, { method: 'PUT', body: JSON.stringify({
        ...editForm,
        commission_percent: Number(editForm.commission_percent || 0),
        buying_margin_percent: Number(editForm.buying_margin_percent || 0),
        credit_limit: Number(editForm.credit_limit || 0),
      }) }, token);
      setEditing(null);
      await load();
    } catch (e: any) { setErr(e.message || 'Failed to save reseller'); }
    finally { setSaving(false); }
  };

  if (isResellerUser) {
    if (loading && !resellers.length) return <div className="p-6 text-sm text-muted-foreground">Loading reseller portal...</div>;
    if (err) return <div className="alert alert-danger">{err}</div>;
    if (resellers[0]?.id) return <ResellerPortal resellerId={resellers[0].id} />;
    return <div className="p-4"><div className="empty-panel">
      <span className="empty-panel-icon"><Building2 className="w-5 h-5" /></span>
      <div>
        <div className="text-sm font-semibold text-foreground">No linked reseller account</div>
        <p className="text-[11px] text-muted-foreground mt-1 max-w-[280px] leading-relaxed">No reseller account is linked to this login. Please contact the administrator.</p>
      </div>
    </div></div>;
  }

  return (
    <div className="space-y-5">
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Partner network · Reseller management</span>
          <h1 className="page-title">Reseller Portal</h1>
          <p className="page-subtitle">Open a reseller to access the full partner portal: dashboard, users, online sessions, balance/sharing reports, payments, and ONU list.</p>
        </div>
        <div className="page-actions">
          {canManage && <Link href="/resellers/add" className="btn btn-primary"><Plus className="w-4 h-4" />Add Reseller</Link>}
          <button onClick={load} className="btn btn-outline"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
        </div>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {resellers.map(r => (
          <div key={r.id} className="group card card-link p-4">
            <Link href={`/resellers/${r.id}`} className="block">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="dash-stat-icon shrink-0"><Building2 className="w-5 h-5" /></div>
                <div className="min-w-0">
                  <div className="font-bold truncate">{r.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.company_name || r.code}</div>
                </div>
              </div>
              <span className="badge badge-secondary shrink-0">{r.tier}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="dash-stat dash-stat-secondary compact"><span className="dash-stat-icon"><Users className="w-3 h-3" /></span><span className="dash-stat-body"><span className="dash-stat-label">Subscribers</span><span className="dash-stat-value">{r.subscriber_count ?? 0}</span></span></div>
              <div className="dash-stat dash-stat-success compact"><span className="dash-stat-icon"><Wallet className="w-3 h-3" /></span><span className="dash-stat-body"><span className="dash-stat-label">Wallet</span><span className="dash-stat-value">{money(r.wallet_balance)}</span></span></div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate">{r.subdomain ? `${r.subdomain}.` : 'No subdomain'} • {r.status}</span>
              <span className="inline-flex items-center gap-1 text-primary group-hover:underline">Open Portal <ChevronRight className="w-3.5 h-3.5" /></span>
            </div>
            </Link>
            {canManage && (
              <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground font-mono">ID {String(r.id).slice(0, 8)}</span>
                <button onClick={() => openEdit(r)} className="btn btn-outline btn-sm inline-flex items-center gap-1"><Pencil className="w-3 h-3" />Edit</button>
              </div>
            )}
          </div>
        ))}
        {!resellers.length && !loading && <div className="md:col-span-2 xl:col-span-3"><div className="empty-panel">
          <span className="empty-panel-icon"><Building2 className="w-5 h-5" /></span>
          <div>
            <div className="text-sm font-semibold text-foreground">No resellers yet</div>
            <p className="text-[11px] text-muted-foreground mt-1 max-w-[280px] leading-relaxed">Onboard a partner to open their white-label portal, wallet and subscriber management.</p>
          </div>
          {canManage && <Link href="/resellers/add" className="btn btn-primary btn-sm"><Plus className="w-3.5 h-3.5"/>Add Reseller</Link>}
        </div></div>}
      </div>

      {canManage && <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between"><h2 className="card-title"><Wallet className="w-4 h-4 text-primary" />Pending Wallet Top-ups <span className="text-xs text-muted-foreground font-normal">({topups.length})</span></h2><button onClick={loadTopups} className="btn btn-outline btn-sm"><RefreshCw className="w-3.5 h-3.5" />Refresh</button></div>
        <div className="table-wrap overflow-auto"><table className="table table-hover min-w-[720px]"><thead className="sticky top-0 z-10"><tr className="border-b border-border"><th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Reseller</th><th className="px-3 py-2.5">Amount</th><th className="px-3 py-2.5">Gateway</th><th className="px-3 py-2.5">Trx ID</th><th className="px-3 py-2.5">Payer</th><th className="px-3 py-2.5">Notes</th><th className="px-3 py-2.5">Action</th></tr></thead><tbody>
          {topups.map(t => <tr key={t.id} className="border-b border-border/50"><td className="px-3 py-2.5 text-[11px] whitespace-nowrap text-muted-foreground">{new Date(t.created_at).toLocaleString()}</td><td className="px-3 py-2.5 text-[11px] font-semibold">{t.reseller_name}</td><td className="px-3 py-2.5 text-[11px] font-bold tabular-nums text-success">{money(t.amount)}</td><td className="px-3 py-2.5 text-[11px]">{t.gateway}{t.method ? ` / ${t.method}` : ''}</td><td className="px-3 py-2.5 text-[11px] font-mono">{t.trx_id || '-'}</td><td className="px-3 py-2.5 text-[11px]">{t.payer_number || '-'}</td><td className="px-3 py-2.5 text-[11px] max-w-[180px] truncate" title={t.notes || ''}>{t.notes || '-'}</td><td className="px-3 py-2.5 text-[11px]"><div className="flex gap-1.5"><button disabled={!!topupBusy} onClick={()=>decideTopup(t.reseller_id, t.id, true)} className="btn btn-primary btn-sm">{topupBusy===t.id?'…':'Approve'}</button><button disabled={!!topupBusy} onClick={()=>decideTopup(t.reseller_id, t.id, false)} className="btn btn-outline btn-sm">Reject</button></div></td></tr>)}
          {!topups.length && <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground text-[11px]">No pending top-up requests.</td></tr>}
        </tbody></table></div>
      </div>}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-2xl card p-4 space-y-3 max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="card-title"><Pencil className="w-4 h-4 text-primary" />Edit Reseller — {editing.name}</h2>
              <button onClick={() => setEditing(null)} className="btn btn-outline btn-icon" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-muted-foreground">Update partner details, white-label branding, status and commercial terms. Wallet balance is managed from Wallet &amp; Recharge.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                ['Name *', 'name'], ['Company', 'company_name'], ['Email', 'email'], ['Phone', 'phone'],
                ['Subdomain', 'subdomain'], ['Custom Domain', 'custom_domain'], ['Brand Name', 'brand_name'], ['Portal Title', 'portal_title'],
                ['Address', 'address'],
              ].map(([label, key]: any) => (
                <label key={key} className="block">
                  <span className="form-label">{label}</span>
                  <input className="form-control" value={editForm[key] || ''} onChange={e => setEditForm((v: any) => ({ ...v, [key]: e.target.value }))} />
                </label>
              ))}
              <label className="block">
                <span className="form-label">Tier</span>
                <select className="form-select" value={editForm.tier || 'STANDARD'} onChange={e => setEditForm((v: any) => ({ ...v, tier: e.target.value }))}>
                  {['STANDARD', 'SILVER', 'GOLD', 'PLATINUM'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="form-label">Status</span>
                <select className="form-select" value={editForm.status || 'ACTIVE'} onChange={e => setEditForm((v: any) => ({ ...v, status: e.target.value }))}>
                  {['ACTIVE', 'SUSPENDED', 'INACTIVE'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="block"><span className="form-label">Buying Margin %</span><input className="form-control" type="number" step="0.01" value={editForm.buying_margin_percent ?? 0} onChange={e => setEditForm((v: any) => ({ ...v, buying_margin_percent: e.target.value }))} /></label>
              <label className="block"><span className="form-label">Commission %</span><input className="form-control" type="number" step="0.01" value={editForm.commission_percent ?? 0} onChange={e => setEditForm((v: any) => ({ ...v, commission_percent: e.target.value }))} /></label>
              <label className="block"><span className="form-label">Credit Limit (0 = unlimited)</span><input className="form-control" type="number" step="0.01" value={editForm.credit_limit ?? 0} onChange={e => setEditForm((v: any) => ({ ...v, credit_limit: e.target.value }))} /></label>
              <label className="block sm:col-span-2"><span className="form-label">Notes</span><textarea className="form-control" rows={2} value={editForm.notes || ''} onChange={e => setEditForm((v: any) => ({ ...v, notes: e.target.value }))} /></label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="btn btn-outline">Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="btn btn-primary"><Save className="w-4 h-4" />{saving ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
