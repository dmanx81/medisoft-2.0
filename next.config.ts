import type { NextConfig } from 'next';

const publicReportHeaders = [
  { key: 'Cache-Control', value: 'private, no-store' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      { source: '/report-access/:path*', headers: publicReportHeaders },
      { source: '/api/public/:path*', headers: publicReportHeaders },
    ];
  },
};

export default nextConfig;
