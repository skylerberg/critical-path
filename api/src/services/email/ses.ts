import { env } from '../../config/env';
import type { EmailMessage, EmailSender } from './types';

type SesModule = typeof import('@aws-sdk/client-sesv2');

interface LoadedSes {
  client: InstanceType<SesModule['SESv2Client']>;
  SendEmailCommand: SesModule['SendEmailCommand'];
}

export class SesEmailSender implements EmailSender {
  // Loaded on first send so console-mode processes never pay for the AWS SDK.
  private loaded: Promise<LoadedSes> | null = null;

  private load(): Promise<LoadedSes> {
    this.loaded ??= import('@aws-sdk/client-sesv2').then(({ SESv2Client, SendEmailCommand }) => ({
      client: new SESv2Client(env.sesRegion ? { region: env.sesRegion } : {}),
      SendEmailCommand,
    }));
    return this.loaded;
  }

  async send(message: EmailMessage): Promise<void> {
    const from = env.sesFromAddress;
    if (!from) {
      throw new Error('SES_FROM_ADDRESS is required when EMAIL_DRIVER=ses');
    }
    const { client, SendEmailCommand } = await this.load();
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject },
            Body: { Text: { Data: message.text } },
          },
        },
      })
    );
  }
}
