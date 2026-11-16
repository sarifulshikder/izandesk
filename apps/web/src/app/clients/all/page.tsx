'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function AllClientsAlias() { const r = useRouter(); useEffect(()=>{ r.replace('/subscribers'); },[r]); return <div className="p-6 text-sm text-muted-foreground">Redirecting to All Clients...</div>; }
