import { CommanderError } from 'commander';
import { buildProgram } from './program';
import { ApiError, CliError, EXIT, exitCodeForStatus } from './api/errors';
import type { CliDeps } from './context';

export async function run(deps: CliDeps, argv: string[]): Promise<number> {
  const program = buildProgram(deps);
  program.exitOverride();
  program.configureOutput({
    writeOut: (str) => deps.stdout.write(str),
    writeErr: (str) => deps.stderr.write(str),
  });
  try {
    await program.parseAsync(argv);
    return EXIT.ok;
  } catch (err) {
    if (err instanceof CommanderError) {
      return err.exitCode === 0 ? EXIT.ok : EXIT.usage;
    }
    if (err instanceof CliError) {
      deps.stderr.write(`${err.message}\n`);
      return err.exitCode;
    }
    if (err instanceof ApiError) {
      deps.stderr.write(`${err.message}\n`);
      if (err.status === 401) {
        deps.stderr.write(
          'Not authenticated, or the session expired (sessions last 30 days and are revoked by password changes). Run: cpath login\n'
        );
      }
      return exitCodeForStatus(err.status);
    }
    deps.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT.failure;
  }
}
