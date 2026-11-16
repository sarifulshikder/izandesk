'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { LoginScreen } from './login-screen';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  // Public/self-contained routes (customer portal, walled garden notice, password recovery) do not require admin auth
  if (pathname?.startsWith('/portal') || pathname === '/walled-garden' || pathname === '/forgot-password') {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="w-10 h-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          <div className="text-sm font-medium">Initializing IzanDesk ERP...</div>
        </div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;
  return <>{children}</>;
}
