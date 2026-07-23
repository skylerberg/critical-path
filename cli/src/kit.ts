import { Command } from 'commander';
import { createContext, type CliDeps, type GlobalFlags, type RuntimeContext } from './context';

export function leaf(name: string): Command {
  return new Command(name)
    .option('--json', 'output JSON instead of human-readable text')
    .option('--api-url <url>', 'API base URL (default http://localhost:3001)')
    .option('--no-input', 'never prompt; fail if input would be required')
    .option('--no-color', 'disable colored output');
}

export type Opts = Record<string, unknown>;

export function withCtx(
  deps: CliDeps,
  handler: (ctx: RuntimeContext, opts: Opts, ...positionals: string[]) => Promise<void>
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    const opts = cmd.optsWithGlobals<Opts>();
    const flags: GlobalFlags = {
      json: opts.json === true,
      apiUrl: typeof opts.apiUrl === 'string' ? opts.apiUrl : undefined,
      noInput: opts.input === false,
      color: opts.color !== false,
    };
    const ctx = await createContext(deps, flags);
    const positionals = args.slice(0, -2) as string[];
    await handler(ctx, opts, ...positionals);
  };
}
