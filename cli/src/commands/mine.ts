import { Command } from 'commander';
import { leaf, withCtx } from '../kit';
import {
  listMyTasks,
  listUsers,
  type MyTask,
  type MyTaskLink,
  type MyTaskPersonGroup,
  type User,
} from '../resolve';
import type { CliDeps } from '../context';

const BUCKETS = [
  { bucket: 'blocking', heading: 'Blocking others' },
  { bucket: 'ready', heading: 'Ready' },
  { bucket: 'blocked', heading: 'Blocked' },
] as const;

function personLabel(group: MyTaskPersonGroup, users: Map<string, User>): string {
  if (group.user_id === null) {
    return 'Unassigned';
  }
  const user = users.get(group.user_id);
  return user === undefined ? group.user_id.slice(0, 8) : `${user.name} <${user.email}>`;
}

function taskRow(task: MyTask): string[] {
  return [task.id.slice(0, 8), task.project_name, task.column_name, task.title];
}

// The project is what makes the id prefix actionable: task refs resolve against one board.
function linkRow(link: MyTaskLink, projectNames: Map<string, string>): string {
  const cells = [link.id.slice(0, 8), projectNames.get(link.project_id), link.title];
  return `    ${cells.filter((cell) => cell !== undefined && cell !== '').join('  ')}`;
}

export function registerMine(program: Command, deps: CliDeps): void {
  program.addCommand(
    leaf('mine')
      .description('List your unfinished tasks across every project, ordered by what you block')
      .action(
        withCtx(deps, async (ctx) => {
          const mine = await listMyTasks(ctx);
          const groupSections = [
            { heading: 'Waiting on you', groups: mine.waiting_on_you },
            { heading: 'You are waiting on', groups: mine.you_are_waiting_on },
          ];
          // Names are only ever printed, so --json stays a single request.
          const users =
            ctx.out.json || groupSections.every((section) => section.groups.length === 0)
              ? new Map<string, User>()
              : new Map((await listUsers(ctx)).map((user) => [user.id, user]));

          // A link is always in the same project as the task it came from, so this covers every one.
          const projectNames = new Map(
            mine.tasks.map((task) => [task.project_id, task.project_name])
          );

          ctx.out.data(mine, () => {
            if (mine.tasks.length === 0) {
              ctx.out.line('No tasks assigned to you');
              return;
            }
            let printed = 0;
            const heading = (text: string): void => {
              if (printed > 0) {
                ctx.out.line();
              }
              printed += 1;
              ctx.out.line(ctx.out.style(['bold'], text));
            };

            for (const { bucket, heading: text } of BUCKETS) {
              const tasks = mine.tasks.filter((task) => task.bucket === bucket);
              if (tasks.length === 0) {
                continue;
              }
              heading(text);
              if (bucket === 'blocking') {
                ctx.out.table(
                  ['ID', 'PROJECT', 'COLUMN', 'TITLE', 'WAITING'],
                  tasks.map((task) => [...taskRow(task), String(task.waiting_user_ids.length)])
                );
              } else {
                ctx.out.table(['ID', 'PROJECT', 'COLUMN', 'TITLE'], tasks.map(taskRow));
              }
            }

            for (const section of groupSections) {
              if (section.groups.length === 0) {
                continue;
              }
              heading(section.heading);
              for (const group of section.groups) {
                const count = group.tasks.length;
                ctx.out.line(
                  `  ${personLabel(group, users)}  ${String(count)} task${count === 1 ? '' : 's'}`
                );
                for (const task of group.tasks) {
                  ctx.out.line(linkRow(task, projectNames));
                }
              }
            }
          });
        })
      )
  );
}
