'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Receipt, CreditCard, Globe2, Radio, ScrollText, RefreshCw, Download, Printer, Filter, X } from 'lucide-react';

type AnyObj = Record<string, any>;
const money = (v: any) => `৳${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (v: any) => v ? new Date(v).toLocaleString() : '-';
const gb = (v: any) => { const b = Number(v || 0); return b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${b} B`; };

export const parityTabs = [
  { key: 'billing', label: 'Billing Overview', icon: Receipt },
  { key: 'invoice-payments', label: 'Invoice Payments', icon: CreditCard },
  { key: 'online-payments', label: 'Online Payments', icon: Globe2 },
  { key: 'radius-log', label: 'RADIUS Log', icon: Radio },
  { key: 'login-log', label: 'Login Log', icon: ScrollText },
] as const;
export type ParityTab = typeof parityTabs[number]['key'];

function Stat({ label, value, tone = '' }: { label: string; value: any; tone?: string }) {
  return <div className={`px-3 py-2.5 rounded-[10px] border border-border bg-card shadow-xs ${tone}`}>
    <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
    <div className="text-[15px] font-bold tabular-nums mt-1 truncate">{value}</div>
  </div>;
}

function DateRange({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return <div className="flex items-center gap-2">
    <input type="date" className="form-control" value={from} onChange={e => setFrom(e.target.value)} title="From date" />
    <span className="text-xs text-muted-foreground">to</span>
    <input type="date" className="form-control" value={to} onChange={e => setTo(e.target.value)} title="To date" />
  </div>;
}

function exportCsv(filename: string, rows: AnyObj[]) {
  if (!rows?.length) return;
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r || {}))));
  const esc = (v: any) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

