'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function AccountsAlias() { const r = useRouter(); useEffect(()=>{ r.replace('/finance'); },[r]); return <div className="p-6 text-sm text-muted-foreground">Redirecting to Finance & Accounts...</div>; }
