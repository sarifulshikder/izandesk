'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  Search,
  Users,
  Network,
  CreditCard,
  Puzzle,
  LifeBuoy,
  X,
  Radio,
  ArrowRight,
} from 'lucide-react';

interface SearchResult {
  id: string;
  category: 'Subscriber' | 'Router' | 'Invoice' | 'Plugin' | 'Action';
  title: string;
  subtitle: string;
  href: string;
  badge?: string;
}

const mockSearchData: SearchResult[] = [
  { id: '1', category: 'Subscriber', title: 'Rohit Sharma (IZN-00142)', subtitle: 'PPPoE: rohit5656 | Package: 50 Mbps | Mirpur Zone', href: '/subscribers', badge: 'Active' },
  { id: '2', category: 'Subscriber', title: 'Rahim Chowdhury (IZN-00109)', subtitle: 'PPPoE: rahim01 | Package: 30 Mbps | Dhanmondi', href: '/subscribers', badge: 'Overdue' },
  { id: '3', category: 'Router', title: 'MikroTik CCR2004 — Core BDIX', subtitle: 'IP: 103.150.24.1 | CPU: 14% | 1,420 Active Sessions', href: '/routers', badge: 'Online' },
  { id: '4', category: 'Router', title: 'MikroTik CHR — Cloud Gateway', subtitle: 'IP: 172.16.171.9 | CPU: 22% | 840 Sessions', href: '/routers', badge: 'Online' },
  { id: '5', category: 'Invoice', title: 'INV-202611-0089', subtitle: 'Rohit Sharma | Amount: BDT 1,200 | bKash Paid', href: '/billing', badge: 'Paid' },
  { id: '6', category: 'Plugin', title: 'bKash Tokenized Checkout Plugin', subtitle: 'v1.4.0 | Hot-Reloadable Driver in /plugins/payment-bkash', href: '/plugins', badge: 'Loaded' },
  { id: '7', category: 'Action', title: 'Generate Monthly Billing Batch', subtitle: 'Batch invoice generator for 3,842 retail subscribers', href: '/billing', badge: 'Action' },
  { id: '8', category: 'Action', title: 'Dynamic CoA Re-sync All Queues', subtitle: 'RFC 3576 Change of Authorization bulk update', href: '/bandwidth', badge: 'Action' },
];

export function CommandPalette() {
  const { isCommandPaletteOpen, setCommandPaletteOpen } = useAuth();
  const [query, setQuery] = useState('');
  const [filteredResults, setFilteredResults] = useState<SearchResult[]>(mockSearchData);

  useEffect(() => {
    if (!query.trim()) {
      setFilteredResults(mockSearchData);
    } else {
      const q = query.toLowerCase();
      setFilteredResults(
        mockSearchData.filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.subtitle.toLowerCase().includes(q) ||
            item.category.toLowerCase().includes(q)
        )
      );
    }
  }, [query]);

  if (!isCommandPaletteOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[75vh]">
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border bg-muted/30">
          <Search className="w-5 h-5 text-primary" />
          <input
            type="text"
            placeholder="Type a command or search subscribers, routers, invoices, plugins..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none font-medium"
          />
          <button
            onClick={() => setCommandPaletteOpen(false)}
            className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results List */}
        <div className="overflow-y-auto p-2 space-y-1">
          {filteredResults.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No results found for &quot;{query}&quot;
            </div>
          ) : (
            filteredResults.map((result) => (
              <div
                key={result.id}
                onClick={() => setCommandPaletteOpen(false)}
                className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/80 cursor-pointer transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
                    {result.category === 'Subscriber' && <Users className="w-4 h-4" />}
                    {result.category === 'Router' && <Network className="w-4 h-4" />}
                    {result.category === 'Invoice' && <CreditCard className="w-4 h-4" />}
                    {result.category === 'Plugin' && <Puzzle className="w-4 h-4" />}
                    {result.category === 'Action' && <Radio className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                        {result.title}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-mono">
                        {result.category}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{result.subtitle}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {result.badge && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-primary/10 text-primary border border-primary/20">
                      {result.badge}
                    </span>
                  )}
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2 border-t border-border bg-muted/40 text-[11px] text-muted-foreground flex items-center justify-between">
          <span>Navigate with mouse or arrow keys</span>
          <span>Press ESC to close</span>
        </div>
      </div>
    </div>
  );
}
