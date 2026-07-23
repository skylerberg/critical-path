import * as readline from 'node:readline';
import { Writable } from 'node:stream';
import { CliError, EXIT } from './api/errors';
import type { RuntimeContext } from './context';

function requireInteractive(ctx: RuntimeContext, what: string): void {
  if (ctx.noInput) {
    throw new CliError(`${what} required but --no-input was given`, EXIT.usage);
  }
}

function ask(ctx: RuntimeContext, question: string, hidden: boolean): Promise<string> {
  const { stdin, stderr } = ctx.deps;
  const tty = stdin as NodeJS.ReadableStream & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  const isTty = tty.isTTY === true && typeof tty.setRawMode === 'function';
  const echo = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      if (!hidden) {
        stderr.write(chunk.toString());
      }
      callback();
    },
  });
  const rl = readline.createInterface({
    input: stdin,
    output: echo,
    terminal: isTty,
  });
  if (isTty) {
    tty.setRawMode!(true);
  }
  // Written only after raw mode is on: input arriving between the prompt and
  // the raw-mode switch would otherwise be echoed by the tty.
  stderr.write(question);
  const finish = () => {
    if (isTty) {
      tty.setRawMode!(false);
    }
    rl.close();
    stderr.write('\n');
  };
  return new Promise((resolve, reject) => {
    rl.on('SIGINT', () => {
      finish();
      reject(new CliError('Aborted', EXIT.failure));
    });
    rl.question('', (answer) => {
      finish();
      resolve(answer);
    });
  });
}

export async function promptText(ctx: RuntimeContext, question: string): Promise<string> {
  requireInteractive(ctx, `Input (${question.trim()})`);
  return await ask(ctx, question, false);
}

export async function promptHidden(ctx: RuntimeContext, question: string): Promise<string> {
  requireInteractive(ctx, `Input (${question.trim()})`);
  return await ask(ctx, question, true);
}

export async function confirmOrAbort(
  ctx: RuntimeContext,
  message: string,
  force: boolean
): Promise<void> {
  if (force) {
    return;
  }
  if (ctx.noInput) {
    throw new CliError(`${message} — pass --force to proceed without a prompt`, EXIT.usage);
  }
  const answer = await ask(ctx, `${message} [y/N] `, false);
  if (!/^y(es)?$/i.test(answer.trim())) {
    throw new CliError('Aborted', EXIT.failure);
  }
}

export async function readStdinLines(ctx: RuntimeContext): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of ctx.deps.stdin) {
    chunks.push(Buffer.from(chunk as string | Buffer));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text.split('\n').map((line) => line.replace(/\r$/, ''));
}
