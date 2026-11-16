'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function CollectionsAlias() {
  const router = useRouter();
  useEffect(()=>{ router.replace('/billing?view=collections'); },[router]);
  return <div className="p-6 text-sm text-muted-foreground">Redirecting to Today’s Collection...</div>;
}
