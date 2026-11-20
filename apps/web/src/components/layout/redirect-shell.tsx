'use client';

import Link from 'next/link';
import { LoaderCircle, ArrowUpRight } from 'lucide-react';

/**
 * Branded transition state for legacy/alias routes.
 * Keeps navigation feeling intentional instead of showing a bare text line.
 */
export function RedirectShell({ label, href, hint }: { label: string; href: string; hint?: string }) {
  return (
    <div className="min-h-[58vh] flex items-center justify-center p-6">
      <div className="card w-full max-w-sm p-6 text-center space-y-4">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/15">
          <LoaderCircle className="w-5 h-5 animate-spin" />
        </span>
        <div className="space-y-1.5">
          <span className="page-eyebrow">IzanDesk · Navigation</span>
          <h1 className="text-[15px] font-bold text-foreground">Opening {label}…</h1>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {hint || 'Taking you to the right place. This should only take a moment.'}
          </p>
        </div>
        <Link href={href} className="btn btn-outline btn-sm">
          Go there now <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
