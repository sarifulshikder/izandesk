'use client';

import React, { useState } from 'react';
import { Puzzle, RefreshCw, CheckCircle2, Zap } from 'lucide-react';
import { PluginMetadata } from '@izandesk/shared-types';

const initialPlugins: PluginMetadata[] = [
  {
    id: 'plg-01',
    name: 'payment-bkash',
    title: 'bKash Tokenized Checkout Driver',
    version: '1.4.0',
    type: 'PAYMENT_GATEWAY',
    isActive: true,
    lastReloadAt: 'Just now',
    status: 'OK',
    description: 'Instant recurring payment webhook & auto-reconnect (<1.8s)',
  },
  {
    id: 'plg-02',
    name: 'payment-stripe',
    title: 'Stripe Elements & Apple Pay Driver',
    version: '2.1.0',
    type: 'PAYMENT_GATEWAY',
    isActive: true,
    lastReloadAt: '3m ago',
    status: 'OK',
    description: 'Global 3D Secure 2.0 card processing',
  },
  {
    id: 'plg-03',
    name: 'sms-greenweb',
    title: 'Greenweb Bangladesh SMS Gateway',
    version: '1.2.0',
    type: 'SMS_GATEWAY',
    isActive: true,
    lastReloadAt: '12m ago',
    status: 'OK',
    description: 'Masked alphanumeric sender ID & Bengali unicode delivery',
  },
  {
    id: 'plg-04',
    name: 'olt-huawei',
    title: 'Huawei GPON MA5608T Driver',
    version: '1.0.5',
    type: 'OLT_DRIVER',
    isActive: true,
    lastReloadAt: '1h ago',
    status: 'OK',
    description: 'Telnet/SNMP optical power Rx/Tx telemetry parser',
  },
];

export function HotReloadPluginCard() {
  const [plugins, setPlugins] = useState<PluginMetadata[]>(initialPlugins);
  const [isReloading, setIsReloading] = useState(false);
  const [lastReloadMessage, setLastReloadMessage] = useState<string | null>(null);

  const handleTriggerHotReload = () => {
    setIsReloading(true);
    setLastReloadMessage(null);

    // Simulate instant hot-reload via Chokidar watcher and cache invalidation
    setTimeout(() => {
      setPlugins((prev) =>
        prev.map((p) => ({
          ...p,
          lastReloadAt: 'Just now (0ms downtime)',
        }))
      );
      setIsReloading(false);
      setLastReloadMessage('Kernel cache evicted & 4 plugins hot-reloaded successfully in 34ms!');
    }, 400);
  };

  return (
    <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary">
            <Puzzle className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground tracking-tight">Dynamic Plugin Kernel</h3>
            <p className="text-[11px] text-muted-foreground">Zero-Downtime Hot Reload (/plugins/ workspace)</p>
          </div>
        </div>

        <button
          onClick={handleTriggerHotReload}
          disabled={isReloading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover transition-all shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isReloading ? 'animate-spin' : ''}`} />
          <span>{isReloading ? 'Reloading...' : 'Hot-Reload Now'}</span>
        </button>
      </div>

      {lastReloadMessage && (
        <div className="mb-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
          <Zap className="w-3.5 h-3.5" />
          <span>{lastReloadMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {plugins.map((plugin) => (
          <div
            key={plugin.id}
            className="p-3 rounded-xl bg-muted/40 border border-border/60 hover:border-primary/40 transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-foreground">{plugin.title}</span>
                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
                  v{plugin.version}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground line-clamp-1">{plugin.description}</p>
            </div>

            <div className="flex items-center justify-between pt-2 mt-2 border-t border-border/40 text-[10px]">
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Active
              </span>
              <span className="text-muted-foreground font-mono">{plugin.lastReloadAt}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
