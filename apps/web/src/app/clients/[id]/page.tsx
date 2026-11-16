'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function ClientDetailAliasPage() {
  const router = useRouter();
  const params = useParams() as { id?: string };
  useEffect(() => {
    if (params?.id) router.replace(`/subscribers/${params.id}`);
  }, [router, params]);
  return <div className="p-6 text-sm text-muted-foreground">Redirecting to client profile...</div>;
}
