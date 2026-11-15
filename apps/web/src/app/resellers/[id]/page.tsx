'use client';

import { useParams } from 'next/navigation';
import { ResellerPortal } from '@/components/resellers/reseller-portal';

export default function ResellerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || '');
  if (!id) return null;
  return <ResellerPortal resellerId={id} />;
}
