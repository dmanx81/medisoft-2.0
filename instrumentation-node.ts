import { environment, shouldValidateRuntimeEnvironment } from './lib/env';
import { logInfo } from './lib/log';

if (shouldValidateRuntimeEnvironment()) {
  const config = environment();
  logInfo('Runtime configuration validated', {
    nodeEnv: config.NODE_ENV,
    emailProvider: config.EMAIL_PROVIDER,
  });
}
