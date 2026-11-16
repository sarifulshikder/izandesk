'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function CollectionsRootAlias() { const r = useRouter(); useEffect(()=>{ r.replace('/billing?view=collections'); },[r]); return <div className="p-6 text-sm text-muted-foreground">Redirecting to Today’s Collection...</div>; }
