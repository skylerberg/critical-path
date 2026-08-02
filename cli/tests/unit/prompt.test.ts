import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { confirmOrAbort, promptHidden, promptText } from '../../src/prompt';
import { CliError } from '../../src/api/errors';
import type { RuntimeContext } from '../../src/context';

class FakeTty extends PassThrough {
  isTTY = true;
  isRaw = false;
  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    return this;
  }
}

const ESC = String.fromCharCode(27);
const CLEAR_BELOW = `${ESC}[0J`;
const ANSI = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g');

// What a terminal would still be showing: readline erases from the cursor down before
// each redraw, so anything written ahead of the last erase is no longer on screen.
function visible(text: string): string {
  const erased = text.lastIndexOf(CLEAR_BELOW);
  const tail = erased === -1 ? text : text.slice(erased + CLEAR_BELOW.length);
  return tail.replace(ANSI, '');
}

function makeCtx(stdin: PassThrough): { ctx: RuntimeContext; stderr: () => string } {
  let stderr = '';
  const ctx = {
    noInput: false,
    deps: {
      stdin,
      stderr: {
        write: (chunk: string) => {
          stderr += chunk;
        },
      },
    },
  } as unknown as RuntimeContext;
  return { ctx, stderr: () => stderr };
}

async function type(stdin: PassThrough, keys: string): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  stdin.write(keys);
}

describe('prompts on a terminal', () => {
  it('leaves the question on screen and returns the typed answer', async () => {
    const stdin = new FakeTty();
    const { ctx, stderr } = makeCtx(stdin);
    const answer = promptText(ctx, 'Email: ');
    await type(stdin, 'me@example.com\r');
    expect(await answer).toBe('me@example.com');
    expect(visible(stderr())).toContain('Email: ');
  });

  it('leaves a hidden question on screen without ever echoing the answer', async () => {
    const stdin = new FakeTty();
    const { ctx, stderr } = makeCtx(stdin);
    const answer = promptHidden(ctx, 'Password: ');
    await type(stdin, 'hunter2\r');
    expect(await answer).toBe('hunter2');
    expect(stderr()).not.toContain('hunter2');
    expect(visible(stderr())).toContain('Password: ');
  });

  it('leaves a confirmation on screen and proceeds on yes', async () => {
    const stdin = new FakeTty();
    const { ctx, stderr } = makeCtx(stdin);
    const confirmed = confirmOrAbort(ctx, 'Delete label "bug"?', false);
    await type(stdin, 'y\r');
    await expect(confirmed).resolves.toBeUndefined();
    expect(visible(stderr())).toContain('Delete label "bug"? [y/N]');
  });

  it('aborts on anything but yes', async () => {
    const stdin = new FakeTty();
    const { ctx, stderr } = makeCtx(stdin);
    const confirmed = confirmOrAbort(ctx, 'Delete label "bug"?', false);
    await type(stdin, 'n\r');
    await expect(confirmed).rejects.toThrow(CliError);
    expect(visible(stderr())).toContain('Delete label "bug"? [y/N]');
  });

  it('restores the terminal out of raw mode', async () => {
    const stdin = new FakeTty();
    const { ctx } = makeCtx(stdin);
    const answer = promptText(ctx, 'Email: ');
    await type(stdin, 'me@example.com\r');
    await answer;
    expect(stdin.isRaw).toBe(false);
  });
});

describe('prompts on a pipe', () => {
  it('writes the question to stderr', async () => {
    const stdin = new PassThrough();
    const { ctx, stderr } = makeCtx(stdin);
    const answer = promptText(ctx, 'Email: ');
    await type(stdin, 'me@example.com\n');
    expect(await answer).toBe('me@example.com');
    expect(stderr()).toContain('Email: ');
  });

  it('writes a hidden question to stderr without echoing the answer', async () => {
    const stdin = new PassThrough();
    const { ctx, stderr } = makeCtx(stdin);
    const answer = promptHidden(ctx, 'Password: ');
    await type(stdin, 'hunter2\n');
    expect(await answer).toBe('hunter2');
    expect(stderr()).toContain('Password: ');
    expect(stderr()).not.toContain('hunter2');
  });
});
