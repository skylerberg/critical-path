import { logger } from '../../utils/logger';
import type { EmailMessage, EmailSender } from './types';

export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    logger.info({
      msg: 'Email (console driver)',
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
