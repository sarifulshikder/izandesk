'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function BillingAllAliasPage() {
  const router = useRouter();
  useEffect(()=>{ router.replace("/billing?status=all"); },[router]);
  return <RedirectShell label="All Bills" href="/billing?status=all" />;
}
