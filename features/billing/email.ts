export type BillingEmailAttachment = {
  filename: string;
  contentType: string;
  content: Buffer;
};

export type BillingEmailMessage = {
  to: string;
  subject: string;
  text: string;
  attachments: BillingEmailAttachment[];
};

export type BillingEmailResult = {
  provider: string;
  messageId: string;
};

export interface BillingEmailProvider {
  send(message: BillingEmailMessage): Promise<BillingEmailResult>;
}

export class StubBillingEmailProvider implements BillingEmailProvider {
  readonly sent: BillingEmailMessage[] = [];
  async send(message: BillingEmailMessage): Promise<BillingEmailResult> {
    this.sent.push(message);
    return {
      provider: 'stub',
      messageId: `stub-${String(this.sent.length).padStart(6, '0')}`,
    };
  }
}

let provider: BillingEmailProvider = new StubBillingEmailProvider();

export function billingEmailProvider() {
  return provider;
}

export function setBillingEmailProvider(next: BillingEmailProvider) {
  provider = next;
}
