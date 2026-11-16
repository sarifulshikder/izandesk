'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function PaymentsRootAlias() { const r = useRouter(); useEffect(()=>{ r.replace('/billing?view=payments'); },[r]); return <div className="p-6 text-sm text-muted-foreground">Redirecting to Payments...</div>; }
