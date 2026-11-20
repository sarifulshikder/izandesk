'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function ClientsLocationsAliasPage() {
  const router = useRouter();
  useEffect(()=>{ router.replace("/gis"); },[router]);
  return <RedirectShell label="Client Locations" href="/gis" />;
}
