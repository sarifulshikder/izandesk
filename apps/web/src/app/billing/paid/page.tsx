'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function BillingPaidAliasPage() {
  const router = useRouter();
  useEffect(()=>{ router.replace("/billing?status=paid"); },[router]);
  return <RedirectShell label="Paid Bills" href="/billing?status=paid" />;
}
