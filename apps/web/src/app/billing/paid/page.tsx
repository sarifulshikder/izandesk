'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function PaidAlias() {
  const router = useRouter();
  useEffect(()=>{ router.replace('/billing?status=paid'); },[router]);
  return <div className="p-6 text-sm text-muted-foreground">Redirecting to Paid Bills...</div>;
}
