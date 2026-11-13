'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Puzzle, RefreshCw, CheckCircle2, AlertTriangle, Clock3, Zap } from 'lucide-react';
import { PluginMetadata } from '@izandesk/shared-types';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export function HotReloadPluginCard() {
  const { token, user } = useAuth();
  const [plugins, setPlugins] = useState<PluginMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [isReloading, setIsReloading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canReload = !!user && (user.role === 'SUPER_ADMIN' || user.role === 'NOC_ENGINEER');

  const loadPlugins = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ plugins: PluginMetadata[] }>('/api/plugins', {}, token);
      setPlugins(res.plugins || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load plugins from kernel');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadPlugins();
    const t = setInterval(() => loadPlugins(true), 5000);
    return () => clearInterval(t);
  }, [loadPlugins]);

  const triggerReload = async (id?: string) => {
    if (!token) return;
    setIsReloading(true);
    setMessage(null);
    setError(null);
    const started = performance.now();
    try {
      const res = await apiFetch<{ plugins: PluginMetadata[]; reloaded?: PluginMetadata; reloadedAll?: boolean }>('/api/plugins/reload', {
        method: 'POST',
        body: JSON.stringify(id ? { id } : {}),
      }, token);
      setPlugins(res.plugins || []);
      const ms = Math.max(1, Math.round(performance.now() - started));
      if (res.reloadedAll) setMessage(`Kernel hot-reload completed for ${res.plugins?.length || 0} plugins in ${ms}ms (chokidar watcher active).`);
      else if (res.reloaded) setMessage(`${res.reloaded.name} reloaded successfully in ${ms}ms.`);
      else setMessage(`Hot-reload completed in ${ms}ms.`);
    } catch (e: any) {
      setError(e?.message || 'Failed to reload plugins');
    } finally {
      setIsReloading(false);
    }
  };

  const statusIcon = (status: PluginMetadata['status']) => {
    if (status === 'OK') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    if (status === 'ERROR') return <AlertTriangle className="w-3.5 h-3.5 text-red-400" />;
    return <Clock3 className="w-3.5 h-3.5 text-amber-400 animate-pulse" />;
  };

  return (
    <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary">
            <Puzzle className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-foreground text-sm">Hot-Reload Plugin Kernel</h3>
            <p className="text-[11px] text-muted-foreground">Live from API `/api/plugins` • chokidar watcher • zero-downtime reload</p>
          </div>
        </div>
        <button
          onClick={() => triggerReload()}
          disabled={isReloading || !canReload}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:opacity-95 disabled:opacity-50"
          title={canReload ? 'Reload all plugins' : 'Requires SUPER_ADMIN or NOC_ENGINEER role'}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isReloading ? 'animate-spin' : ''}`} />
          {isReloading ? 'Reloading...' : 'Hot Reload All'}
        </button>
      </div>

      {message && <div className="mb-3 text-[11px] px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 flex items-center gap-2"><Zap className="w-3.5 h-3.5" />{message}</div>}
      {error && <div className="mb-3 text-[11px] px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300">{error}</div>}

      <div className="space-y-2.5 max-h-[320px] overflow-auto pr-1">
        {loading ? (
          <div className="text-xs text-muted-foreground py-6 text-center">Loading plugin kernel state...</div>
        ) : plugins.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center">No plugins loaded.</div>
        ) : plugins.map((p) => (
          <div key={p.id} className="p-3 rounded-xl border border-border/70 bg-muted/30 hover:bg-muted/50 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-foreground truncate">{p.title || p.name}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-background border border-border text-muted-foreground">v{p.version}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">{p.type}</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{p.description}</div>
                <div className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-2">
                  <span>ID: <span className="font-mono">{p.id}</span></span>
                  <span>•</span>
                  <span>Last reload: {new Date(p.lastReloadAt).toLocaleString()}</span>
                </div>
                {p.lastError && <div className="text-[10px] text-red-400 mt-1">{p.lastError}</div>}
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <div className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-border bg-background">
                  {statusIcon(p.status)}
                  <span>{p.status}</span>
                </div>
                {canReload && (
                  <button onClick={() => triggerReload(p.id)} disabled={isReloading} className="text-[10px] px-2 py-1 rounded-lg border border-border hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-50">Reload</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-border/60 text-[11px] text-muted-foreground flex items-center justify-between">
        <span>{plugins.filter(p=>p.status==='OK').length}/{plugins.length} plugins healthy</span>
        <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live kernel polling</span>
      </div>
    </div>
  );
}
