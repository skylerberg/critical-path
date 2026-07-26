import { Command } from 'commander';
import { leaf, withCtx } from '../kit';
import { listProjects, resolveProject } from '../resolve';
import { ApiError } from '../api/errors';
import { realtimeUrl, watchEvents } from '../watch';
import type { CliDeps } from '../context';

export function registerWatch(program: Command, deps: CliDeps): void {
  program.addCommand(
    leaf('watch')
      .description(
        'Stream realtime events as newline-delimited JSON until interrupted. Events go to ' +
          'stdout, one compact JSON object per line; diagnostics go to stderr. Output is ' +
          'always NDJSON, so --json and --no-color have no effect here.'
      )
      .option(
        '--project <project>',
        'project id or name; without it every accessible project is followed and the configured default-project is ignored'
      )
      .action(
        withCtx(deps, async (ctx, opts) => {
          const ref = opts.project as string | undefined;
          // Unlike every other command, an absent ref stays absent instead of falling back
          // to the configured default: silently narrowing a live stream to one project is
          // the exact failure mode this command exists to debug.
          const scoped = ref == null ? null : await resolveProject(ctx, ref);
          const projectIds = scoped ? [scoped.id] : (await listProjects(ctx)).map((p) => p.id);
          const token = ctx.token;
          if (token == null) {
            throw new ApiError(401, 'Not authenticated');
          }

          const url = realtimeUrl(ctx.baseUrl);
          ctx.out.error(
            scoped
              ? `Watching "${scoped.name}" on ${url}`
              : `Watching ${projectIds.length} project(s) on ${url}`
          );

          const controller = new AbortController();
          const off = ctx.deps.onInterrupt?.(() => controller.abort());
          try {
            await watchEvents({
              url,
              token,
              projectId: scoped?.id ?? null,
              projectIds,
              listProjectIds: async () => (await listProjects(ctx)).map((p) => p.id),
              revalidateSession: async () => {
                try {
                  const result = await ctx.api.GET('/api/auth/me');
                  return result.response.status !== 401;
                } catch {
                  return true;
                }
              },
              emit: (line) => ctx.out.line(line),
              notify: (message) => ctx.out.error(message),
              signal: controller.signal,
            });
          } finally {
            off?.();
          }
        })
      )
  );
}
