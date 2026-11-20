'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function PaymentsAliasPage() {
  const router = useRouter();
  useEffect(()=>{ router.replace("/billing?view=payments"); },[router]);
  return <RedirectShell label="Payments" href="/billing?view=payments" />;
}
