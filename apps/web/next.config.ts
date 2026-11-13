import type { NextConfig } from 'next';

const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // Allow remote/NAT public access during development via env: ALLOWED_DEV_ORIGINS=host1,host2
  ...(allowedDevOrigins.length ? { allowedDevOrigins } : {}),
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
