import type { EmailMessage, EmailSender } from './types';

// Test seam: captures sends so tests can assert on outbound email.
const sent: EmailMessage[] = [];

export class MemoryEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    sent.push(message);
  }
}

export function sentEmails(): EmailMessage[] {
  return [...sent];
}

export function clearSentEmails(): void {
  sent.length = 0;
}
