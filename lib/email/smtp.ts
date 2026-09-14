import nodemailer from 'nodemailer';
import type { AppEnvironment } from '@/lib/env';
import {
  BillingEmailError,
  type BillingEmailMessage,
  type BillingEmailProvider,
  type BillingEmailResult,
} from '@/features/billing/email';

export class SmtpBillingEmailProvider implements BillingEmailProvider {
  constructor(private readonly config: AppEnvironment) {}

  async send(message: BillingEmailMessage): Promise<BillingEmailResult> {
    try {
      const transporter = nodemailer.createTransport(this.transport());
      const info = await transporter.sendMail({
        from: this.config.SMTP_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        attachments: message.attachments.map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          content: attachment.content,
        })),
      });
      return {
        provider: 'smtp',
        messageId: info.messageId || 'smtp',
      };
    } catch {
      throw new BillingEmailError(
        'EMAIL_UNAVAILABLE',
        'Invoice email could not be sent. Try again later.',
      );
    }
  }

  private transport() {
    if (this.config.SMTP_URL)
      return {
        url: this.config.SMTP_URL,
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
      };
    const port = Number(this.config.SMTP_PORT || '587');
    const secure =
      this.config.SMTP_SECURE === 'true' ||
      (this.config.SMTP_SECURE !== 'false' && port === 465);
    return {
      host: this.config.SMTP_HOST,
      port,
      secure,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      auth:
        this.config.SMTP_USER || this.config.SMTP_PASSWORD
          ? {
              user: this.config.SMTP_USER,
              pass: this.config.SMTP_PASSWORD,
            }
          : undefined,
    };
  }
}
