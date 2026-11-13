'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const boxIcon = new L.DivIcon({
  className: '',
  html: `<div style="width:18px;height:18px;border-radius:4px;background:#3b82f6;border:2px solid white;box-shadow:0 0 0 2px rgba(59,130,246,.4)"></div>`,
  iconSize: [18,18], iconAnchor: [9,9]
});

function ClickCapture({ onPick }: { onPick: (lat:number,lng:number)=>void }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

export default function GisMap({ data, onPick, draftLine }: any) {
  const center: [number, number] = [23.8103, 90.4125];
  const boxes = data?.boxes?.features || [];
  const subs = data?.subscribers?.features || [];
  const routes = data?.fiberRoutes?.features || [];

  return (
    <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }} className="rounded-2xl overflow-hidden">
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {onPick && <ClickCapture onPick={onPick} />}
      {boxes.map((f: any) => {
        const [lng, lat] = f.geometry.coordinates;
        const p = f.properties;
        return (
          <Marker key={`b-${p.id}`} position={[lat,lng]} icon={boxIcon}>
            <Popup>
              <div style={{minWidth:180}}>
                <b>{p.name}</b> {p.code ? `(${p.code})` : ''}<br/>
                Type: {p.box_type} • Ports: {p.capacity_ports}<br/>
                Subscribers: {p.subscriber_count || 0}<br/>
                {p.zone_name || ''} {p.area_name ? `, ${p.area_name}` : ''}
              </div>
            </Popup>
          </Marker>
        );
      })}
      {subs.map((f: any) => {
        const [lng, lat] = f.geometry.coordinates;
        const p = f.properties;
        const color = p.status === 'ACTIVE' ? '#22c55e' : p.status === 'SUSPENDED' ? '#ef4444' : '#f59e0b';
        return (
          <CircleMarker key={`s-${p.id}`} center={[lat,lng]} radius={6} pathOptions={{ color, fillColor: color, fillOpacity: 0.9, weight: 2 }}>
            <Popup>
              <div style={{minWidth:180}}>
                <b>{p.full_name}</b><br/>
                {p.client_code}<br/>
                {p.connection_type} {p.username ? `• ${p.username}` : ''}<br/>
                Status: {p.status}<br/>
                Box: {p.distribution_box_name || '-'}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
      {routes.map((f: any) => {
        const coords = (f.geometry.coordinates || []).map((c: any) => [c[1], c[0]]);
        return <Polyline key={`r-${f.properties.id}`} positions={coords} pathOptions={{ color: '#06b6d4', weight: 4, opacity: 0.8 }}><Popup><b>{f.properties.name}</b><br/>{f.properties.from_box_name || '?'} → {f.properties.to_box_name || '?'}</Popup></Polyline>;
      })}
      {draftLine && draftLine.length >= 2 && <Polyline positions={draftLine} pathOptions={{ color: '#f59e0b', weight: 4, dashArray: '6 6' }} />}
    </MapContainer>
  );
}
