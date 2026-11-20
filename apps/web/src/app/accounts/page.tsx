'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function AccountsAliasPage() {
  const router = useRouter();
  useEffect(()=>{ router.replace("/finance"); },[router]);
  return <RedirectShell label="Finance & Accounts" href="/finance" />;
}
