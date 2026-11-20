'use client';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function ClientsAliasPage() {
  const router = useRouter();
  const sp = useSearchParams();
  useEffect(() => {
    const qs = sp?.toString();
    router.replace(`/subscribers${qs ? `?${qs}` : ''}`);
  }, [router, sp]);
  return <RedirectShell label="Clients (Subscribers)" href="/subscribers" />;
}
