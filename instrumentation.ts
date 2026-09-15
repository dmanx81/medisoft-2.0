import type { Instrumentation } from 'next';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
) => {
  const { logError } = await import('./lib/log');
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error
      ? String(error.digest)
      : undefined;
  const headers = request.headers as Record<
    string,
    string | string[] | undefined
  >;
  const requestId = Array.isArray(headers['x-request-id'])
    ? headers['x-request-id'][0]
    : headers['x-request-id'];
  logError('Unhandled request error', {
    name: error instanceof Error ? error.name : 'Error',
    digest,
    method: request.method,
    path: request.path,
    requestId,
  });
};