export function ResellerParityPanel({ tab, resellerId }: { tab: ParityTab; resellerId: string }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<AnyObj[]>([]);
  const [summary, setSummary] = useState<AnyObj>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const endpoint: Record<ParityTab, string> = {
    billing: 'billing-overview',
    'invoice-payments': 'invoice-payments',
    'online-payments': 'online-payments',
    'radius-log': 'radius-log',
    'login-log': 'login-log',
  };

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setErr(null);
    try {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      if (status) p.set(tab === 'radius-log' ? 'status' : 'status', status);
      if (type) p.set(tab === 'online-payments' ? 'gateway' : 'payment_type', type);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const r = await apiFetch<any>(`/api/resellers/${resellerId}/${endpoint[tab]}${p.toString() ? `?${p}` : ''}`, {}, token);
      setRows(r.data || []); setSummary(r.summary || {});
    } catch (e: any) { setErr(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  }, [token, resellerId, tab, q, status, type, from, to]);

  useEffect(() => { load(); }, [load]);

  const title: Record<ParityTab, string> = {
    billing: 'Billing Overview', 'invoice-payments': 'Invoice Payments',
    'online-payments': 'Online Payments', 'radius-log': 'RADIUS Authentication Log', 'login-log': 'Login Log',
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="font-bold flex items-center gap-2">
              {tab === 'billing' ? <Receipt className="w-4 h-4 text-primary" /> : tab === 'invoice-payments' ? <CreditCard className="w-4 h-4 text-primary" /> : tab === 'online-payments' ? <Globe2 className="w-4 h-4 text-primary" /> : tab === 'radius-log' ? <Radio className="w-4 h-4 text-primary" /> : <ScrollText className="w-4 h-4 text-primary" />}
              {title[tab]} <span className="text-xs text-muted-foreground font-normal">({rows.length})</span>
            </h2>
            <p className="text-xs text-muted-foreground">Partner-scoped, live data — filtered to this reseller&apos;s subscribers only.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowFilters(v => !v)} className="btn btn-outline btn-sm"><Filter className="w-3.5 h-3.5" />{showFilters ? 'Hide' : 'Show'} Filters</button>
            <button onClick={load} className="btn btn-outline btn-sm"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
            <button onClick={() => exportCsv(`reseller-${tab}.csv`, rows)} className="btn btn-outline btn-sm"><Download className="w-3.5 h-3.5" />CSV</button>
            <button onClick={() => window.print()} className="btn btn-outline btn-sm"><Printer className="w-3.5 h-3.5" />Print</button>
          </div>
        </div>

        {showFilters && <div className="mt-3 pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block"><span className="form-label">Search</span><input className="form-control" placeholder="Invoice / user / trx..." value={q} onChange={e => setQ(e.target.value)} /></label>
          {tab !== 'login-log' && <label className="block"><span className="form-label">Status</span><select className="form-control" value={status} onChange={e => setStatus(e.target.value)}><option value="">All</option>{tab === 'billing' ? ['PAID','PARTIAL','UNPAID','OVERDUE'].map(s => <option key={s}>{s}</option>) : tab === 'invoice-payments' ? ['COMPLETED','PENDING','FAILED'].map(s => <option key={s}>{s}</option>) : tab === 'radius-log' ? ['ONLINE','OFFLINE'].map(s => <option key={s}>{s}</option>) : ['COMPLETED','PENDING'].map(s => <option key={s}>{s}</option>)}</select></label>}
          {(tab === 'invoice-payments' || tab === 'online-payments' || tab === 'billing') && <label className="block"><span className="form-label">{tab === 'online-payments' ? 'Gateway' : 'Payment type'}</span><input className="form-control" placeholder="e.g. bKash / CASH" value={type} onChange={e => setType(e.target.value)} /></label>}
          <div className="flex items-end gap-2"><DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />{(q || status || type || from || to) && <button onClick={() => { setQ(''); setStatus(''); setType(''); setFrom(''); setTo(''); }} className="btn btn-outline btn-icon" title="Clear filters"><X className="w-3.5 h-3.5" /></button>}</div>
        </div>}
      </div>

      {err && <div className="alert alert-danger">{err}</div>}

      {tab === 'billing' && <>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <Stat label="Package Amount" value={money(summary.package_amount)} />
          <Stat label="Discount" value={money(summary.discount)} />
          <Stat label="VAT / Tax" value={money(summary.tax)} />
          <Stat label="Final Amount" value={money(summary.final_amount)} tone="border-primary/30" />
          <Stat label="Paid" value={money(summary.paid_amount)} tone="border-success/30" />
          <Stat label="Due" value={money(summary.due_amount)} tone="border-warning/30" />
        </div>
        <div className="card p-4"><div className="overflow-auto"><table className="table table-hover text-xs min-w-[1200px]">
          <thead className="text-muted-foreground uppercase"><tr className="border-b border-border">
            {['Invoice','User','Full Name','Status','Renewal','Old Expiry','New Expiry','Package','Payment Type','Transaction','Plan Price','Total','Paid','Due','Renewed By'].map(h => <th key={h} className="text-left py-2 px-2">{h}</th>)}
          </tr></thead><tbody>
            {rows.map((r: any) => <tr key={r.id} className="border-b border-border/50">
              <td className="py-2 px-2 font-mono">{r.invoice_number || '-'}</td>
              <td className="py-2 px-2">{r.username || '-'}</td>
              <td className="py-2 px-2">{r.full_name || r.subscriber_name || '-'}</td>
              <td className="py-2 px-2"><span className={`badge ${String(r.status).toUpperCase() === 'PAID' ? 'badge-success' : String(r.status).toUpperCase() === 'UNPAID' ? 'badge-warning' : 'badge-secondary'}`}>{r.status}</span></td>
              <td className="py-2 px-2">{dt(r.paid_at || r.paid_at_actual)}</td>
              <td className="py-2 px-2">{r.period_start ? String(r.period_start).slice(0,10) : '-'}</td>
              <td className="py-2 px-2">{r.period_end ? String(r.period_end).slice(0,10) : '-'}</td>
              <td className="py-2 px-2">{r.package_name || '-'}</td>
              <td className="py-2 px-2">{r.payment_type || r.method || '-'}</td>
              <td className="py-2 px-2 font-mono">{r.trx_id || '-'}</td>
              <td className="py-2 px-2">{money(r.amount)}</td>
              <td className="py-2 px-2">{money(r.total_amount)}</td>
              <td className="py-2 px-2 text-success">{money(r.paid_amount)}</td>
              <td className="py-2 px-2 text-warning">{money(r.due_amount)}</td>
              <td className="py-2 px-2">{r.collector_name || '-'}</td>
            </tr>)}
            {!rows.length && <tr><td colSpan={15} className="py-8 text-center text-muted-foreground">No invoices found for this reseller.</td></tr>}
          </tbody></table></div></div>
      </>}

      {tab === 'invoice-payments' && <>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Monthly Bill" value={money(summary.monthly_bill)} />
          <Stat label="Approval Collected" value={money(summary.approval_collected)} tone="border-success/30" />
          <Stat label="Due Bill" value={money(summary.due_bill)} tone="border-warning/30" />
          <Stat label="Online Bill Collected" value={money(summary.online_collected)} />
          <Stat label="Total Collected" value={money(summary.total_collected)} tone="border-primary/30" />
        </div>
        <div className="card p-4"><div className="overflow-auto"><table className="table table-hover text-xs min-w-[1200px]">
          <thead className="text-muted-foreground uppercase"><tr className="border-b border-border">
            {['Order','Invoice','Paid Date','Approval','User','Full Name','Partner','Payment Type','Ref / Trx','Paid Amount','Partner Amount','Notes','Collected By'].map(h => <th key={h} className="text-left py-2 px-2">{h}</th>)}
          </tr></thead><tbody>
            {rows.map((r: any) => <tr key={r.id} className="border-b border-border/50">
              <td className="py-2 px-2 font-mono">{r.payment_ref || '-'}</td>
              <td className="py-2 px-2">{r.invoice_number || '-'}</td>
              <td className="py-2 px-2">{dt(r.verified_at || r.created_at)}</td>
              <td className="py-2 px-2"><span className={`badge ${String(r.approval_status || 'APPROVED') === 'APPROVED' ? 'badge-success' : 'badge-warning'}`}>{r.approval_status || 'APPROVED'}</span></td>
              <td className="py-2 px-2">{r.username || '-'}</td>
              <td className="py-2 px-2">{r.full_name || '-'}</td>
              <td className="py-2 px-2">-</td>
              <td className="py-2 px-2">{r.payment_type || r.method || '-'}</td>
              <td className="py-2 px-2 font-mono">{r.trx_id || '-'}</td>
              <td className="py-2 px-2 font-semibold">{money(r.amount)}</td>
              <td className="py-2 px-2 text-success">-</td>
              <td className="py-2 px-2 max-w-[200px] truncate" title={r.approval_note || ''}>{r.approval_note || '-'}</td>
              <td className="py-2 px-2">{r.collector_name || '-'}</td>
            </tr>)}
            {!rows.length && <tr><td colSpan={13} className="py-8 text-center text-muted-foreground">No invoice payments found.</td></tr>}
          </tbody></table></div></div>
      </>}

      {tab === 'online-payments' && <>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Total Collected" value={money(summary.total_collected)} tone="border-success/30" />
          <Stat label="Transactions" value={summary.txn_count ?? 0} />
        </div>
        <div className="card p-4"><div className="overflow-auto"><table className="table table-hover text-xs min-w-[1200px]">
          <thead className="text-muted-foreground uppercase"><tr className="border-b border-border">
            {['Invoice','Paid Date','Paid Amount','User','Full Name','Phone','Gateway','Package','Transaction ID','MSISDN','Bank Trx ID','Bank','Mode'].map(h => <th key={h} className="text-left py-2 px-2">{h}</th>)}
          </tr></thead><tbody>
            {rows.map((r: any) => <tr key={r.id} className="border-b border-border/50">
              <td className="py-2 px-2">{r.invoice_number || '-'}</td>
              <td className="py-2 px-2">{dt(r.verified_at || r.created_at)}</td>
              <td className="py-2 px-2 font-semibold">{money(r.amount)}</td>
              <td className="py-2 px-2">{r.username || '-'}</td>
              <td className="py-2 px-2">{r.full_name || '-'}</td>
              <td className="py-2 px-2">{r.phone || '-'}</td>
              <td className="py-2 px-2">{r.gateway || '-'}</td>
              <td className="py-2 px-2">{r.package_name || '-'}</td>
              <td className="py-2 px-2 font-mono">{r.trx_id || '-'}</td>
              <td className="py-2 px-2">{r.payer_number || '-'}</td>
              <td className="py-2 px-2 font-mono">{r.bank_txn_id || '-'}</td>
              <td className="py-2 px-2">{r.bank_name || '-'}</td>
              <td className="py-2 px-2">{r.payment_mode || '-'}</td>
            </tr>)}
            {!rows.length && <tr><td colSpan={13} className="py-8 text-center text-muted-foreground">No online payments found.</td></tr>}
          </tbody></table></div></div>
      </>}

      {tab === 'radius-log' && <div className="card p-4"><div className="overflow-auto"><table className="table table-hover text-xs min-w-[1000px]">
        <thead className="text-muted-foreground uppercase"><tr className="border-b border-border">
          {['Date / Time','Username','Name','IP Address','MAC','NAS','NAS Port','Status','Reply / Cause','Session'].map(h => <th key={h} className="text-left py-2 px-2">{h}</th>)}
        </tr></thead><tbody>
          {rows.map((r: any) => <tr key={r.id} className="border-b border-border/50">
            <td className="py-2 px-2 whitespace-nowrap">{dt(r.acctstarttime || r.created_at)}</td>
            <td className="py-2 px-2 font-mono">{r.username || '-'}</td>
            <td className="py-2 px-2">{r.full_name || '-'}</td>
            <td className="py-2 px-2">{r.ip_address || '-'}</td>
            <td className="py-2 px-2 font-mono">{r.mac_address || '-'}</td>
            <td className="py-2 px-2">{String(r.nas || '-')}</td>
            <td className="py-2 px-2">{r.nas_port || '-'}</td>
            <td className="py-2 px-2"><span className={`badge ${r.status === 'ONLINE' ? 'badge-success' : 'badge-secondary'}`}>{r.status}</span></td>
            <td className="py-2 px-2">{r.reply_message || '-'}</td>
            <td className="py-2 px-2">{r.session_sec ? `${Math.floor(r.session_sec / 60)}m` : '-'}</td>
          </tr>)}
          {!rows.length && <tr><td colSpan={10} className="py-8 text-center text-muted-foreground">No RADIUS sessions found.</td></tr>}
        </tbody></table></div></div>}

      {tab === 'login-log' && <div className="card p-4"><div className="overflow-auto"><table className="table table-hover text-xs min-w-[900px]">
        <thead className="text-muted-foreground uppercase"><tr className="border-b border-border">
          {['Date / Time','Action','Actor','Role','Entity','Details'].map(h => <th key={h} className="text-left py-2 px-2">{h}</th>)}
        </tr></thead><tbody>
          {rows.map((r: any) => <tr key={r.id} className="border-b border-border/50">
            <td className="py-2 px-2 whitespace-nowrap">{dt(r.created_at)}</td>
            <td className="py-2 px-2 font-medium">{r.action}</td>
            <td className="py-2 px-2">{r.actor_name || '-'}</td>
            <td className="py-2 px-2">{r.actor_role || '-'}</td>
            <td className="py-2 px-2">{r.entity_type}{r.entity_id ? `:${String(r.entity_id).slice(0,8)}` : ''}</td>
            <td className="py-2 px-2 max-w-[300px] truncate" title={typeof r.details === 'string' ? r.details : JSON.stringify(r.details || {})}>{typeof r.details === 'string' ? r.details : JSON.stringify(r.details || {})}</td>
          </tr>)}
          {!rows.length && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No login events found.</td></tr>}
        </tbody></table></div></div>}
    </div>
  );
}
