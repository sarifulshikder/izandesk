'use client';

import React, { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { CommandPalette } from '@/components/dashboard/command-palette';
import AiChatBubble from '@/components/ai/chat-bubble';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  // Resellers have no use for the admin dashboard — send them straight to their portal.
  useEffect(() => {
    if (user?.role === 'RESELLER' && pathname === '/') window.location.replace('/resellers');
  }, [user?.role, pathname]);
  // Public/self-contained routes render without admin chrome
  if (pathname?.startsWith('/portal') || pathname === '/walled-garden' || pathname === '/forgot-password') {
    return <>{children}</>;
  }

  return (
    <>
      <div className="page">
        <Sidebar />
        <div className="page-wrapper">
          <Header />
          <main className="page-body">
            <div className="container-xl space-y-5">{children}</div>
          </main>
        </div>
      </div>
      <MobileBottomNav />
      <CommandPalette />
      <AiChatBubble />
    </>
  );
}
