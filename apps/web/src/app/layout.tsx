import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { AuthGate } from '@/components/auth/auth-gate';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { CommandPalette } from '@/components/dashboard/command-palette';

export const metadata: Metadata = {
  title: 'IzanDesk ERP — ISP Billing & Network Automation',
  description: 'Carrier-grade ISP billing, MikroTik RouterOS automation, OLT telemetry & FTTH management.',
};

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="flex min-h-screen">
        {/* Responsive Sidebar — overlay on mobile, sticky on desktop */}
        <Sidebar />

        {/* Desktop spacer so content doesn't go under fixed sidebar */}
        <div className="hidden lg:block w-72 shrink-0" />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          <main className="flex-1 p-4 lg:p-8 max-w-7xl mx-auto w-full space-y-6">
            {children}
          </main>
        </div>
      </div>

      {/* Universal Cmd+K Command Palette */}
      <CommandPalette />
    </>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased selection:bg-primary/20 selection:text-primary">
        <AuthProvider>
          <AuthGate>
            <AppShell>{children}</AppShell>
          </AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}
