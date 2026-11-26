'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api';
import { AlertTriangle, CreditCard, Phone, MessageCircle, Mail, LifeBuoy, Search, CheckCircle, ExternalLink, RefreshCw, Clock3, User, Package } from 'lucide-react';

async function cfetch<T>(path: string, opts: any = {}, token?: string | null): Promise<T> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    cache: 'no-store',
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data as T;
}

const fmtMoney = (v: any, sym = '৳') => `${sym}${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (v: any) => { if (!v) return '—'; try { return new Date(v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return String(v); } };

export default function ExpiredNoticePage() {
  const [brand, setBrand] = useState<any>(null);
  const [gateways, setGateways] = useState<any[]>([]);
  const [view, setView] = useState<any>(null); // { subscriber, package, due_invoice, expired, restricted }
  const [token, setToken] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ticket, setTicket] = useState({ subject: 'Subscription expired — cannot recharge', description: '', phone: '' });
  const [ticketDone, setTicketDone] = useState<string | null>(null);
  const [paid, setPaid] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const r = await cfetch<any>('/api/captive/session');
      setBrand(r.brand); setGateways(r.gateways || []);
      if (r.found) { setView(r); if (r.token) setToken(r.token); }
    } catch (e: any) { /* leave lookup form */ }
  }, []);

  useEffect(() => { loadSession(); }, [loadSession]);

  const resolve = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await cfetch<any>('/api/captive/resolve', { method: 'POST', body: JSON.stringify({ identifier }) });
      setView(r); setBrand(r.brand); setGateways(r.gateways || []);
      if (r.token) setToken(r.token);
      setMsg(`Account found: ${r.subscriber?.full_name || r.subscriber?.client_code}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const pay = async (gateway: string) => {
    if (!token) { setErr('Resolve your account first (client code / username / phone) to pay online.'); return; }
    setBusy(true); setErr(null); setMsg(null); setPaid(null);
    try {
      const body: any = { gateway, method: 'captive', metadata: { source: 'CAPTIVE_EXPIRY_PAGE' } };
      if (view?.due_invoice?.id) body.invoice_id = view.due_invoice.id;
      else if (Number(view?.subscriber?.monthly_bill || 0) > 0) body.amount = Number(view.subscriber.monthly_bill);
      const r = await cfetch<any>('/api/captive/checkout', { method: 'POST', body: JSON.stringify(body) }, token);
      const url = r.checkout?.paymentUrl || r.checkout?.url || r.payment?.checkout_url;
      if (url) {
        setPaid(`Payment of ${fmtMoney(r.payment?.amount, brand?.currency_symbol)} initiated via ${String(gateway).toUpperCase()}. Complete it in the opened window — your service restores automatically within seconds of confirmation.`);
        window.open(url, '_blank');
      } else {
        setPaid(`Payment of ${fmtMoney(r.payment?.amount, brand?.currency_symbol)} recorded via ${String(gateway).toUpperCase()} (simulated gateway). Access restores automatically on confirmation.`);
      }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const submitTicket = async () => {
    setBusy(true); setErr(null); setMsg(null); setTicketDone(null);
    try {
      const body: any = { subject: ticket.subject, description: ticket.description, phone: ticket.phone, priority: 'HIGH', category: 'BILLING' };
      if (!token) body.identifier = identifier;
      const r = await cfetch<any>('/api/captive/ticket', { method: 'POST', body: JSON.stringify(body) }, token);
      setTicketDone(r.data?.ticket_no || 'created');
      setTicket({ subject: 'Subscription expired — cannot recharge', description: '', phone: '' });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const sub = view?.subscriber;
  const expired = !!view?.expired;
  const due = Number(sub?.current_due || 0);
  const sym = brand?.currency_symbol || '৳';
  const whatsapp = String(brand?.support_whatsapp || '').replace(/[^0-9]/g, '');
  const phone = String(brand?.company_phone || '');
  const email = String(brand?.company_email || '');
  const headline = expired ? 'Your subscription has expired' : (due > 0 ? 'Payment due — service restricted' : 'Service restricted');
  const subline = expired
    ? 'Please recharge to restore your internet connection.'
    : 'Please clear your outstanding dues to restore full service.';

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-xl card overflow-hidden">
        <div className="px-6 py-5 border-b border-border bg-card-cap/60 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger/10 text-danger border border-danger/20">
            <AlertTriangle className="w-5 h-5" />
          </span>
          <div>
            <span className="page-eyebrow">Connection notice · {brand?.company_name || 'ISP'}</span>
            <h1 className="text-[17px] font-bold text-foreground">{headline}</h1>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-[13px] text-muted-foreground leading-relaxed">{subline}</p>

          {sub && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2 text-[13px]">
              <div className="flex items-center gap-2 font-semibold"><User className="w-4 h-4 text-info" />{sub.full_name || 'Subscriber'} <span className="text-xs text-muted-foreground font-normal">{sub.client_code}{sub.username ? ` · ${sub.username}` : ''}</span></div>
              <div className="flex items-center gap-2 text-muted-foreground"><Package className="w-4 h-4" />{sub.package_name || '—'}{view?.package?.price != null ? ` · ${fmtMoney(view.package.price, sym)}` : (sub.monthly_bill ? ` · ${fmtMoney(sub.monthly_bill, sym)}` : '')}{view?.package ? ` · ${view.package.download_mbps}/${view.package.upload_mbps} Mbps` : ''}</div>
              <div className="flex items-center gap-2 text-muted-foreground"><Clock3 className="w-4 h-4" />Validity until <b className="text-foreground">{fmtDate(sub.expiry_date)}</b>{expired && <span className="text-danger font-semibold"> (expired)</span>}</div>
              {due > 0 && <div className="flex items-center gap-2 text-danger font-semibold"><CreditCard className="w-4 h-4" />Outstanding due: {fmtMoney(due, sym)}{view?.due_invoice?.invoice_number ? ` (${view.due_invoice.invoice_number})` : ''}</div>}
              {!due && view?.due_invoice && Number(view.due_invoice.due_amount || 0) > 0 && <div className="flex items-center gap-2 text-danger font-semibold"><CreditCard className="w-4 h-4" />Invoice due: {fmtMoney(view.due_invoice.due_amount, sym)} ({view.due_invoice.invoice_number})</div>}
            </div>
          )}

          {!view && (
            <div className="rounded-xl border border-border p-4 space-y-2">
              <div className="text-[13px] font-medium">Find your account</div>
              <div className="flex gap-2">
                <input className="form-control flex-1" placeholder="Client code / username / phone" value={identifier} onChange={(e) => setIdentifier(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') resolve(); }} />
                <button className="btn btn-outline" onClick={resolve} disabled={busy || !identifier.trim()}><Search className="w-4 h-4" /></button>
              </div>
              <p className="text-[11px] text-muted-foreground">Usually your account is detected automatically from your connection.</p>
            </div>
          )}

          {err && <div className="alert alert-danger text-[12px]">{err}</div>}
          {msg && <div className="alert alert-primary text-[12px]">{msg}</div>}
          {paid && <div className="alert alert-success text-[12px] flex items-start gap-2"><CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{paid}</span></div>}

          <div className="space-y-2">
            <div className="text-[13px] font-semibold flex items-center gap-2"><CreditCard className="w-4 h-4 text-success" />Recharge / pay online</div>
            {gateways.length ? (
              <div className="flex flex-wrap gap-2">
                {gateways.slice(0, 5).map((g: any) => (
                  <button key={g.gateway} className="btn btn-primary btn-sm" onClick={() => pay(g.gateway)} disabled={busy}>
                    Pay {String(g.label || g.gateway).toUpperCase()}{view?.due_invoice ? ` ${fmtMoney(view.due_invoice.due_amount, sym)}` : ''}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">Online payment is being configured. Please contact support below to recharge.</p>
            )}
            <p className="text-[11px] text-muted-foreground">Once payment is confirmed, your connection is restored automatically — no need to call.</p>
          </div>

          <div className="space-y-2">
            <div className="text-[13px] font-semibold flex items-center gap-2"><Phone className="w-4 h-4 text-info" />Contact support</div>
            <div className="flex flex-wrap gap-2 text-[12px]">
              {phone && <a className="btn btn-outline btn-sm" href={`tel:${phone}`}><Phone className="w-3.5 h-3.5" />{phone}</a>}
              {whatsapp && <a className="btn btn-outline btn-sm" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer"><MessageCircle className="w-3.5 h-3.5" />WhatsApp</a>}
              {email && <a className="btn btn-outline btn-sm" href={`mailto:${email}`}><Mail className="w-3.5 h-3.5" />{email}</a>}
            </div>
            {brand?.support_hours && <p className="text-[11px] text-muted-foreground">Support hours: {brand.support_hours}</p>}
          </div>

          <div className="space-y-2">
            <div className="text-[13px] font-semibold flex items-center gap-2"><LifeBuoy className="w-4 h-4 text-warning" />Open a support ticket</div>
            {ticketDone ? (
              <div className="alert alert-success text-[12px] flex items-center gap-2"><CheckCircle className="w-4 h-4" />Ticket {ticketDone} created. Support will contact you shortly.</div>
            ) : (
              <div className="space-y-2">
                <input className="form-control" placeholder="Subject" value={ticket.subject} onChange={(e) => setTicket({ ...ticket, subject: e.target.value })} />
                <textarea className="form-control" rows={2} placeholder="Describe the issue (optional)" value={ticket.description} onChange={(e) => setTicket({ ...ticket, description: e.target.value })} />
                <div className="flex gap-2">
                  <input className="form-control flex-1" placeholder="Your phone (optional)" value={ticket.phone} onChange={(e) => setTicket({ ...ticket, phone: e.target.value })} />
                  <button className="btn btn-outline" onClick={submitTicket} disabled={busy || !ticket.subject.trim()}>Submit</button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
            <a href="/portal" className="btn btn-outline btn-sm"><ExternalLink className="w-3.5 h-3.5" />Customer portal</a>
            <button className="btn btn-outline btn-sm" onClick={loadSession} disabled={busy}><RefreshCw className="w-3.5 h-3.5" />Re-check status</button>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            You are seeing this page because your ISP router redirected your connection while your account is expired or has outstanding dues. Only payment, support and portal services are reachable until the account is recharged.
          </p>
        </div>
      </div>
    </div>
  );
}
