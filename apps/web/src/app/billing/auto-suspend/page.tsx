'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function BillingAutosuspendAliasPage() {
  const router = useRouter();
  useEffect(()=>{ router.replace("/billing?view=due"); },[router]);
  return <RedirectShell label="Due / Suspension Control" href="/billing?view=due" />;
}
