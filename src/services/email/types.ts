export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
