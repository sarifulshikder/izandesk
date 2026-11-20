'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function BillingUnpaidAliasPage() {
  const router = useRouter();
  useEffect(()=>{ router.replace("/billing?status=unpaid"); },[router]);
  return <RedirectShell label="Unpaid Bills" href="/billing?status=unpaid" />;
}
