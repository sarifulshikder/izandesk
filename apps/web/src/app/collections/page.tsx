'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function CollectionsAliasPage() {
  const router = useRouter();
  useEffect(()=>{ router.replace("/billing?view=collections"); },[router]);
  return <RedirectShell label="Today’s Collection" href="/billing?view=collections" />;
}
