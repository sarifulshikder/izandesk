'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function ClientLocationsAlias() {
  const router = useRouter();
  useEffect(() => { router.replace('/gis'); }, [router]);
  return <div className="p-6 text-sm text-muted-foreground">Redirecting to Client Locations (GIS)...</div>;
}
