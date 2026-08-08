import { Command } from 'commander';
import { leaf, withCtx } from '../kit';
import { CliError, EXIT, assertOk } from '../api/errors';
import { confirmOrAbort } from '../prompt';
import { matchRef } from '../resolve';
import type { CliDeps, RuntimeContext } from '../context';
import type { components } from '../api/api.generated';

type PersonalAccessToken = components['schemas']['PersonalAccessToken'];

function day(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function expiryLabel(token: PersonalAccessToken): string {
  if (token.expires_at == null) {
    return 'never';
  }
  return new Date(token.expires_at) <= new Date()
    ? `${day(token.expires_at)} (expired)`
    : day(token.expires_at);
}

async function listTokens(ctx: RuntimeContext): Promise<PersonalAccessToken[]> {
  return assertOk(await ctx.api.GET('/api/auth/tokens')).personal_access_tokens;
}

function resolveExpiry(opts: Record<string, unknown>): string | null {
  const days = opts.expiresInDays as string | undefined;
  const at = opts.expiresAt as string | undefined;
  if (days != null && at != null) {
    throw new CliError('Pass --expires-in-days or --expires-at, not both', EXIT.usage);
  }
  if (at != null) {
    const parsed = new Date(at);
    if (isNaN(parsed.getTime())) {
      throw new CliError(`--expires-at is not a valid date: ${at}`, EXIT.invalid);
    }
    return parsed.toISOString();
  }
  if (days != null) {
    const count = Number(days);
    if (!Number.isFinite(count) || count <= 0) {
      throw new CliError('--expires-in-days must be a positive number', EXIT.invalid);
    }
    return new Date(Date.now() + count * 24 * 60 * 60 * 1000).toISOString();
  }
  return null;
}

export function registerToken(program: Command, deps: CliDeps): void {
  const token = new Command('token').description('Manage personal access tokens');

  token.addCommand(
    leaf('list')
      .description('List personal access tokens')
      .action(
        withCtx(deps, async (ctx) => {
          const tokens = await listTokens(ctx);
          ctx.out.data(tokens, () => {
            if (tokens.length === 0) {
              ctx.out.line('No personal access tokens');
              return;
            }
            ctx.out.table(
              ['ID', 'NAME', 'CREATED', 'EXPIRES', 'LAST USED'],
              tokens.map((t) => [
                t.id.slice(0, 8),
                t.name,
                day(t.created_at),
                expiryLabel(t),
                t.last_used_at == null ? 'never' : day(t.last_used_at),
              ])
            );
          });
        })
      )
  );

  token.addCommand(
    leaf('create')
      .description('Create a personal access token and print the secret once')
      .argument('<name>', 'what the token is for')
      .option('--expires-in-days <days>', 'expire this many days from now')
      .option('--expires-at <timestamp>', 'expire at an ISO-8601 timestamp')
      .action(
        withCtx(deps, async (ctx, opts, name) => {
          const created = assertOk(
            await ctx.api.POST('/api/auth/tokens', {
              body: { id: crypto.randomUUID(), name, expires_at: resolveExpiry(opts) },
            })
          );
          // The secret is stdout-only so `TOKEN=$(cpath token create agent)` works.
          ctx.out.data(created, () => {
            ctx.out.error(
              `Created token "${created.personal_access_token.name}" ` +
                `(${created.personal_access_token.id.slice(0, 8)}), expires ` +
                `${expiryLabel(created.personal_access_token)}`
            );
            ctx.out.line(created.token);
            ctx.out.error('This is the only time the token is shown; store it now.');
          });
        })
      )
  );

  token.addCommand(
    leaf('revoke')
      .description('Revoke a personal access token')
      .argument('<token>', 'token id or name')
      .option('--force', 'skip the confirmation prompt')
      .action(
        withCtx(deps, async (ctx, opts, ref) => {
          const target = matchRef(
            ref,
            await listTokens(ctx),
            'token',
            (t) => t.id,
            (t) => t.name
          );
          await confirmOrAbort(ctx, `Revoke token "${target.name}"?`, opts.force === true);
          assertOk(
            await ctx.api.DELETE('/api/auth/tokens/{id}', { params: { path: { id: target.id } } })
          );
          ctx.out.data({ revoked: true, id: target.id }, () =>
            ctx.out.line(`Revoked token ${target.name}`)
          );
        })
      )
  );

  program.addCommand(token);
}
