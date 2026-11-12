'use client';

import React, { useState } from 'react';
import {
  MapPin,
  Radio,
  Layers,
  Search,
  AlertTriangle,
  Zap,
  Activity,
  Compass,
  Maximize2,
  Box,
  Plus,
  Route,
  Target,
} from 'lucide-react';

interface FiberNode {
  id: string;
  name: string;
  type: 'POP' | 'TJ_BOX' | 'SPLITTER' | 'SUBSCRIBER';
  x: number;
  y: number;
  opticalPower?: number; // dBm
  portsUsed?: number;
  totalPorts?: number;
  status: 'NORMAL' | 'WARNING' | 'CRITICAL_LOS';
  zone: string;
  clients?: string[];
}

const initialNodes: FiberNode[] = [
  { id: 'pop-01', name: 'Central NOC POP (Mirpur 10)', type: 'POP', x: 120, y: 150, status: 'NORMAL', zone: 'Mirpur' },
  { id: 'tj-01', name: 'TJ-MIR-01 (Main Avenue)', type: 'TJ_BOX', x: 280, y: 140, portsUsed: 14, totalPorts: 16, status: 'NORMAL', zone: 'Mirpur' },
  { id: 'tj-02', name: 'TJ-MIR-02 (Block D)', type: 'TJ_BOX', x: 440, y: 90, portsUsed: 16, totalPorts: 16, status: 'CRITICAL_LOS', zone: 'Mirpur' },
  { id: 'tj-04', name: 'TJ-MIR-04 (Section 10)', type: 'TJ_BOX', x: 420, y: 240, portsUsed: 8, totalPorts: 16, status: 'NORMAL', zone: 'Mirpur' },
  { id: 'sub-01', name: 'Rohit Sharma (IZN-00142)', type: 'SUBSCRIBER', x: 560, y: 260, opticalPower: -19.4, status: 'NORMAL', zone: 'Mirpur' },
  { id: 'sub-02', name: 'Rahim Chowdhury (IZN-00109)', type: 'SUBSCRIBER', x: 580, y: 180, opticalPower: -21.8, status: 'NORMAL', zone: 'Mirpur' },
  { id: 'sub-05', name: 'Fatema Tuz Zohra (IZN-00214)', type: 'SUBSCRIBER', x: 580, y: 80, opticalPower: -26.9, status: 'CRITICAL_LOS', zone: 'Mirpur' },
];

