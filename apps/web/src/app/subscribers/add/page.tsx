'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function SubscribersAddAliasPage() {
  const router = useRouter();
  useEffect(()=>{ router.replace("/subscribers?new=1"); },[router]);
  return <RedirectShell label="Add Subscriber" href="/subscribers?new=1" />;
}
