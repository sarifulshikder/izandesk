'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function AllBillsAlias() {
  const router = useRouter();
  useEffect(()=>{ router.replace('/billing?status=all'); },[router]);
  return <div className="p-6 text-sm text-muted-foreground">Redirecting to All Bills...</div>;
}
