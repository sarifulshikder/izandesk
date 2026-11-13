'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { RefreshCw, ShieldCheck, Unplug, Zap, Send, UserCheck } from 'lucide-react';

export default function RadiusPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [coa, setCoa] = useState<any[]>([]);
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [routers, setRouters] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ username: '', action: 'DISCONNECT', router_id: '', attributes: '{"Mikrotik-Rate-Limit":"50M/50M"}' });

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [u, c, s, r] = await Promise.all([
        apiFetch<{data:any[]}>('/api/radius/users', {}, token),
        apiFetch<{data:any[]}>('/api/radius/coa', {}, token),
        apiFetch<{data:any[]}>('/api/subscribers?limit=200', {}, token),
        apiFetch<{data:any[]}>('/api/network/routers', {}, token),
      ]);
      setUsers(u.data || []); setCoa(c.data || []); setSubscribers(s.data || []); setRouters(r.data || []);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    if (!token) return; setSyncing(true); setMsg(null); setError(null);
    try {
      const r = await apiFetch<any>('/api/radius/sync', { method: 'POST', body: JSON.stringify({}) }, token);
      setMsg(`Synced ${r.synced} subscribers to RADIUS (radcheck/radreply).`);
      await load();
    } catch (e: any) { setError(e.message); } finally { setSyncing(false); }
  };

  const sendCoa = async () => {
    if (!token) return; setMsg(null); setError(null);
    try {
      let attrs: any = {};
      try { attrs = form.attributes ? JSON.parse(form.attributes) : {}; } catch { attrs = { raw: form.attributes }; }
      const sub = subscribers.find((s: any) => s.username === form.username);
      const r = await apiFetch<any>('/api/radius/coa', { method: 'POST', body: JSON.stringify({ username: form.username, action: form.action, router_id: form.router_id || null, subscriber_id: sub?.id || null, attributes: attrs }) }, token);
      setMsg(r.message || 'CoA/PoD request sent.');
      await load();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">RADIUS & AAA</h1>
          <p className="text-sm text-muted-foreground">FreeRADIUS user sync (radcheck/radreply) and RFC 3576 CoA/PoD actions</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="px-3 py-2 rounded-xl border border-border bg-card text-sm inline-flex items-center gap-2"><RefreshCw className="w-4 h-4" />Refresh</button>
          <button onClick={sync} disabled={syncing} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><UserCheck className="w-4 h-4" />{syncing ? 'Syncing...' : 'Sync Users to RADIUS'}</button>
        </div>
      </div>
      {error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}
      {msg && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">{msg}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" />RADIUS Users (radcheck/radreply)</div>
          <div className="overflow-auto max-h-[520px]">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground sticky top-0"><tr><th className="text-left px-4 py-3">User</th><th className="text-left px-4 py-3">Profile/IP</th><th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3">Synced</th></tr></thead>
              <tbody>
                {users.map((u: any) => (
                  <tr key={u.id} className="border-t border-border/70">
                    <td className="px-4 py-3"><div className="font-semibold">{u.full_name || u.username}</div><div className="text-xs text-muted-foreground font-mono">{u.username} {u.client_code ? `• ${u.client_code}` : ''}</div></td>
                    <td className="px-4 py-3 text-xs"><div>{u.profile || '-'}</div><div className="text-muted-foreground">{u.framed_ip_address || 'dynamic'}</div></td>
                    <td className="px-4 py-3 text-xs"><span className={`px-2 py-0.5 rounded-full border ${u.status==='SYNCED'?'bg-emerald-500/10 text-emerald-400 border-emerald-500/20':u.status==='DISABLED'?'bg-amber-500/10 text-amber-400 border-amber-500/20':'bg-muted text-muted-foreground border-border'}`}>{u.status}</span></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{u.last_synced_at ? new Date(u.last_synced_at).toLocaleString() : '-'}</td>
                  </tr>
                ))}
                {!users.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No RADIUS users synced yet. Click "Sync Users to RADIUS".</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="font-bold mb-3 flex items-center gap-2"><Zap className="w-4 h-4 text-primary" />CoA / PoD (RFC 3576)</h2>
            <div className="space-y-3 text-sm">
              <label className="block"><div className="text-xs text-muted-foreground mb-1">Subscriber / Username</div>
                <select className="w-full p-2.5 rounded-xl border border-border bg-card" value={form.username} onChange={e=>setForm({...form, username: e.target.value})}>
                  <option value="">Select username...</option>
                  {subscribers.filter((s:any)=>s.username).map((s:any)=>(<option key={s.id} value={s.username}>{s.username} — {s.full_name}</option>))}
                </select>
              </label>
              <label className="block"><div className="text-xs text-muted-foreground mb-1">Action</div>
                <select className="w-full p-2.5 rounded-xl border border-border bg-card" value={form.action} onChange={e=>setForm({...form, action: e.target.value})}>
                  <option value="DISCONNECT">DISCONNECT (PoD)</option>
                  <option value="CHANGE_SPEED">CHANGE_SPEED (CoA)</option>
                  <option value="RECONNECT">RECONNECT / Refresh</option>
                </select>
              </label>
              <label className="block"><div className="text-xs text-muted-foreground mb-1">Router (optional)</div>
                <select className="w-full p-2.5 rounded-xl border border-border bg-card" value={form.router_id} onChange={e=>setForm({...form, router_id: e.target.value})}>
                  <option value="">Any / NAS</option>
                  {routers.map((r:any)=>(<option key={r.id} value={r.id}>{r.name}</option>))}
                </select>
              </label>
              <label className="block"><div className="text-xs text-muted-foreground mb-1">Attributes (JSON)</div>
                <textarea className="w-full p-2.5 rounded-xl border border-border bg-card font-mono text-xs h-20" value={form.attributes} onChange={e=>setForm({...form, attributes: e.target.value})} />
              </label>
              <button onClick={sendCoa} disabled={!form.username} className="w-full px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"><Send className="w-4 h-4" />Send CoA/PoD</button>
              <p className="text-[11px] text-muted-foreground">Actions execute via simulated RFC 3576 adapter (disconnect updates live session state).</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border font-semibold flex items-center gap-2"><Unplug className="w-4 h-4 text-primary" />CoA / PoD History</div>
        <div className="overflow-auto max-h-[360px]">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 uppercase text-muted-foreground sticky top-0"><tr><th className="text-left px-4 py-2">Time</th><th className="text-left px-4 py-2">User</th><th className="text-left px-4 py-2">Action</th><th className="text-left px-4 py-2">Router</th><th className="text-left px-4 py-2">Status / Response</th></tr></thead>
            <tbody>
              {coa.map((c: any) => (
                <tr key={c.id} className="border-t border-border/70">
                  <td className="px-4 py-2 text-muted-foreground">{c.created_at ? new Date(c.created_at).toLocaleString() : '-'}</td>
                  <td className="px-4 py-2"><div className="font-medium">{c.username}</div><div className="text-muted-foreground">{c.full_name || c.client_code || ''}</div></td>
                  <td className="px-4 py-2 font-semibold">{c.action}</td>
                  <td className="px-4 py-2">{c.router_name || '-'}</td>
                  <td className="px-4 py-2"><span className="text-emerald-400">{c.status}</span> <span className="text-muted-foreground">{c.response_message || ''}</span></td>
                </tr>
              ))}
              {!coa.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No CoA/PoD requests yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
