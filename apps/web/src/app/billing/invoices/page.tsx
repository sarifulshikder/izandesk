'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function BillingInvoicesAliasPage() {
  const router = useRouter();
  useEffect(()=>{ router.replace("/billing?view=invoices"); },[router]);
  return <RedirectShell label="Invoices" href="/billing?view=invoices" />;
}
