import { Command } from 'commander';
import type { CliDeps } from './context';
import { registerAuth } from './commands/auth';
import { registerBoardViews } from './commands/boardView';
import { registerColumn } from './commands/column';
import { registerConfig } from './commands/config';
import { registerImage } from './commands/image';
import { registerLabel } from './commands/label';
import { registerProject } from './commands/project';
import { registerTask } from './commands/task';
import { registerUser } from './commands/user';
import { registerWorkspace } from './commands/workspace';

export function buildProgram(deps: CliDeps): Command {
  const program = new Command('cpath')
    .description('CLI for Critical Path, the project-management app')
    .version('0.1.0');
  registerAuth(program, deps);
  registerProject(program, deps);
  registerColumn(program, deps);
  registerTask(program, deps);
  registerLabel(program, deps);
  registerWorkspace(program, deps);
  registerUser(program, deps);
  registerImage(program, deps);
  registerBoardViews(program, deps);
  registerConfig(program, deps);
  return program;
}
