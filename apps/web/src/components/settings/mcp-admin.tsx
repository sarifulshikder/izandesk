'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import {
  AlertTriangle, Bot, Check, Copy, ExternalLink, KeyRound, Loader2,
  RefreshCw, ShieldCheck, Trash2, X,
} from 'lucide-react';

type McpKey = {
  key_id: string;
  name: string;
  role: string;
  user_id: string | null;
  read_only: boolean;
  allowed_tools: string[] | null;
  created_at: string | null;
  last_used_at: string | null;
  revoked: boolean;
};

type McpTool = {
  name: string;
  title: string;
  description: string;
  category: string;
  read_only: boolean;
  destructive: boolean;
};

type CreatedKey = { key_id: string; secret: string; name: string };

const KEY_ROLES = ['SUPER_ADMIN', 'NOC_ENGINEER', 'BILLING_OPERATOR', 'TECHNICIAN', 'RESELLER'];

const blankForm = {
  name: '',
  role: 'SUPER_ADMIN',
  read_only: true,
  allowAll: false,
  allowedTools: [] as string[],
};

function formatDate(value: string | null) {
  if (!value) return 'Never';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function clientConfig(keyId: string, secret: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://api.your-isp.example';
  return JSON.stringify({
    mcpServers: {
      izandesk: {
        url: `${origin}/api/mcp`,
        headers: { Authorization: `Bearer ${keyId}.${secret}` },
      },
    },
  }, null, 2);
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-auto p-4" onMouseDown={onClose}>
      <div className="card my-8 w-full max-w-2xl" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export default function McpAdmin({ token, isAdmin }: { token: string | null; isAdmin: boolean }) {
  const [keys, setKeys] = useState<McpKey[]>([]);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [form, setForm] = useState(blankForm);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !isAdmin) return;
    setLoading(true); setErr(null);
    try {
      const [k, t] = await Promise.all([
        apiFetch<{ data: McpKey[] }>('/api/mcp/keys', {}, token),
        apiFetch<{ data: McpTool[] }>('/api/mcp/tools', {}, token),
      ]);
      setKeys(k.data || []);
      setTools(t.data || []);
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, [token, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const groupedTools = useMemo(() => {
    const groups = new Map<string, McpTool[]>();
    for (const tool of tools) {
      const list = groups.get(tool.category) || [];
      list.push(tool);
      groups.set(tool.category, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tools]);

  const activeKeys = keys.filter((k) => !k.revoked).length;

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1600);
    } catch { setErr('Clipboard is unavailable in this browser.'); }
  };

  const toggleTool = (name: string) => {
    setForm((f) => ({
      ...f,
      allowedTools: f.allowedTools.includes(name)
        ? f.allowedTools.filter((t) => t !== name)
        : [...f.allowedTools, name],
    }));
  };

  const stepUpHeaders = (): Record<string, string> => {
    const stepUp = typeof window !== 'undefined' ? sessionStorage.getItem('izandesk_step_up') : null;
    return stepUp ? { 'X-Izan-Step-Up': stepUp } : {};
  };

  const createKey = async () => {
    if (!token || !isAdmin) return;
    setErr(null); setMsg(null);
    if (!form.name.trim()) { setErr('Give the key a name so you can identify it later.'); return; }
    if (!form.allowAll && form.allowedTools.length === 0) {
      setErr('Select at least one tool, or choose access to all visible tools.');
      return;
    }
    setBusy(true);
    try {
      const r = await apiFetch<CreatedKey>('/api/mcp/keys', {
        method: 'POST',
        headers: stepUpHeaders(),
        body: JSON.stringify({
          name: form.name.trim(),
          role: form.role,
          read_only: form.read_only,
          allowed_tools: form.allowAll ? ['*'] : form.allowedTools,
        }),
      }, token);
      setCreated(r);
      setForm(blankForm);
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const revokeKey = async (key: McpKey) => {
    if (!token || !isAdmin) return;
    if (!window.confirm(`Revoke "${key.name}"? Connected AI clients using it will stop working immediately.`)) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      await apiFetch(`/api/mcp/keys/${encodeURIComponent(key.key_id)}`, { method: 'DELETE', headers: stepUpHeaders() }, token);
      setMsg(`Revoked ${key.name}.`);
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="text-xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-2">
            <Bot className="h-4 w-4" />MCP server &amp; dedicated keys
          </div>
          <div className="flex items-center gap-2">
            <span className="badge badge-secondary mono">/api/mcp</span>
            {isAdmin && (
              <button onClick={load} disabled={loading || busy} className="btn btn-outline btn-sm">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
              </button>
            )}
          </div>
        </div>

        {err && <div className="alert alert-danger"><AlertTriangle className="h-4 w-4" />{err}</div>}
        {msg && <div className="alert alert-success"><Check className="h-4 w-4" />{msg}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-card-cap/60 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Active keys</div>
            <div className="text-2xl font-bold text-foreground mt-1">{isAdmin ? activeKeys : '—'}</div>
          </div>
          <div className="rounded-xl border border-border bg-card-cap/60 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Available tools</div>
            <div className="text-2xl font-bold text-foreground mt-1">{isAdmin ? tools.length : '—'}</div>
          </div>
          <div className="rounded-xl border border-border bg-card-cap/60 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Transport</div>
            <div className="text-sm font-semibold text-foreground mt-2">Streamable HTTP · JSON-RPC</div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Link href="/audit?entity_type=mcp" className="btn btn-ghost btn-sm">
            <ExternalLink className="h-3.5 w-3.5" />View MCP audit events
          </Link>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => copy('config', clientConfig('izmc_key_id', 'izsk_secret'))}
          >
            {copied === 'config' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            Copy client config template
          </button>
          <span className="text-muted-foreground">Secrets are hashed at rest and shown only once.</span>
        </div>

        {!isAdmin && <div className="alert alert-warning"><ShieldCheck className="h-4 w-4" />Only a SUPER_ADMIN can manage MCP keys.</div>}
      </div>

      {isAdmin && (
        <>
          <div className="card overflow-hidden">
            <div className="flex items-start justify-between gap-3 border-b border-border bg-card-cap/60 px-4 py-3.5">
              <div>
                <h3 className="text-[13px] font-bold text-foreground">Create a dedicated API key</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Prefer a scoped, revocable key over sharing an interactive login token with an AI client.</p>
              </div>
              <KeyRound className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="block">
                  <span className="form-label">Name</span>
                  <input className="form-control" placeholder="Claude Desktop — read only" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </label>
                <label className="block">
                  <span className="form-label">Role</span>
                  <select className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    {KEY_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
                <label className="form-check mt-6">
                  <input type="checkbox" checked={form.read_only} onChange={(e) => setForm({ ...form, read_only: e.target.checked })} />
                  <span>Read-only key <span className="text-muted-foreground">(mutating tools are hidden)</span></span>
                </label>
              </div>

              <div>
                <div className="form-label">Tool access</div>
                <label className="form-check">
                  <input type="checkbox" checked={form.allowAll} onChange={(e) => setForm({ ...form, allowAll: e.target.checked, allowedTools: [] })} />
                  <span>Allow all tools visible to this role</span>
                </label>
                {!form.allowAll && (
                  <div className="mt-2 max-h-56 overflow-auto rounded-xl border border-border bg-card-cap/40 p-3">
                    {groupedTools.length === 0 && <div className="text-xs text-muted-foreground">Loading tool catalog…</div>}
                    {groupedTools.map(([category, group]) => (
                      <div key={category} className="mb-3 last:mb-0">
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{category}</div>
                        <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                          {group.map((tool) => (
                            <label key={tool.name} className="form-check" title={tool.description}>
                              <input type="checkbox" checked={form.allowedTools.includes(tool.name)} onChange={() => toggleTool(tool.name)} />
                              <span className="mono text-[11px]">{tool.name}</span>
                              {tool.destructive && <span className="badge badge-danger">destructive</span>}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button onClick={createKey} disabled={busy} className="btn btn-primary">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  Create key
                </button>
                {!form.allowAll && form.allowedTools.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">{form.allowedTools.length} tool(s) selected</span>
                )}
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-border bg-card-cap/60 px-4 py-3.5">
              <h3 className="text-[13px] font-bold text-foreground">Dedicated API keys</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Revoked keys remain listed for audit history. Secrets are never shown again.</p>
            </div>
            <div className="table-wrap overflow-auto">
              <table className="table table-hover min-w-[860px]">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2.5">Name</th>
                    <th className="px-3 py-2.5">Key ID</th>
                    <th className="px-3 py-2.5">Role / scope</th>
                    <th className="px-3 py-2.5">Last used</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No MCP keys created yet.</td></tr>
                  )}
                  {keys.map((key) => (
                    <tr key={key.key_id} className="border-b border-border/50">
                      <td className="px-3 py-2.5 font-semibold text-foreground">{key.name}</td>
                      <td className="mono px-3 py-2.5 text-[11px] text-muted-foreground">{key.key_id}</td>
                      <td className="px-3 py-2.5">
                        <div className="text-xs font-semibold text-foreground">{key.role}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {key.read_only ? 'Read only · ' : ''}
                          {key.allowed_tools?.includes('*') ? 'all visible tools' : key.allowed_tools?.length ? `${key.allowed_tools.length} tool(s)` : 'role defaults'}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{formatDate(key.last_used_at)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`badge ${key.revoked ? 'badge-secondary' : 'badge-success'}`}>{key.revoked ? 'Revoked' : 'Active'}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button onClick={() => revokeKey(key)} disabled={busy || key.revoked} className="btn btn-danger btn-sm" title="Revoke key">
                          <Trash2 className="h-3.5 w-3.5" />Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {created && (
        <Modal title="MCP key created" onClose={() => setCreated(null)}>
          <div className="alert alert-warning"><AlertTriangle className="h-4 w-4" />Copy this secret now. It is hashed at rest and will never be shown again.</div>
          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="form-label">Key ID</span>
                <button className="btn btn-ghost btn-sm" onClick={() => copy('key-id', created.key_id)}>
                  {copied === 'key-id' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}Copy
                </button>
              </div>
              <pre className="mono overflow-auto rounded-xl border border-border bg-muted/40 p-3 text-xs">{created.key_id}</pre>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="form-label">Secret</span>
                <button className="btn btn-ghost btn-sm" onClick={() => copy('secret', created.secret)}>
                  {copied === 'secret' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}Copy
                </button>
              </div>
              <pre className="mono overflow-auto rounded-xl border border-border bg-muted/40 p-3 text-xs">{created.secret}</pre>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="form-label">Client configuration</span>
                <button className="btn btn-ghost btn-sm" onClick={() => copy('created-config', clientConfig(created.key_id, created.secret))}>
                  {copied === 'created-config' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}Copy
                </button>
              </div>
              <pre className="mono max-h-48 overflow-auto rounded-xl border border-border bg-muted/40 p-3 text-xs">{clientConfig(created.key_id, created.secret)}</pre>
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <button className="btn btn-primary" onClick={() => setCreated(null)}>Done</button>
          </div>
        </Modal>
      )}
    </>
  );
}
