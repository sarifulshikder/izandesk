'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function AutoSuspendAlias() {
  const router = useRouter();
  useEffect(()=>{ router.replace('/billing?view=due'); },[router]);
  return <div className="p-6 text-sm text-muted-foreground">Redirecting to Due/Suspension Control...</div>;
}
