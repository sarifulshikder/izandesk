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
      <div className="page-header items-start">
        <div>
          <span className="page-eyebrow">Network · AAA</span>
          <h1 className="page-title">RADIUS &amp; AAA</h1>
          <p className="page-subtitle">FreeRADIUS user sync (radcheck/radreply) and RFC 3576 CoA/PoD actions</p>
        </div>
        <div className="page-actions">
          <button onClick={load} className="btn btn-outline"><RefreshCw className="w-4 h-4" />Refresh</button>
          <button onClick={sync} disabled={syncing} className="btn btn-primary"><UserCheck className="w-4 h-4" />{syncing ? 'Syncing...' : 'Sync Users to RADIUS'}</button>
        </div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 card overflow-hidden">
          <div className="px-4 py-3 border-b border-border font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" />RADIUS Users (radcheck/radreply)</div>
          <div className="table-wrap overflow-auto max-h-[520px]">
            <table className="table table-hover text-[11px]">
              <thead className="sticky top-0 z-10"><tr><th className="px-3 py-2.5">User</th><th className="px-3 py-2.5">Profile/IP</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Synced</th></tr></thead>
              <tbody>
                {users.map((u: any) => (
                  <tr key={u.id} className="border-t border-border/70">
                    <td className="px-3 py-2.5"><div className="font-semibold">{u.full_name || u.username}</div><div className="text-xs text-muted-foreground font-mono">{u.username} {u.client_code ? `• ${u.client_code}` : ''}</div></td>
                    <td className="px-3 py-2.5 text-xs"><div>{u.profile || '-'}</div><div className="text-muted-foreground">{u.framed_ip_address || 'dynamic'}</div></td>
                    <td className="px-3 py-2.5 text-xs"><span className={`badge ${u.status==='SYNCED'?'badge-success':u.status==='DISABLED'?'badge-warning':'badge-secondary'}`}>{u.status}</span></td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">{u.last_synced_at ? new Date(u.last_synced_at).toLocaleString() : '-'}</td>
                  </tr>
                ))}
                {!users.length && <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No RADIUS users synced yet. Click "Sync Users to RADIUS".</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="card p-4">
            <h2 className="font-bold mb-3 flex items-center gap-2"><Zap className="w-4 h-4 text-primary" />CoA / PoD (RFC 3576)</h2>
            <div className="space-y-3 text-sm">
              <label className="block"><div className="form-label">Subscriber / Username</div>
                <select className="form-select" value={form.username} onChange={e=>setForm({...form, username: e.target.value})}>
                  <option value="">Select username...</option>
                  {subscribers.filter((s:any)=>s.username).map((s:any)=>(<option key={s.id} value={s.username}>{s.username} — {s.full_name}</option>))}
                </select>
              </label>
              <label className="block"><div className="form-label">Action</div>
                <select className="form-select" value={form.action} onChange={e=>setForm({...form, action: e.target.value})}>
                  <option value="DISCONNECT">DISCONNECT (PoD)</option>
                  <option value="CHANGE_SPEED">CHANGE_SPEED (CoA)</option>
                  <option value="RECONNECT">RECONNECT / Refresh</option>
                </select>
              </label>
              <label className="block"><div className="form-label">Router (optional)</div>
                <select className="form-select" value={form.router_id} onChange={e=>setForm({...form, router_id: e.target.value})}>
                  <option value="">Any / NAS</option>
                  {routers.map((r:any)=>(<option key={r.id} value={r.id}>{r.name}</option>))}
                </select>
              </label>
              <label className="block"><div className="form-label">Attributes (JSON)</div>
                <textarea className="form-control font-mono text-xs" value={form.attributes} onChange={e=>setForm({...form, attributes: e.target.value})} />
              </label>
              <button onClick={sendCoa} disabled={!form.username} className="btn btn-primary w-full"><Send className="w-4 h-4" />Send CoA/PoD</button>
              <p className="text-[11px] text-muted-foreground">Actions execute via simulated RFC 3576 adapter (disconnect updates live session state).</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border font-semibold flex items-center gap-2"><Unplug className="w-4 h-4 text-primary" />CoA / PoD History</div>
        <div className="table-wrap overflow-auto max-h-[360px]">
          <table className="table table-hover text-[11px]">
            <thead className="sticky top-0 z-10"><tr><th className="px-3 py-2.5">Time</th><th className="px-3 py-2.5">User</th><th className="px-3 py-2.5">Action</th><th className="px-3 py-2.5">Router</th><th className="px-3 py-2.5">Status / Response</th></tr></thead>
            <tbody>
              {coa.map((c: any) => (
                <tr key={c.id} className="border-t border-border/70">
                  <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{c.created_at ? new Date(c.created_at).toLocaleString() : '-'}</td>
                  <td className="px-3 py-2.5"><div className="font-medium">{c.username}</div><div className="text-muted-foreground">{c.full_name || c.client_code || ''}</div></td>
                  <td className="px-3 py-2.5 font-semibold">{c.action}</td>
                  <td className="px-3 py-2.5">{c.router_name || '-'}</td>
                  <td className="px-3 py-2.5"><span className="badge badge-success">{c.status}</span> <span className="text-muted-foreground">{c.response_message || ''}</span></td>
                </tr>
              ))}
              {!coa.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No CoA/PoD requests yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
