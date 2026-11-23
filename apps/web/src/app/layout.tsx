import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { AuthGate } from '@/components/auth/auth-gate';
import { AppShell } from '@/components/layout/app-shell';
import { ThemeScript } from '@/components/theme-script';

export const metadata: Metadata = {
  title: 'IzanDesk ERP — ISP Billing & Network Automation',
  description: 'Carrier-grade ISP billing, MikroTik RouterOS automation, OLT telemetry & FTTH management.',
  manifest: '/manifest.webmanifest',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeScript />
        <AuthProvider>
          <AuthGate>
            <AppShell>{children}</AppShell>
          </AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}
