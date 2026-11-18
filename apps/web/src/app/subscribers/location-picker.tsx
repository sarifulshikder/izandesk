'use client';

import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Same free, key-free hybrid basemap as the GIS workbench: Esri imagery plus
// OpenFreeMap OSM vector labels. No CDN marker icons, no API key.
const STYLE_URL = process.env.NEXT_PUBLIC_GIS_BASEMAP_STYLE_URL || '/gis-basemap.json';
const DEFAULT_CENTER: [number, number] = [90.4125, 23.8103]; // [lng, lat]
const STREET_TEXT = '#374151';
const STREET_HALO = 'rgba(255,255,255,0.95)';
const SAT_TEXT = '#ffffff';
const SAT_HALO = 'rgba(0,0,0,0.85)';

function applyBasemap(map: MapLibreMap, streets: boolean) {
  const meta: any = map.getStyle()?.metadata || {};
  const vis = (id: string, on: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  };
  for (const id of meta.streetLayers || []) vis(id, streets);
  vis(meta.satelliteLayer, !streets);
  for (const id of meta.labelLayers || []) {
    if (!map.getLayer(id)) continue;
    vis(id, true);
    if (map.getPaintProperty(id, 'text-color') !== undefined) map.setPaintProperty(id, 'text-color', streets ? STREET_TEXT : SAT_TEXT);
    if (map.getPaintProperty(id, 'text-halo-color') !== undefined) map.setPaintProperty(id, 'text-halo-color', streets ? STREET_HALO : SAT_HALO);
  }
}

export default function LocationPicker({ lat, lng, onChange }: {
  lat?: number | null; lng?: number | null; onChange: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [ready, setReady] = useState(false);
  const [streets, setStreets] = useState(false);
  const streetsRef = useRef(streets);
  streetsRef.current = streets;
  const hasPoint = Number.isFinite(lat as number) && Number.isFinite(lng as number);

  useEffect(() => {
    let map: MapLibreMap | null = null;
    let cancelled = false;
    (async () => {
      let style: any = STYLE_URL;
      try {
        const res = await fetch(STYLE_URL);
        if (res.ok) style = await res.json();
      } catch {}
      if (cancelled || !containerRef.current) return;
      map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: hasPoint ? [Number(lng), Number(lat)] : DEFAULT_CENTER,
        zoom: hasPoint ? 17 : 12,
        maxZoom: 19,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.on('load', () => {
        const m = map!;
        applyBasemap(m, streetsRef.current);
        const el = document.createElement('div');
        el.className = 'gis-picker-marker';
        el.innerHTML = '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#2563eb;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.45)"></div>';
        const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' })
          .setLngLat(hasPoint ? [Number(lng), Number(lat)] : DEFAULT_CENTER).addTo(m);
        if (!hasPoint) el.style.display = 'none';
        marker.on('dragend', () => {
          const ll = marker.getLngLat();
          onChangeRef.current(ll.lat, ll.lng);
        });
        m.on('click', (e) => {
          el.style.display = '';
          marker.setLngLat([e.lngLat.lng, e.lngLat.lat]);
          onChangeRef.current(e.lngLat.lat, e.lngLat.lng);
        });
        markerRef.current = marker;
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      markerRef.current?.remove();
      markerRef.current = null;
      if (map) { try { map.remove(); } catch {} }
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the pin in sync when coordinates are typed or filled by geocoding.
  useEffect(() => {
    if (!ready || !mapRef.current || !hasPoint) return;
    const next: [number, number] = [Number(lng), Number(lat)];
    const cur = markerRef.current?.getLngLat();
    if (cur && Math.abs(cur.lng - next[0]) < 1e-6 && Math.abs(cur.lat - next[1]) < 1e-6) return;
    const el = markerRef.current?.getElement();
    if (el) el.style.display = '';
    markerRef.current?.setLngLat(next);
    mapRef.current.easeTo({ center: next, zoom: Math.max(mapRef.current.getZoom(), 17), duration: 400 });
  }, [ready, lat, lng, hasPoint]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    applyBasemap(mapRef.current, streets);
  }, [ready, streets]);

  return (
    <div className="relative h-[320px] sm:h-[420px] w-full rounded-xl overflow-hidden border border-border">
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute top-2 right-2 z-10 flex overflow-hidden rounded-lg border border-border bg-card/95 shadow text-xs">
        <button onClick={() => setStreets(false)} className={`px-2.5 py-1 ${streets ? 'text-muted-foreground' : 'bg-primary text-primary-foreground'}`}>Satellite</button>
        <button onClick={() => setStreets(true)} className={`px-2.5 py-1 ${streets ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>Streets</button>
      </div>
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground bg-muted/20">Loading map…</div>}
    </div>
  );
}
