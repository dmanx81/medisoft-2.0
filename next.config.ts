import type { NextConfig } from 'next';
import {
  contentSecurityPolicy,
  permissionsPolicy,
} from './lib/http/security-headers';

const baselineHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Permissions-Policy', value: permissionsPolicy },
];

const sensitiveHeaders = [
  ...baselineHeaders,
  { key: 'Cache-Control', value: 'private, no-store' },
];

const publicReportHeaders = [
  ...sensitiveHeaders,
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['nodemailer'],
  async headers() {
    return [
      { source: '/:path*', headers: baselineHeaders },
      { source: '/login', headers: sensitiveHeaders },
      { source: '/app/:path*', headers: sensitiveHeaders },
      { source: '/api/:path*', headers: sensitiveHeaders },
      { source: '/report-access/:path*', headers: publicReportHeaders },
      { source: '/api/public/:path*', headers: publicReportHeaders },
    ];
  },
};

export default nextConfig;
