import { describe, it, expect, afterEach, vi } from 'vitest';
import { ConsoleEmailSender, SesEmailSender, getEmailSender } from '../../src/services/email/index';
import { assertEmailConfig } from '../../src/config/env';

const SES_VARS = [
  'EMAIL_DRIVER',
  'SES_FROM_ADDRESS',
  'SES_REGION',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
] as const;

const originalSesVars = Object.fromEntries(SES_VARS.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of SES_VARS) {
    const original = originalSesVars[name];
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  }
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

// Every send happens in a post-commit hook, which catches and logs; a
// misconfigured deploy therefore answers 2xx and mails nothing until someone
// reads the logs. These hold the check at boot instead.
describe('assertEmailConfig', () => {
  function useSes(vars: Partial<Record<(typeof SES_VARS)[number], string>>): void {
    for (const name of SES_VARS) {
      delete process.env[name];
    }
    process.env.EMAIL_DRIVER = 'ses';
    Object.assign(process.env, vars);
  }

  it('passes for a complete SES configuration', () => {
    useSes({ SES_FROM_ADDRESS: 'no-reply@example.com', SES_REGION: 'us-west-2' });
    expect(() => {
      assertEmailConfig();
    }).not.toThrow();
  });

  it('refuses a boot with EMAIL_DRIVER=ses and no from address', () => {
    useSes({ SES_REGION: 'us-west-2' });
    expect(() => {
      assertEmailConfig();
    }).toThrow(/SES_FROM_ADDRESS is required/);
  });

  it('refuses a boot with no region named anywhere', () => {
    useSes({ SES_FROM_ADDRESS: 'no-reply@example.com' });
    expect(() => {
      assertEmailConfig();
    }).toThrow(/SES_REGION/);
  });

  it('accepts a region supplied the AWS way', () => {
    for (const name of ['AWS_REGION', 'AWS_DEFAULT_REGION'] as const) {
      useSes({ SES_FROM_ADDRESS: 'no-reply@example.com', [name]: 'us-west-2' });
      expect(() => {
        assertEmailConfig();
      }).not.toThrow();
    }
  });

  it('leaves the console and memory drivers alone', () => {
    for (const driver of ['console', 'memory']) {
      for (const name of SES_VARS) {
        delete process.env[name];
      }
      process.env.EMAIL_DRIVER = driver;
      expect(() => {
        assertEmailConfig();
      }).not.toThrow();
    }

    for (const name of SES_VARS) {
      delete process.env[name];
    }
    expect(() => {
      assertEmailConfig();
    }).not.toThrow();
  });
});
