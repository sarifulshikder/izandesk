'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { CommandPalette } from '@/components/dashboard/command-palette';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Public/self-contained routes render without admin chrome
  if (pathname?.startsWith('/portal') || pathname === '/walled-garden' || pathname === '/forgot-password') {
    return <>{children}</>;
  }

  return (
    <>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="hidden lg:block w-72 shrink-0" />
        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          <main className="flex-1 p-4 lg:p-8 pb-24 lg:pb-8 max-w-7xl mx-auto w-full space-y-6">
            {children}
          </main>
        </div>
      </div>
      <MobileBottomNav />
      <CommandPalette />
    </>
  );
}
