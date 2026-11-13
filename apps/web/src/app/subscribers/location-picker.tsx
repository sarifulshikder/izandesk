'use client';

import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, LayerGroup, LayersControl, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function ClickToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => { if (Number.isFinite(lat) && Number.isFinite(lng)) map.setView([lat, lng], Math.max(map.getZoom(), 17), { animate: true }); }, [lat, lng, map]);
  return null;
}

export default function LocationPicker({ lat, lng, onChange }: { lat?: number | null; lng?: number | null; onChange: (lat: number, lng: number) => void }) {
  const hasPoint = Number.isFinite(lat as number) && Number.isFinite(lng as number);
  const center: [number, number] = hasPoint ? [Number(lat), Number(lng)] : [23.8103, 90.4125];
  const [markerPos, setMarkerPos] = useState<[number, number] | null>(hasPoint ? [Number(lat), Number(lng)] : null);

  useEffect(() => {
    if (hasPoint) setMarkerPos([Number(lat), Number(lng)]);
  }, [lat, lng, hasPoint]);

  const pick = (la: number, lo: number) => {
    setMarkerPos([la, lo]);
    onChange(la, lo);
  };

  return (
    <div className="h-[320px] sm:h-[420px] w-full rounded-xl overflow-hidden border border-border">
      <MapContainer center={center} zoom={hasPoint ? 17 : 12} style={{ height: '100%', width: '100%' }}>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Satellite + Labels (Best Free)">
            <LayerGroup>
              <TileLayer
                attribution='Imagery &copy; Esri'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
              />
              <TileLayer
                attribution='Labels &copy; Esri'
                url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
                pane="overlayPane"
              />
              <TileLayer
                url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
                pane="overlayPane"
              />
            </LayerGroup>
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite + OSM Labels">
            <LayerGroup>
              <TileLayer
                attribution='Imagery &copy; Esri; Labels &copy; OpenStreetMap contributors & CARTO'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
              />
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png"
                subdomains={['a','b','c','d']}
                maxZoom={20}
                pane="overlayPane"
                opacity={0.95}
              />
            </LayerGroup>
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite Only">
            <TileLayer
              attribution='Imagery &copy; Esri'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Street">
            <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          </LayersControl.BaseLayer>
        </LayersControl>
        <ClickToPick onPick={pick} />
        {markerPos && <Recenter lat={markerPos[0]} lng={markerPos[1]} />}
        {markerPos && (
          <Marker
            position={markerPos}
            draggable
            eventHandlers={{ dragend: (e: any) => { const p = e.target.getLatLng(); pick(p.lat, p.lng); } }}
          />
        )}
      </MapContainer>
    </div>
  );
}