export default function GisPage() {
  const [nodes, setNodes] = useState<FiberNode[]>(initialNodes);
  const [selectedNode, setSelectedNode] = useState<FiberNode | null>(null);
  const [otdrDistance, setOtdrDistance] = useState<string>('1450');
  const [otdrFaultPinned, setOtdrFaultPinned] = useState<{ x: number; y: number } | null>(null);
  const [mapTool, setMapTool] = useState<'inspect' | 'otdr' | 'measure'>('inspect');
  const [cableDistanceResult, setCableDistanceResult] = useState<string | null>(null);

  const handleLocateOtdrFault = () => {
    // Calculates estimated fiber fault spot between TJ-01 and TJ-02
    setOtdrFaultPinned({ x: 380, y: 110 });
    setSelectedNode(nodes.find((n) => n.id === 'tj-02') || null);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-card border border-border shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl sm:text-2xl font-black text-foreground tracking-tight">
              Fiber & FTTH GIS Topology Map
            </h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              PostGIS 3.4 Spatial Layer
            </span>
          </div>
          <p className="text-xs text-muted-foreground font-medium">
            Central POPs, TJ Splitter Distribution Boxes, Core Cables & Optical Attenuation
          </p>
        </div>

        {/* Map Tool Switcher */}
        <div className="flex items-center gap-2 bg-muted/60 p-1.5 rounded-xl border border-border">
          <button
            onClick={() => setMapTool('inspect')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              mapTool === 'inspect' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Inspect Mode
          </button>
          <button
            onClick={() => setMapTool('otdr')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              mapTool === 'otdr' ? 'bg-rose-500 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            OTDR Fault Locator
          </button>
          <button
            onClick={() => {
              setMapTool('measure');
              setCableDistanceResult('Estimated Drop Cable: 84 meters (32% drum remaining)');
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              mapTool === 'measure' ? 'bg-indigo-500 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Route Measure
          </button>
        </div>
      </div>

      {cableDistanceResult && (
        <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <Route className="w-4 h-4" />
            <span>{cableDistanceResult}</span>
          </div>
          <button onClick={() => setCableDistanceResult(null)}>
            <span className="text-xs font-bold">Dismiss</span>
          </button>
        </div>
      )}

      {/* Main Map Container */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Interactive Vector GIS Canvas */}
        <div className="lg:col-span-3 rounded-2xl bg-card border border-border shadow-sm overflow-hidden flex flex-col relative h-[520px]">
          {/* Map Controls Overlay */}
          <div className="absolute top-4 left-4 z-10 flex items-center gap-2 bg-card/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-border text-xs text-muted-foreground shadow-lg">
            <Compass className="w-4 h-4 text-primary" />
            <span>Mirpur Sector 10 Topology</span>
          </div>

          <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
            <span className="text-[11px] font-mono font-semibold px-2.5 py-1 rounded-xl bg-card/80 backdrop-blur-md border border-border text-foreground flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Optical Loss: 0.28 dB/km
            </span>
          </div>

          {/* SVG Map Canvas */}
          <svg className="w-full h-full bg-slate-950/60 cursor-crosshair">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* Fiber Trunk Line (POP -> TJ-01) */}
            <line x1="120" y1="150" x2="280" y2="140" stroke="#06B6D4" strokeWidth="4" />
            <text x="180" y="135" fill="#06B6D4" fontSize="10" fontFamily="monospace">48F Trunk</text>

            {/* Fiber Distribution Lines */}
            <line x1="280" y1="140" x2="440" y2="90" stroke="#EF4444" strokeWidth="3" strokeDasharray="4" />
            <text x="340" y="105" fill="#EF4444" fontSize="10" fontFamily="monospace">24F Cut Alert</text>

            <line x1="280" y1="140" x2="420" y2="240" stroke="#10B981" strokeWidth="3" />
            <text x="330" y="200" fill="#10B981" fontSize="10" fontFamily="monospace">24F Active</text>

            {/* Drop Cables to Subscribers */}
            <line x1="420" y1="240" x2="560" y2="260" stroke="#F59E0B" strokeWidth="2" strokeDasharray="3" />
            <line x1="420" y1="240" x2="580" y2="180" stroke="#F59E0B" strokeWidth="2" strokeDasharray="3" />
            <line x1="440" y1="90" x2="580" y2="80" stroke="#EF4444" strokeWidth="2" strokeDasharray="3" />

            {/* OTDR Fault Pin Animation */}
            {otdrFaultPinned && (
              <g>
                <circle cx={otdrFaultPinned.x} cy={otdrFaultPinned.y} r="16" fill="rgba(239, 68, 68, 0.2)" className="animate-ping" />
                <circle cx={otdrFaultPinned.x} cy={otdrFaultPinned.y} r="8" fill="#EF4444" />
                <text x={otdrFaultPinned.x - 30} y={otdrFaultPinned.y - 14} fill="#EF4444" fontSize="11" fontWeight="bold">
                  ⚡ OTDR Break Point (1,450m)
                </text>
              </g>
            )}

            {/* Map Nodes Rendering */}
            {nodes.map((node) => {
              const isSelected = selectedNode?.id === node.id;

              return (
                <g
                  key={node.id}
                  onClick={() => setSelectedNode(node)}
                  className="cursor-pointer transition-transform hover:scale-110"
                >
                  {node.type === 'POP' && (
                    <>
                      <rect
                        x={node.x - 14}
                        y={node.y - 14}
                        width="28"
                        height="28"
                        rx="6"
                        fill="#6366F1"
                        stroke={isSelected ? '#FFFFFF' : '#4F46E5'}
                        strokeWidth="3"
                      />
                      <text x={node.x - 25} y={node.y + 28} fill="#FFFFFF" fontSize="11" fontWeight="bold">
                        {node.name}
                      </text>
                    </>
                  )}

                  {node.type === 'TJ_BOX' && (
                    <>
                      <polygon
                        points={`${node.x},${node.y - 12} ${node.x + 12},${node.y} ${node.x},${node.y + 12} ${node.x - 12},${node.y}`}
                        fill={node.status === 'CRITICAL_LOS' ? '#EF4444' : '#06B6D4'}
                        stroke="#FFFFFF"
                        strokeWidth="2"
                      />
                      <text x={node.x - 20} y={node.y + 26} fill="#E2E8F0" fontSize="10">
                        {node.name}
                      </text>
                    </>
                  )}

                  {node.type === 'SUBSCRIBER' && (
                    <>
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r="6"
                        fill={node.status === 'CRITICAL_LOS' ? '#EF4444' : '#10B981'}
                        stroke="#FFFFFF"
                        strokeWidth="1.5"
                      />
                      <text x={node.x + 10} y={node.y + 4} fill="#94A3B8" fontSize="10">
                        {node.name.split(' ')[0]} ({node.opticalPower} dBm)
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Map Legend Footer */}
          <div className="p-3 border-t border-border bg-card/80 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-indigo-500" /> NOC POP
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rotate-45 bg-cyan-400" /> TJ Box (Splitter)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Normal Optical Signal
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> LOS / Critical Degradation
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground font-mono">Click any element to inspect details</span>
          </div>
        </div>

        {/* Right Sidebar: Element Inspector & OTDR Panel */}
        <div className="space-y-4">
          {/* OTDR Fault Tool */}
          <div className="p-4 rounded-2xl bg-card border border-border shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase tracking-wider">
              <Target className="w-4 h-4" />
              <span>OTDR Distance Fault Locator</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Enter measured OTDR meterage to pinpoint physical cable cuts on the GIS map.
            </p>
            <div>
              <label className="block text-[11px] font-semibold text-foreground mb-1">
                OTDR Meter Distance
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={otdrDistance}
                  onChange={(e) => setOtdrDistance(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-muted/60 border border-border text-foreground font-mono font-bold outline-none"
                />
                <button
                  onClick={handleLocateOtdrFault}
                  className="px-3 py-1.5 text-xs font-bold rounded-xl bg-rose-500 text-white hover:bg-rose-600 transition-colors"
                >
                  Locate
                </button>
              </div>
            </div>
          </div>

          {/* Node Inspector */}
          {selectedNode ? (
            <div className="p-4 rounded-2xl bg-card border border-primary/30 shadow-md space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between pb-2 border-b border-border">
                <span className="text-xs font-bold text-foreground">{selectedNode.name}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {selectedNode.type}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                {selectedNode.totalPorts && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Port Utilization:</span>
                    <span className="font-bold text-foreground">
                      {selectedNode.portsUsed} / {selectedNode.totalPorts} Ports
                    </span>
                  </div>
                )}

                {selectedNode.opticalPower && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Optical RX:</span>
                    <span className={`font-mono font-bold ${selectedNode.opticalPower < -25 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {selectedNode.opticalPower} dBm
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Health Status:</span>
                  <span className={`font-semibold ${selectedNode.status === 'NORMAL' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {selectedNode.status}
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-border flex items-center justify-between">
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          ) : (
            <div className="p-6 rounded-2xl bg-muted/20 border border-border/60 text-center text-xs text-muted-foreground">
              Select any POP, TJ Box, or Subscriber on the map to inspect live optical signal and port capacity.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
