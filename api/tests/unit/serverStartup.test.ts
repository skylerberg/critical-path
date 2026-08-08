import { describe, it, expect } from 'vitest';
import { startupFailureMessage } from '../../src/utils/serverStartup';

function errno(code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`listen ${code}`);
  error.code = code;
  return error;
}

describe('startupFailureMessage', () => {
  // The message is the whole fix for a taken port: the bind failure was already
  // logged, as an uncaught exception that named neither the port nor the way out.
  it('names the port and both ways out when it is already in use', () => {
    const message = startupFailureMessage(errno('EADDRINUSE'), 3001);

    expect(message).toContain('3001');
    expect(message).toContain('already in use');
    expect(message).toContain('PORT=');
  });

  it('distinguishes a privileged port from a taken one', () => {
    const message = startupFailureMessage(errno('EACCES'), 80);

    expect(message).toContain('80');
    expect(message).not.toContain('already in use');
  });

  it('falls back to the error text for a cause it does not recognize', () => {
    const message = startupFailureMessage(errno('EAFNOSUPPORT'), 3001);

    expect(message).toContain('3001');
    expect(message).toContain('EAFNOSUPPORT');
  });

  it('says something useful for an error carrying no code at all', () => {
    const message = startupFailureMessage(new Error('socket exploded'), 3001);

    expect(message).toContain('3001');
    expect(message).toContain('socket exploded');
  });
});
