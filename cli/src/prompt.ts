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
  stderr.write(question);
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
    terminal: stdin.isTTY === true,
  });
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      stderr.write('\n');
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

export async function readLineFromStdin(ctx: RuntimeContext): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of ctx.deps.stdin) {
    chunks.push(Buffer.from(chunk as string | Buffer));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const firstLine = text.split('\n', 1)[0] ?? '';
  return firstLine.replace(/\r$/, '');
}
