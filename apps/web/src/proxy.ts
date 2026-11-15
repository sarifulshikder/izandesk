import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(req: NextRequest) {
  const host = (req.headers.get('host') || '').split(':')[0].toLowerCase();
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
