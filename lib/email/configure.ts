import type { AppEnvironment } from '@/lib/env';
import {
  DisabledBillingEmailProvider,
  StubBillingEmailProvider,
  setBillingEmailProvider,
} from '@/features/billing/email';
import { SmtpBillingEmailProvider } from './smtp';

export function configureEmailProvider(config: AppEnvironment) {
  if (config.EMAIL_PROVIDER === 'disabled') {
    setBillingEmailProvider(new DisabledBillingEmailProvider());
    return;
  }
  if (config.EMAIL_PROVIDER === 'smtp') {
    setBillingEmailProvider(new SmtpBillingEmailProvider(config));
    return;
  }
  setBillingEmailProvider(new StubBillingEmailProvider());
}
