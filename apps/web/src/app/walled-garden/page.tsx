'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, CreditCard, Phone, MessageCircle, Mail, LifeBuoy, ExternalLink } from 'lucide-react';

export default function WalledGardenPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-xl card overflow-hidden">
        <div className="px-6 py-5 border-b border-border bg-card-cap/60 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/10 text-warning border border-warning/20">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
          </span>
          <div>
            <span className="page-eyebrow">অ্যাকাউন্ট অ্যাক্সেস · নীতি নোটিশ</span>
            <h1 className="text-[17px] font-bold text-foreground">সার্ভিস সীমাবদ্ধ</h1>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            আপনার ইন্টারনেট অ্যাক্সেস বর্তমানে সীমাবদ্ধ কারণ আপনার অ্যাকাউন্টে বিল বাকি বা স্ট্যাটাস নীতির কারণে। আপনার অ্যাকাউন্ট ক্লিয়ার হলে সার্ভিস আটোমেটিকভাবে ফিরে যাবে।
          </p>
          <div className="alert alert-warning">
            <div className="space-y-1.5">
              <div className="font-semibold">পূর্ণ সার্ভিস ফিরিয়ে আনতে হলে</div>
              <ul className="list-disc pl-5 space-y-1 text-[12px] leading-relaxed">
                <li>আইজানডেস্ক বিলিং পোর্টাল বা উপলব্ধ পেমেন্ট মেথড (বিকাশ/নগদ/রকেট/কার্ড/পেপ্যাল) দিয়ে বাকি ইনভয়েস चुका করুন।</li>
                <li>পেমেন্ট কনফার্ম হলে অটোমেটিক সার্ভিস চালু হবে (২ সেকেন্ডের কম) — ম্যানুয়াল কিছু করতে হবena।</li>
                <li>আপনি যদি সম্প্রতিতে পেমেন্ট করেছেন এবং সার্ভিস না চলে, তাহলে PPPoE রিকানেক্ট করুন বা ক্লায়েন্ট আইডি/ইউজারনেম ও ট্রানজ্যাকশন রেফারেন্স দিয়ে সাপোর্টে যোগাযোগ করুন।</li>
              </ul>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link href="/billing" className="btn btn-primary justify-center">বিলিং / পেমেন্ট খুলুন</Link>
            <Link href="/portal" className="btn btn-outline justify-center">পোর্টাল হোম</Link>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            আপনার আইএসপি রাউটার/NAS আপনাকে এই পেজে রিডাইরেক্ট করেছে কারণ আপনার অ্যাকাউন্ট রিস্ট্রিক্টেড (walled-garden) স্টেটে। বিল বাকি থাকা পর্যন্ত শুধু পেমেন্ট ও পোর্টাল সার্ভিস অ্যাক্সেসIBLE।
          </p>
        </div>
      </div>
    </div>
  );
}