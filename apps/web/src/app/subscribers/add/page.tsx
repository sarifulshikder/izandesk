'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function AddSubscriberAlias() { const r = useRouter(); useEffect(()=>{ r.replace('/subscribers?new=1'); },[r]); return <div className="p-6 text-sm text-muted-foreground">Redirecting to Add Subscriber...</div>; }
