'use client';

import React from 'react';
import { Package, Radio, AlertOctagon, CheckCircle2 } from 'lucide-react';
import { OltTelemetry } from '@izandesk/shared-types';

const mockOlts: OltTelemetry[] = [
  {
    id: 'olt-01',
    name: 'Huawei MA5608T (GPON 8-Port)',
    vendor: 'HUAWEI',
    ipAddress: '172.16.9.102',
    isOnline: true,
    totalPonPorts: 8,
    connectedOnus: 412,
    criticalPowerAlarms: 1,
  },
  {
    id: 'olt-02',
    name: 'BDCOM GP3600-08 (GPON 8-Port)',
    vendor: 'BDCOM',
    ipAddress: '172.16.9.105',
    isOnline: true,
    totalPonPorts: 8,
    connectedOnus: 388,
    criticalPowerAlarms: 0,
  },
];

export function OltTelemetryCard() {
  return (
    <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <Package className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground tracking-tight">FTTH OLT Optical Telemetry</h3>
            <p className="text-[11px] text-muted-foreground">SNMP v2c & CLI Optical Monitor</p>
          </div>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          800 ONUs Tracked
        </span>
      </div>

      <div className="space-y-3">
        {mockOlts.map((olt) => (
          <div
            key={olt.id}
            className="p-3.5 rounded-xl bg-muted/40 border border-border/60 hover:border-primary/40 transition-all"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-bold text-foreground">{olt.name}</span>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">{olt.ipAddress}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border/40">
              <div className="flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-cyan-400" />
                <span>PON: {olt.totalPonPorts} Ports</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>{olt.connectedOnus} ONUs</span>
              </div>
              <div className="text-right">
                {olt.criticalPowerAlarms > 0 ? (
                  <span className="text-rose-400 font-semibold flex items-center justify-end gap-1">
                    <AlertOctagon className="w-3 h-3" /> {olt.criticalPowerAlarms} Critical
                  </span>
                ) : (
                  <span className="text-emerald-400 font-medium">All Signals Normal</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
