import { Command } from 'commander';
import type { CliDeps } from './context';
import { registerAuth } from './commands/auth';
import { registerBoardViews } from './commands/boardView';
import { registerColumn } from './commands/column';
import { registerComment } from './commands/comment';
import { registerCompletion } from './commands/completion';
import { registerConfig } from './commands/config';
import { registerAttachment } from './commands/attachment';
import { registerLabel } from './commands/label';
import { registerMine } from './commands/mine';
import { registerProject } from './commands/project';
import { registerTask } from './commands/task';
import { registerToken } from './commands/token';
import { registerUser } from './commands/user';
import { registerWatch } from './commands/watch';

export function buildProgram(deps: CliDeps): Command {
  const program = new Command('cpath')
    .description('CLI for Critical Path, the project-management app')
    .version('0.1.0');
  registerAuth(program, deps);
  registerToken(program, deps);
  registerProject(program, deps);
  registerColumn(program, deps);
  registerTask(program, deps);
  registerLabel(program, deps);
  registerUser(program, deps);
  registerAttachment(program, deps);
  registerComment(program, deps);
  registerBoardViews(program, deps);
  registerMine(program, deps);
  registerWatch(program, deps);
  registerConfig(program, deps);
  registerCompletion(program, deps);
  return program;
}
