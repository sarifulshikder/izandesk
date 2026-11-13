'use client';

import React, { useState, useEffect } from 'react';
import { Activity, Radio, ArrowDown, ArrowUp } from 'lucide-react';

export function LiveTrafficChart() {
  const [downloadSpeed, setDownloadSpeed] = useState(4820); // Mbps
  const [uploadSpeed, setUploadSpeed] = useState(1940); // Mbps
  const [history, setHistory] = useState<number[]>([
    4200, 4400, 4350, 4600, 4750, 4700, 4820, 4900, 4850, 4920, 4880, 5010, 4820
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      // Simulate live jitter and realistic traffic fluctuation
      const newDown = Math.floor(4600 + Math.random() * 600);
      const newUp = Math.floor(1800 + Math.random() * 300);
      setDownloadSpeed(newDown);
      setUploadSpeed(newUp);
      setHistory((prev) => [...prev.slice(1), newDown]);
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Compute SVG polyline points
  const maxVal = 6000;
  const minVal = 3500;
  const width = 600;
  const height = 140;

  const points = history
    .map((val, idx) => {
      const x = (idx / (history.length - 1)) * width;
      const y = height - ((val - minVal) / (maxVal - minVal)) * (height - 20) - 10;
      return `${x},${y}`;
    })
    .join(' ');

  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <div className="p-5 rounded-2xl bg-card border border-border/80 shadow-sm flex flex-col justify-between">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary shrink-0">
            <Radio className="w-4 h-4 animate-pulse" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground tracking-tight">Core Interface Real-Time Throughput</h3>
            <p className="text-[11px] text-muted-foreground">Aggregated BDIX + IIG Upstream (Live WebSocket Telemetry)</p>
          </div>
        </div>

        {/* Live Gauges */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <ArrowDown className="w-3.5 h-3.5" />
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold tracking-wider block text-cyan-400/70">RX (Down)</span>
              <span className="font-mono text-xs font-bold">{(downloadSpeed / 1000).toFixed(2)} Gbps</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <ArrowUp className="w-3.5 h-3.5" />
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold tracking-wider block text-indigo-400/70">TX (Up)</span>
              <span className="font-mono text-xs font-bold">{(uploadSpeed / 1000).toFixed(2)} Gbps</span>
            </div>
          </div>
        </div>
      </div>

      {/* SVG Traffic Waveform */}
      <div className="w-full h-36 relative overflow-hidden rounded-xl bg-muted/20 border border-border/40 p-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
          <defs>
            <linearGradient id="trafficGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <polygon points={areaPoints} fill="url(#trafficGradient)" />
          <polyline fill="none" stroke="#06B6D4" strokeWidth="2.5" strokeLinecap="round" points={points} />
        </svg>

        {/* Dynamic Watermark Indicator */}
        <div className="absolute bottom-2 left-3 text-[10px] font-mono text-muted-foreground flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
          <span>Polling interval: 2000ms • Zero CPU Overhead</span>
        </div>
      </div>
    </div>
  );
}
