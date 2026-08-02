import { APP_NAME } from '../config/constants';
import { env } from '../config/env';
import { getEmailSender } from './email/index';
import { createVerificationToken } from './emailToken';
import type { AppContext } from '../types/index';

export function enqueueVerificationEmail(
  c: Pick<AppContext, 'get'>,
  user: { id: string; email: string }
): void {
  const link = `${env.appUrlBase}/verify-email?token=${encodeURIComponent(
    createVerificationToken(user.id, user.email)
  )}`;
  const to = user.email;

  c.get('postCommitHooks').push(() =>
    getEmailSender().send({
      to,
      subject: `Verify your ${APP_NAME} email address`,
      text:
        `Confirm that this address belongs to you so ${APP_NAME} can email you.\n\n` +
        `Verify it here (the link expires in 24 hours): ${link}\n\n` +
        'If you did not create this account, you can ignore this email.',
    })
  );
}
