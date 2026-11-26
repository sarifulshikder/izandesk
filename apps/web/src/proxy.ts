import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js 16 "proxy" (formerly middleware).
 *
 * Besides tagging the request host, it implements the captive-portal
 * catch-all: when the ISP router NAT-redirects a restricted subscriber's
 * HTTP traffic (tcp/80) to this server, the request still carries the
 * ORIGINAL foreign Host header (e.g. www.google.com). Those requests are
 * 302'd to the public expiry notice page on the real portal host, so the
 * "your subscription has expired — please recharge" page appears
 * automatically the moment the subscriber opens any website.
 */

const knownHosts = new Set(
  (process.env.APP_KNOWN_HOSTS || 'izandesk.duckdns.org')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

const brandCache = new Map<string, { at: number; known: boolean }>();
const BRAND_TTL_MS = 30_000;

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

async function isKnownHost(host: string): Promise<boolean> {
  if (!host) return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || isIpLiteral(host)) return true;
  if (knownHosts.has(host)) return true;
  const cached = brandCache.get(host);
  if (cached && Date.now() - cached.at < BRAND_TTL_MS) return cached.known;
  // Reseller custom domains / subdomains are legitimate app hosts.
  let known = false;
  try {
    const api = process.env.INTERNAL_API_URL || 'http://localhost:4000';
    const r = await fetch(`${api}/api/branding/resolve?host=${encodeURIComponent(host)}`, { cache: 'no-store' });
    const d: any = await r.json().catch(() => ({}));
    known = !!d?.brand;
  } catch {}
  brandCache.set(host, { at: Date.now(), known });
  return known;
}

const NEVER_REDIRECT = new Set(['/expired', '/walled-garden', '/favicon.ico', '/manifest.webmanifest', '/robots.txt']);

export async function proxy(req: NextRequest) {
  const host = (req.headers.get('host') || '').split(':')[0].toLowerCase();
  const path = req.nextUrl.pathname;

  // Captive catch-all: foreign Host header + not an API/asset path → the
  // router redirected this subscriber here → show the expiry notice page.
  if (
    host &&
    !path.startsWith('/api/') &&
    !path.startsWith('/_next/') &&
    !NEVER_REDIRECT.has(path) &&
    !(await isKnownHost(host))
  ) {
    const base = (process.env.CAPTIVE_REDIRECT_BASE_URL || 'https://izandesk.duckdns.org').replace(/\/+$/, '');
    return NextResponse.redirect(`${base}/expired`, 302);
  }

  const res = NextResponse.next();
  res.headers.set('x-izandesk-host', host);
  if (host && !['localhost', '127.0.0.1'].includes(host)) {
    res.cookies.set('iz_host', host, { path: '/', sameSite: 'lax' });
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
