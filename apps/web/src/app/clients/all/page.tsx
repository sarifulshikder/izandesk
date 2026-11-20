'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function ClientsAllAliasPage() {
  const router = useRouter();
  useEffect(()=>{ router.replace("/subscribers"); },[router]);
  return <RedirectShell label="All Clients" href="/subscribers" />;
}
