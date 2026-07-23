import { Command } from 'commander';
import type { CliDeps } from './context';

export function buildProgram(deps: CliDeps): Command {
  const program = new Command('cpath')
    .description('CLI for Critical Path, the project-management app')
    .version('0.1.0');
  void deps;
  return program;
}
