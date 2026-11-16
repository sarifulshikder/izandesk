import type { NextConfig } from 'next';

const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // Allow remote/NAT public access during development via env: ALLOWED_DEV_ORIGINS=host1,host2
  ...(allowedDevOrigins.length ? { allowedDevOrigins } : {}),
  // Allow isolated verification builds when a dev server owns the default .next dir.
  ...(process.env.IZANDESK_DIST_DIR ? { distDir: process.env.IZANDESK_DIST_DIR } : {}),
  async rewrites() {
    const api = process.env.INTERNAL_API_URL || 'http://localhost:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${api}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
