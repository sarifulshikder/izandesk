'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  Search,
  Users,
  Network,
  CreditCard,
  Puzzle,
  X,
  Radio,
  ArrowRight,
  LayoutDashboard,
  MapPin,
  Boxes,
  LifeBuoy,
  Settings,
} from 'lucide-react';

interface SearchResult {
  id: string;
  category: 'Navigation' | 'Subscriber' | 'Router' | 'Invoice' | 'Plugin' | 'Action';
  title: string;
  subtitle: string;
  href: string;
  badge?: string;
}

const baseResults: SearchResult[] = [
  { id: 'nav-home', category: 'Navigation', title: 'Dashboard', subtitle: 'Executive NOC dashboard and KPIs', href: '/' },
  { id: 'nav-subs', category: 'Navigation', title: 'Subscribers', subtitle: 'Subscriber & BSS operations', href: '/subscribers' },
  { id: 'nav-gis', category: 'Navigation', title: 'Fiber GIS Map', subtitle: 'Topology and GIS view', href: '/gis' },
  { id: 'nav-inv', category: 'Navigation', title: 'Inventory & Serials', subtitle: 'Hardware inventory shell', href: '/inventory' },
  { id: 'nav-routers', category: 'Navigation', title: 'Network & Routers', subtitle: 'Router telemetry views', href: '/routers' },
  { id: 'nav-wireguard', category: 'Navigation', title: 'WireGuard Overlay', subtitle: 'Hub-and-spoke tunnels for NAT/CGNAT sites & OLTs behind routers', href: '/wireguard', badge: 'WG' },
  { id: 'nav-olts', category: 'Navigation', title: 'FTTH & OLTs', subtitle: 'OLT telemetry views', href: '/olts' },
  { id: 'nav-billing', category: 'Navigation', title: 'Billing & Invoices', subtitle: 'Billing module shell', href: '/billing' },
  { id: 'nav-plugins', category: 'Navigation', title: 'Plugin Kernel', subtitle: 'Hot-reload plugin status and controls', href: '/plugins' },
  { id: 'nav-settings', category: 'Navigation', title: 'Settings & Security', subtitle: 'System and RBAC settings shell', href: '/settings' },
  { id: '1', category: 'Subscriber', title: 'Rohit Sharma (IZN-00142)', subtitle: 'PPPoE: rohit5656 | 50 Mbps | Mirpur Zone', href: '/subscribers', badge: 'Active' },
  { id: '3', category: 'Router', title: 'MikroTik CCR2004 — Core BDIX', subtitle: 'IP: 103.150.24.1 | 1,420 Active Sessions', href: '/routers', badge: 'Online' },
  { id: '6', category: 'Plugin', title: 'Hot-Reload Plugin Kernel', subtitle: 'Manage chokidar-watched plugins via API', href: '/plugins', badge: 'Live' },
  { id: '7', category: 'Action', title: 'Open Command Palette', subtitle: 'Universal search shortcut: Ctrl/Cmd + K', href: '/', badge: 'Shortcut' },
];

const resellerResults: SearchResult[] = [
  { id: 'rs-portal', category: 'Navigation', title: 'My Portal', subtitle: 'Reseller dashboard, users and reports', href: '/resellers' },
  { id: 'rs-wallet', category: 'Navigation', title: 'Wallet & Transactions', subtitle: 'Reseller wallet ledger and balance', href: '/resellers/wallet' },
  { id: 'rs-renew', category: 'Navigation', title: 'Renew Subscriber', subtitle: 'Renew a subscriber from wallet credit', href: '/resellers/renew' },
  { id: 'rs-tickets', category: 'Navigation', title: 'My Tickets', subtitle: 'Support tickets for this reseller', href: '/tickets' },
];

export function CommandPalette() {
  const router = useRouter();
  const { user, isCommandPaletteOpen, setCommandPaletteOpen } = useAuth();
  const results = user?.role === 'RESELLER' ? resellerResults : baseResults;
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isCommandPaletteOpen) setQuery('');
  }, [isCommandPaletteOpen]);

  const filteredResults = useMemo(() => {
    if (!query.trim()) return results;
    const q = query.toLowerCase();
    return results.filter((item) =>
      item.title.toLowerCase().includes(q) ||
      item.subtitle.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  }, [query, results]);

  if (!isCommandPaletteOpen) return null;

  const iconFor = (category: SearchResult['category']) => {
    switch (category) {
      case 'Subscriber': return <Users className="w-4 h-4" />;
      case 'Router': return <Network className="w-4 h-4" />;
      case 'Invoice': return <CreditCard className="w-4 h-4" />;
      case 'Plugin': return <Puzzle className="w-4 h-4" />;
      case 'Action': return <Radio className="w-4 h-4" />;
      case 'Navigation': return <LayoutDashboard className="w-4 h-4" />;
      default: return <Search className="w-4 h-4" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-20 px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150" onClick={() => setCommandPaletteOpen(false)}>
      <div className="w-full max-w-2xl bg-card border border-border rounded shadow-2xl overflow-hidden flex flex-col max-h-[75vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/40">
          <Search className="w-5 h-5 text-primary" />
          <input
            type="text"
            placeholder="Search routes, subscribers, routers, plugins, actions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none font-medium"
          />
          <button onClick={() => setCommandPaletteOpen(false)} className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-2 space-y-1">
          {filteredResults.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">No results found for &quot;{query}&quot;</div>
          ) : filteredResults.map((result) => (
            <button
              key={result.id}
              onClick={() => { setCommandPaletteOpen(false); router.push(result.href); }}
              className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-muted/80 cursor-pointer transition-all group text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-105 transition-transform shrink-0">
                  {iconFor(result.category)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">{result.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{result.category}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">{result.subtitle}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                {result.badge && <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-primary/10 text-primary border border-primary/20">{result.badge}</span>}
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-border bg-muted/40 text-[11px] text-muted-foreground flex items-center justify-between">
          <span>Cmd/Ctrl + K to toggle • Click outside or Esc to close</span>
          <span className="hidden sm:inline">Real RBAC session active</span>
        </div>
      </div>
    </div>
  );
}
