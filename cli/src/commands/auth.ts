import { Command } from 'commander';
import { leaf, withCtx, type Opts } from '../kit';
import { ApiError, CliError, EXIT, assertOk } from '../api/errors';
import { promptHidden, promptText, readStdinLines } from '../prompt';
import type { CliDeps, RuntimeContext } from '../context';
import type { components } from '../api/api.generated';

type User = components['schemas']['User'];

async function resolveEmail(ctx: RuntimeContext, opts: Opts): Promise<string> {
  const email = opts.email as string | undefined;
  return email ?? (await promptText(ctx, 'Email: '));
}

async function readPassword(
  ctx: RuntimeContext,
  stdinLines: string[] | null,
  lineIndex: number,
  label: string,
  confirmLabel?: string
): Promise<string> {
  if (stdinLines) {
    const line = stdinLines[lineIndex];
    if (line == null || line === '') {
      throw new CliError(`--password-stdin expected ${label.toLowerCase()} on stdin`, EXIT.usage);
    }
    return line;
  }
  const password = await promptHidden(ctx, `${label}: `);
  if (confirmLabel != null) {
    const again = await promptHidden(ctx, `${confirmLabel}: `);
    if (again !== password) {
      throw new CliError('Passwords do not match', EXIT.invalid);
    }
  }
  return password;
}

function printUser(ctx: RuntimeContext, user: User, prefix: string): void {
  ctx.out.data(user, () => ctx.out.line(`${prefix} ${user.name} <${user.email}>`));
}

function warnIfEnvToken(ctx: RuntimeContext): void {
  if (ctx.tokenFromEnv) {
    ctx.out.error('Warning: CRITICAL_PATH_TOKEN is set and will shadow the stored token');
  }
}

export function registerAuth(program: Command, deps: CliDeps): void {
  program.addCommand(
    leaf('login')
      .description('Log in and store the session token')
      .option('--email <email>', 'account email')
      .option('--password-stdin', 'read the password from the first line of stdin')
      .action(
        withCtx(deps, async (ctx, opts) => {
          const stdinLines = opts.passwordStdin === true ? await readStdinLines(ctx) : null;
          const email = await resolveEmail(ctx, opts);
          const password = await readPassword(ctx, stdinLines, 0, 'Password');
          let result;
          try {
            result = assertOk(await ctx.api.POST('/api/auth/login', { body: { email, password } }));
          } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
              throw new CliError(
                `Invalid email or password for ${email} at ${ctx.baseUrl}`,
                EXIT.auth
              );
            }
            throw err;
          }
          await ctx.credentials.set(ctx.baseUrl, result.token);
          warnIfEnvToken(ctx);
          printUser(ctx, result.user, 'Logged in as');
        })
      )
  );

  program.addCommand(
    leaf('logout')
      .description('Revoke the current session and forget the stored token')
      .action(
        withCtx(deps, async (ctx) => {
          if (ctx.token != null) {
            try {
              await ctx.api.POST('/api/auth/logout');
            } catch {
              // Clear the local token even when the server is unreachable.
            }
          }
          await ctx.credentials.delete(ctx.baseUrl);
          ctx.out.data({ logged_out: true }, () => ctx.out.line('Logged out'));
        })
      )
  );

  program.addCommand(
    leaf('signup')
      .description('Create an account and store the session token')
      .option('--email <email>', 'account email')
      .option('--name <name>', 'display name')
      .option('--password-stdin', 'read the password from the first line of stdin')
      .action(
        withCtx(deps, async (ctx, opts) => {
          const stdinLines = opts.passwordStdin === true ? await readStdinLines(ctx) : null;
          const email = await resolveEmail(ctx, opts);
          const name = (opts.name as string | undefined) ?? (await promptText(ctx, 'Name: '));
          const password = await readPassword(ctx, stdinLines, 0, 'Password', 'Confirm password');
          const result = assertOk(
            await ctx.api.POST('/api/auth/signup', {
              body: { id: crypto.randomUUID(), email, name, password },
            })
          );
          await ctx.credentials.set(ctx.baseUrl, result.token);
          warnIfEnvToken(ctx);
          printUser(ctx, result.user, 'Signed up as');
        })
      )
  );

  program.addCommand(
    leaf('whoami')
      .description('Show the logged-in account')
      .action(
        withCtx(deps, async (ctx) => {
          const user = assertOk(await ctx.api.GET('/api/auth/me'));
          printUser(ctx, user, 'Logged in as');
        })
      )
  );

  const account = new Command('account').description('Manage the logged-in account');

  account.addCommand(
    leaf('update')
      .description('Update the account name or email')
      .option('--name <name>', 'new display name')
      .option('--email <email>', 'new email')
      .action(
        withCtx(deps, async (ctx, opts) => {
          const name = opts.name as string | undefined;
          const email = opts.email as string | undefined;
          if (name == null && email == null) {
            throw new CliError('Pass --name and/or --email', EXIT.usage);
          }
          const user = assertOk(await ctx.api.PATCH('/api/auth/me', { body: { name, email } }));
          printUser(ctx, user, 'Updated account:');
        })
      )
  );

  account.addCommand(
    leaf('change-password')
      .description('Change the password (revokes all other sessions)')
      .option('--password-stdin', 'read current then new password from the first two stdin lines')
      .action(
        withCtx(deps, async (ctx, opts) => {
          const stdinLines = opts.passwordStdin === true ? await readStdinLines(ctx) : null;
          const currentPassword = await readPassword(ctx, stdinLines, 0, 'Current password');
          const newPassword = await readPassword(
            ctx,
            stdinLines,
            1,
            'New password',
            'Confirm new password'
          );
          let result;
          try {
            result = assertOk(
              await ctx.api.POST('/api/auth/change-password', {
                body: { current_password: currentPassword, new_password: newPassword },
              })
            );
          } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
              throw new CliError('Incorrect current password', EXIT.auth);
            }
            throw err;
          }
          await ctx.credentials.set(ctx.baseUrl, result.token);
          warnIfEnvToken(ctx);
          ctx.out.data(result.user, () =>
            ctx.out.line('Password changed; all other sessions were revoked')
          );
        })
      )
  );

  account.addCommand(
    leaf('forgot-password')
      .description('Request a password-reset email')
      .option('--email <email>', 'account email')
      .action(
        withCtx(deps, async (ctx, opts) => {
          const email = await resolveEmail(ctx, opts);
          assertOk(await ctx.api.POST('/api/auth/forgot-password', { body: { email } }));
          ctx.out.data({ requested: true }, () =>
            ctx.out.line('If that account exists, a reset email was sent')
          );
        })
      )
  );

  account.addCommand(
    leaf('reset-password')
      .description('Reset the password with an emailed token (revokes all sessions)')
      .requiredOption('--token <token>', 'reset token from the email')
      .option('--password-stdin', 'read the new password from the first line of stdin')
      .action(
        withCtx(deps, async (ctx, opts) => {
          const stdinLines = opts.passwordStdin === true ? await readStdinLines(ctx) : null;
          const newPassword = await readPassword(
            ctx,
            stdinLines,
            0,
            'New password',
            'Confirm new password'
          );
          assertOk(
            await ctx.api.POST('/api/auth/reset-password', {
              body: { token: opts.token as string, new_password: newPassword },
            })
          );
          await ctx.credentials.delete(ctx.baseUrl);
          ctx.out.data({ reset: true }, () =>
            ctx.out.line('Password reset; run cpath login with the new password')
          );
        })
      )
  );

  program.addCommand(account);
}
