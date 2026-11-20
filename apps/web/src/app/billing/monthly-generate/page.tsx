'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function BillingMonthlygenerateAliasPage() {
  const router = useRouter();
  useEffect(()=>{ router.replace("/billing#billing-invoices"); },[router]);
  return <RedirectShell label="Billing" href="/billing#billing-invoices" />;
}
