export default function robots() {
  return {
    rules: {
      userAgent: '*',
      disallow: ['/report-access/', '/api/public/'],
    },
  };
}
