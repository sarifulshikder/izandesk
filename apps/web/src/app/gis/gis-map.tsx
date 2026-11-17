'use client';

import React from 'react';
import { DivIcon } from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// No CDN marker images: boxes use a DivIcon and subscribers use CircleMarkers.
// Point NEXT_PUBLIC_GIS_TILE_URL at an internal tile server for offline/air-gapped
// deployments, and NEXT_PUBLIC_GIS_CENTER at "lat,lng" for a different region.
const TILE_URL = process.env.NEXT_PUBLIC_GIS_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_CENTER: [number, number] = [23.8103, 90.4125];
const parseCenter = (): [number, number] => {
  const raw = process.env.NEXT_PUBLIC_GIS_CENTER;
  if (!raw) return DEFAULT_CENTER;
  const [lat, lng] = raw.split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : DEFAULT_CENTER;
};

const boxIcon = new DivIcon({
  className: '',
  html: `<div style="width:18px;height:18px;border-radius:4px;background:#3b82f6;border:2px solid white;box-shadow:0 0 0 2px rgba(59,130,246,.4)"></div>`,
  iconSize: [18,18], iconAnchor: [9,9]
});

function ClickCapture({ onPick }: { onPick: (lat:number,lng:number)=>void }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

export default function GisMap({ data, onPick, draftLine }: any) {
  const center: [number, number] = parseCenter();
  const boxes = data?.boxes?.features || [];
  const subs = data?.subscribers?.features || [];
  const routes = data?.fiberRoutes?.features || [];

  return (
    <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }} className="rounded-2xl overflow-hidden">
      <TileLayer attribution='&copy; OpenStreetMap contributors' url={TILE_URL} />
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
