import { Command, Option } from 'commander';
import { leaf, withCtx } from '../kit';
import { candidatesFor } from '../completion/candidates';
import {
  currentWord,
  filterCandidates,
  formatCandidates,
  planCompletion,
} from '../completion/plan';
import { SHELLS, completionScript, type Shell } from '../completion/scripts';
import { createContext, type CliDeps } from '../context';

const COMPLETION_TIMEOUT_MS = 1500;

// A stalled request would freeze the user's terminal, so completion fetches give up early.
function timedDeps(deps: CliDeps): CliDeps {
  const base = deps.fetch ?? ((request: Request) => fetch(request));
  return {
    ...deps,
    fetch: (request) =>
      base(new Request(request, { signal: AbortSignal.timeout(COMPLETION_TIMEOUT_MS) })),
  };
}

export function registerCompletion(program: Command, deps: CliDeps): void {
  program.addCommand(
    leaf('completion')
      .description('Print a shell completion script')
      .addOption(
        new Option('-s, --shell <shell>', 'shell to generate a script for')
          .choices([...SHELLS])
          .makeOptionMandatory()
      )
      .action(
        withCtx(deps, async (ctx, opts) => {
          const script = await completionScript(opts.shell as Shell);
          ctx.out.data(script, () => ctx.out.line(script.trimEnd()));
        })
      )
  );

  const complete = new Command('__complete')
    .description('Emit completion candidates for a partially typed command line')
    .argument('[words...]', 'the command line as the shell split it')
    .allowUnknownOption()
    .allowExcessArguments()
    .helpOption(false)
    .action(async (words: string[]) => {
      try {
        const plan = planCompletion(program, words);
        if (plan.kind === 'none') {
          return;
        }
        if (plan.kind === 'files') {
          deps.stdout.write(':files\n');
          return;
        }
        const current = currentWord(words);
        // Answered before any config, keychain, or network work, so command and flag
        // completion survives a broken config or an offline server.
        if (plan.kind === 'static') {
          deps.stdout.write(formatCandidates(filterCandidates(plan.items, current)));
          return;
        }
        const ctx = await createContext(timedDeps(deps), {
          json: false,
          apiUrl: undefined,
          noInput: true,
          color: false,
        });
        const items = await candidatesFor(ctx, plan);
        deps.stdout.write(formatCandidates(filterCandidates(items, current)));
      } catch {
        // Silence is the only safe failure mode inside a shell completion.
      }
    });

  program.addCommand(complete, { hidden: true });
}
