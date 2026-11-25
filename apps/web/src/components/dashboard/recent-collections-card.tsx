'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, CreditCard } from 'lucide-react';

function money(value: any, currency?: string) {
  const amount = Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(currency || 'BDT').toUpperCase() === 'BDT' ? `৳${amount}` : `${currency || ''} ${amount}`.trim();
}

function dateLabel(payment: any, timezone: string) {
  const value = payment.verified_at || payment.created_at;
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone });
}

export function RecentCollectionsCard({ payments, timezone = 'Asia/Dhaka' }: { payments: any[]; timezone?: string }) {
  return (
    <div className="card h-full">
      <div className="card-header">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="icon-tile shrink-0"><CreditCard /></span>
          <div className="min-w-0">
            <div className="card-title">Recent Collections</div>
            <div className="card-subtitle">Latest completed payments</div>
          </div>
        </div>
        <Link href="/billing/payments" className="topbar-icon-btn !w-8 !h-8" title="View all payments"><ArrowUpRight className="w-3.5 h-3.5" /></Link>
      </div>
      <div className="card-body py-3">
        {payments.length > 0 ? (
          <div className="space-y-1">
            {payments.slice(0, 6).map((payment) => {
              const content = (
                <>
                  <span className="w-6 h-6 rounded-lg bg-success/10 text-success inline-flex items-center justify-center shrink-0"><CheckCircle2 className="w-3.5 h-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] font-semibold truncate">{payment.full_name || payment.client_code || 'Account payment'}</div>
                    <div className="text-[9px] text-muted-foreground truncate mt-0.5">
                      {payment.invoice_number || payment.payment_ref} · {String(payment.method || payment.gateway || 'payment').toUpperCase()}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] font-bold text-success tabular-nums">+{money(payment.amount, payment.currency)}</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">{dateLabel(payment, timezone)}</div>
                  </div>
                </>
              );
              return payment.subscriber_id ? (
                <Link key={payment.id} href={`/subscribers/${payment.subscriber_id}`} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-transparent hover:border-border hover:bg-muted/35 transition-colors">{content}</Link>
              ) : (
                <div key={payment.id} className="flex items-center gap-2.5 px-2.5 py-2">{content}</div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state !py-10">No completed payments recorded yet.</div>
        )}
      </div>
    </div>
  );
}
