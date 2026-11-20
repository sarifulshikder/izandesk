'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function BillingDueanalyticsAliasPage() {
  const router = useRouter();
  useEffect(()=>{ router.replace("/reports#dues-aging"); },[router]);
  return <RedirectShell label="Due Analytics" href="/reports#dues-aging" />;
}
