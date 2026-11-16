'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function PaymentsAlias() {
  const router = useRouter();
  useEffect(()=>{ router.replace('/billing?view=payments'); },[router]);
  return <div className="p-6 text-sm text-muted-foreground">Redirecting to Payments...</div>;
}
