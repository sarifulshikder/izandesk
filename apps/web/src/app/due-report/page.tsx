'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function DueReportAlias() { const r = useRouter(); useEffect(()=>{ r.replace('/reports#dues-aging'); },[r]); return <div className="p-6 text-sm text-muted-foreground">Redirecting to Due Analytics...</div>; }
