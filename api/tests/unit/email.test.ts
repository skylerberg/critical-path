import { describe, it, expect, afterEach, vi } from 'vitest';
import { ConsoleEmailSender, SesEmailSender, getEmailSender } from '../../src/services/email/index';

afterEach(() => {
  delete process.env.EMAIL_DRIVER;
  vi.restoreAllMocks();
});

describe('ConsoleEmailSender', () => {
  it('logs the full email', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await new ConsoleEmailSender().send({
      to: 'someone@example.com',
      subject: 'Reset your password',
      text: 'Click here: http://localhost:5173/reset-password?token=abc',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0]
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ');
    expect(logged).toContain('someone@example.com');
    expect(logged).toContain('Reset your password');
    expect(logged).toContain('http://localhost:5173/reset-password?token=abc');
  });
});

describe('getEmailSender', () => {
  it('defaults to the console driver', () => {
    expect(getEmailSender()).toBeInstanceOf(ConsoleEmailSender);
  });

  it('returns the ses driver when EMAIL_DRIVER=ses', () => {
    process.env.EMAIL_DRIVER = 'ses';
    expect(getEmailSender()).toBeInstanceOf(SesEmailSender);
  });

  it('caches per driver and follows driver changes', () => {
    process.env.EMAIL_DRIVER = 'console';
    const first = getEmailSender();
    expect(getEmailSender()).toBe(first);
    process.env.EMAIL_DRIVER = 'ses';
    expect(getEmailSender()).toBeInstanceOf(SesEmailSender);
  });

  it('throws on an unknown driver', () => {
    process.env.EMAIL_DRIVER = 'carrier-pigeon';
    expect(() => getEmailSender()).toThrow(/Unknown EMAIL_DRIVER/);
  });
});

describe('SesEmailSender', () => {
  it('fails fast without SES_FROM_ADDRESS before loading the SDK', async () => {
    delete process.env.SES_FROM_ADDRESS;
    await expect(
      new SesEmailSender().send({ to: 'a@example.com', subject: 's', text: 't' })
    ).rejects.toThrow(/SES_FROM_ADDRESS/);
  });
});
