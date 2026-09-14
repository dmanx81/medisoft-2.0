export const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join('; ');

export const permissionsPolicy =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

export function isSensitivePath(pathname: string) {
  return (
    pathname === '/login' ||
    pathname.startsWith('/app') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/report-access')
  );
}

export function isPublicReportPath(pathname: string) {
  return (
    pathname.startsWith('/report-access') || pathname.startsWith('/api/public/')
  );
}

export function applySecurityHeaders(
  pathname: string,
  headers: Headers,
  options: { productionHttps: boolean },
) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', contentSecurityPolicy);
  headers.set('Permissions-Policy', permissionsPolicy);
  if (options.productionHttps)
    headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  if (isSensitivePath(pathname))
    headers.set('Cache-Control', 'private, no-store');
  if (isPublicReportPath(pathname))
    headers.set('X-Robots-Tag', 'noindex, nofollow');
}

export function securityHeaderInit(pathname = '/api'): HeadersInit {
  const headers = new Headers();
  applySecurityHeaders(pathname, headers, { productionHttps: false });
  return headers;
}
