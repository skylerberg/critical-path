import { env } from '../../config/env';
import { ConsoleEmailSender } from './console';
import { MemoryEmailSender } from './memory';
import { SesEmailSender } from './ses';
import type { EmailSender } from './types';

function createEmailSender(driver: string): EmailSender {
  switch (driver) {
    case 'console':
      return new ConsoleEmailSender();
    case 'memory':
      return new MemoryEmailSender();
    case 'ses':
      return new SesEmailSender();
    default:
      throw new Error(`Unknown EMAIL_DRIVER: ${driver}`);
  }
}

let cached: { driver: string; sender: EmailSender } | null = null;

export function getEmailSender(): EmailSender {
  const driver = env.emailDriver;
  if (cached?.driver !== driver) {
    cached = { driver, sender: createEmailSender(driver) };
  }
  return cached.sender;
}

export { ConsoleEmailSender } from './console';
export { MemoryEmailSender, sentEmails, clearSentEmails } from './memory';
export { SesEmailSender } from './ses';
export type { EmailMessage, EmailSender } from './types';
