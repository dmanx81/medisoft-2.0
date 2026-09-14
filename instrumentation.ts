import type { Instrumentation } from 'next';

export async function register() {
  const { shouldValidateRuntimeEnvironment } = await import('./lib/env');
  if (!shouldValidateRuntimeEnvironment()) return;
  const { environment } = await import('./lib/env');
  const { configureEmailProvider } = await import('./lib/email/configure');
  const { logInfo } = await import('./lib/log');
  const config = environment();
  configureEmailProvider(config);
  logInfo('Runtime configuration validated', {
    nodeEnv: config.NODE_ENV,
    emailProvider: config.EMAIL_PROVIDER,
  });
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
  const headers = request.headers as Record<string, string | string[] | undefined>;
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
