'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function AllClientInfoAlias() {
  const r = useRouter();
  useEffect(() => { r.replace('/subscribers?view=all-info'); }, [r]);
  return <div className="p-6 text-sm text-muted-foreground">Redirecting to All Client Info...</div>;
}
