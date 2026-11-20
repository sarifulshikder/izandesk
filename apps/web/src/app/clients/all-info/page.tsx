'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function ClientsAllinfoAliasPage() {
  const router = useRouter();
  useEffect(()=>{ router.replace("/subscribers?view=all-info"); },[router]);
  return <RedirectShell label="All Client Info" href="/subscribers?view=all-info" />;
}
