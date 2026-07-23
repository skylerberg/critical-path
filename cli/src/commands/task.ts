import { Command } from 'commander';
import type { CliDeps } from '../context';

export function registerTask(program: Command, deps: CliDeps): void {
  void program;
  void deps;
}
