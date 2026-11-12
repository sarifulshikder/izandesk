'use client';

import React, { useState } from 'react';
import { Subscriber } from '@izandesk/shared-types';
import {
  Users,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Radio,
  Power,
  RefreshCw,
  Eye,
} from 'lucide-react';

const mockSubscribers: Subscriber[] = [
  {
    id: 'sub-01',
    clientCode: 'IZN-00142',
    fullName: 'Rohit Sharma',
    username: 'rohit5656',
    phone: '+8801711223344',
    connectionType: 'PPPOE',
    packageId: 'pkg-50m',
    packageName: '50 Mbps Gaming Pro',
    monthlyBill: 1200,
    currentDue: 0,
    expiryDate: '2026-11-30',
    status: 'ACTIVE',
    zone: 'Mirpur',
    area: 'Block C, Section 10',
    distributionBox: 'TJ-MIR-04',
    onuOpticalPower: -19.4,
    createdAt: '2026-01-15',
  },
  {
    id: 'sub-02',
    clientCode: 'IZN-00109',
    fullName: 'Rahim Chowdhury',
    username: 'rahim01',
    phone: '+8801819887766',
    connectionType: 'PPPOE',
    packageId: 'pkg-30m',
    packageName: '30 Mbps Home Ultra',
    monthlyBill: 800,
    currentDue: 800,
    expiryDate: '2026-11-10',
    status: 'SUSPENDED',
    zone: 'Dhanmondi',
    area: 'Road 27',
    distributionBox: 'TJ-DHN-02',
    onuOpticalPower: -21.8,
    createdAt: '2026-03-20',
  },
  {
    id: 'sub-03',
    clientCode: 'IZN-00088',
    fullName: 'Apex Footwear Ltd (Corporate)',
    username: 'apex_cir_100m',
    phone: '+8801912345678',
    connectionType: 'LEASED_LINE_CIR',
    packageId: 'pkg-cir-100m',
    packageName: '100 Mbps Dedicated CIR',
    monthlyBill: 25000,
    currentDue: 0,
    expiryDate: '2026-12-31',
    status: 'ACTIVE',
    zone: 'Gulshan',
    area: 'Gulshan Avenue',
    distributionBox: 'ODB-GUL-01',
    onuOpticalPower: -17.2,
    createdAt: '2025-08-10',
  },
  {
    id: 'sub-04',
    clientCode: 'IZN-00195',
    fullName: 'Tanvir Ahmed',
    username: 'tanvir_wifi',
    phone: '+8801552233445',
    connectionType: 'HOTSPOT',
    packageId: 'pkg-hotspot-7d',
    packageName: '7-Day Unlimited Pass',
    monthlyBill: 350,
    currentDue: 0,
    expiryDate: '2026-11-18',
    status: 'ACTIVE',
    zone: 'Uttara',
    area: 'Sector 4',
    distributionBox: 'TJ-UTT-09',
    createdAt: '2026-11-11',
  },
];

export function RecentSubscribersTable() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>(mockSubscribers);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const handleKickSession = (username: string) => {
    setActionMessage(`RFC 3576 PoD sent: Session terminated for ${username}`);
    setTimeout(() => setActionMessage(null), 3000);
  };

  const handleReconnect = (id: string) => {
    setSubscribers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: 'ACTIVE', currentDue: 0 } : s))
    );
    setActionMessage(`Subscriber restored! CoA packet sent to MikroTik. Bandwidth active.`);
    setTimeout(() => setActionMessage(null), 3000);
  };

  return (
    <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground tracking-tight">Recent Subscribers & Sessions</h3>
            <p className="text-[11px] text-muted-foreground">Carrier-Grade AAA Online & Due States</p>
          </div>
        </div>

        {actionMessage && (
          <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20 animate-in fade-in">
            {actionMessage}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground uppercase text-[10px] tracking-wider">
              <th className="py-2.5 px-3">Subscriber</th>
              <th className="py-2.5 px-3">Protocol & Package</th>
              <th className="py-2.5 px-3">Zone / Box</th>
              <th className="py-2.5 px-3">Monthly Bill</th>
              <th className="py-2.5 px-3">Optical Signal</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {subscribers.map((sub) => (
              <tr key={sub.id} className="hover:bg-muted/40 transition-colors group">
                <td className="py-3 px-3">
                  <div className="font-bold text-foreground">{sub.fullName}</div>
                  <div className="text-[11px] font-mono text-primary flex items-center gap-1">
                    <span>{sub.clientCode}</span> • <span>{sub.username}</span>
                  </div>
                </td>

                <td className="py-3 px-3">
                  <div className="font-semibold text-foreground">{sub.packageName}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">{sub.connectionType}</div>
                </td>

                <td className="py-3 px-3">
                  <div className="text-foreground">{sub.zone}</div>
                  <div className="text-[10px] text-muted-foreground">{sub.distributionBox || 'Direct Fiber'}</div>
                </td>

                <td className="py-3 px-3">
                  <div className="font-bold text-foreground">BDT {sub.monthlyBill.toLocaleString()}</div>
                  <div className={`text-[10px] ${sub.currentDue > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400'}`}>
                    {sub.currentDue > 0 ? `Due: BDT ${sub.currentDue}` : 'Paid in full'}
                  </div>
                </td>

                <td className="py-3 px-3 font-mono text-[11px]">
                  {sub.onuOpticalPower ? (
                    <span className={sub.onuOpticalPower < -25 ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                      {sub.onuOpticalPower} dBm
                    </span>
                  ) : (
                    <span className="text-muted-foreground">N/A</span>
                  )}
                </td>

                <td className="py-3 px-3">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      sub.status === 'ACTIVE'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}
                  >
                    {sub.status === 'ACTIVE' ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : (
                      <AlertTriangle className="w-3 h-3" />
                    )}
                    {sub.status}
                  </span>
                </td>

                <td className="py-3 px-3 text-right">
                  <div className="flex items-center justify-end gap-1.5 opacity-90 group-hover:opacity-100">
                    {sub.status === 'ACTIVE' ? (
                      <button
                        onClick={() => handleKickSession(sub.username)}
                        className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title="Disconnect Session (PoD)"
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleReconnect(sub.id)}
                        className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-[10px] font-bold transition-colors"
                      >
                        Restore Bill
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
