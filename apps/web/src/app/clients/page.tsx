'use client';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function ClientsAliasPage() {
  const router = useRouter();
  const sp = useSearchParams();
  useEffect(() => {
    const qs = sp?.toString();
    router.replace(`/subscribers${qs ? `?${qs}` : ''}`);
  }, [router, sp]);
  return <div className="p-6 text-sm text-muted-foreground">Redirecting to Clients (Subscribers)...</div>;
}
