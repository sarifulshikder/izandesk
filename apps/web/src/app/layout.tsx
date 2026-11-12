import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { CommandPalette } from '@/components/dashboard/command-palette';

export const metadata: Metadata = {
  title: 'IzanDesk ERP — ISP Billing & Network Automation',
  description: 'Carrier-grade ISP billing, MikroTik RouterOS automation, OLT telemetry & FTTH management.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased selection:bg-primary/20 selection:text-primary">
        <AuthProvider>
          <div className="flex min-h-screen">
            {/* Desktop Collapsible Sidebar */}
            <Sidebar />

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0">
              <Header />
              <main className="flex-1 p-4 lg:p-8 pb-20 lg:pb-8 max-w-7xl mx-auto w-full space-y-6">
                {children}
              </main>
              {/* Mobile Thumb Navigation */}
              <MobileBottomNav />
            </div>
          </div>

          {/* Universal Cmd+K Command Palette */}
          <CommandPalette />
        </AuthProvider>
      </body>
    </html>
  );
}
