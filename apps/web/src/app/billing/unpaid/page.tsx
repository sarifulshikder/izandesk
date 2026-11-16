'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function UnpaidAlias() {
  const router = useRouter();
  useEffect(()=>{ router.replace('/billing?status=unpaid'); },[router]);
  return <div className="p-6 text-sm text-muted-foreground">Redirecting to Unpaid Bills...</div>;
}
