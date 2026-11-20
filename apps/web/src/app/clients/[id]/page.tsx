'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { RedirectShell } from '@/components/layout/redirect-shell';

export default function ClientDetailAliasPage() {
  const router = useRouter();
  const params = useParams() as { id?: string };
  useEffect(() => {
    if (params?.id) router.replace(`/subscribers/${params.id}`);
  }, [router, params]);
  return <RedirectShell label="Client Profile" href="/subscribers" />;
}
