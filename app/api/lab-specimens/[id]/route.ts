export const runtime = 'nodejs';
export function DELETE() {
  return new Response(null, {
    status: 405,
    headers: {
      Allow: 'POST',
      'Cache-Control': 'private, no-store',
    },
  });
}
