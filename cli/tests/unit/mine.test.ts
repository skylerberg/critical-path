import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { run } from '../../src/run';
import type { CliDeps } from '../../src/context';
import type { MyTask, MyTasksResponse } from '../../src/resolve';

const IDS = {
  first: 'aaaa1111-0000-4000-8000-000000000001',
  crossed: 'bbbb2222-0000-4000-8000-000000000002',
  last: 'cccc3333-0000-4000-8000-000000000003',
};

function myTask(id: string, title: string): MyTask {
  return {
    id,
    project_id: 'p-1',
    project_name: 'Alpha',
    column_name: 'To Do',
    title,
    assignee_ids: [],
    bucket: 'ready',
    waiting_user_ids: [],
    blocking: [],
    blocked_by: [],
    hidden_blocked_by_count: 0,
    hidden_blocking_count: 0,
  };
}

function page(tasks: MyTask[], next_offset: number | null): MyTasksResponse {
  return { tasks, waiting_on_you: [], you_are_waiting_on: [], next_offset };
}

async function runMine(pages: MyTasksResponse[], argv: string[] = []): Promise<string> {
  let stdout = '';
  const stdin = new PassThrough();
  stdin.end('');
  const requested: string[] = [];
  const deps: CliDeps = {
    env: {
      CRITICAL_PATH_TOKEN: 'test-token',
      CRITICAL_PATH_API_URL: 'https://api.test',
      CRITICAL_PATH_CONFIG_DIR: '/nonexistent-config-dir-for-tests',
    },
    platform: 'linux',
    stdin,
    stdout: {
      write: (chunk: string) => {
        stdout += chunk;
      },
    },
    stderr: { write: () => undefined },
    fetch: (request: Request) => {
      const url = new URL(request.url);
      requested.push(url.searchParams.get('offset') ?? '0');
      const body = pages[requested.length - 1];
      if (body === undefined) {
        throw new Error(`unexpected request ${requested.length}: ${request.url}`);
      }
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    },
  };
  const exitCode = await run(deps, ['node', 'cpath', 'mine', ...argv]);
  expect(exitCode).toBe(0);
  expect(requested).toHaveLength(pages.length);
  return stdout;
}

// The server pages my-tasks with OFFSET over a ranking it recomputes for every
// request, so a card that crosses the page boundary between two reads comes back
// on both pages. Concatenating the pages printed its row twice.
describe('cpath mine over more than one page', () => {
  const pages = [
    page(
      [myTask(IDS.first, 'Stays on page one'), myTask(IDS.crossed, 'Crosses the boundary')],
      1000
    ),
    page(
      [myTask(IDS.crossed, 'Renamed since page one'), myTask(IDS.last, 'Only on page two')],
      null
    ),
  ];

  it('prints one row for a card served on both pages', async () => {
    const stdout = await runMine(pages);
    const rows = stdout.split('\n').filter((line) => line.includes(IDS.crossed.slice(0, 8)));
    expect(rows).toHaveLength(1);
    // The fresher read wins, and the card keeps its place in the first page's order.
    expect(rows[0]).toContain('Renamed since page one');
    expect(stdout.indexOf(IDS.first.slice(0, 8))).toBeLessThan(
      stdout.indexOf(IDS.crossed.slice(0, 8))
    );
    expect(stdout.indexOf(IDS.crossed.slice(0, 8))).toBeLessThan(
      stdout.indexOf(IDS.last.slice(0, 8))
    );
  });

  it('hands --json one entry per card', async () => {
    const parsed = JSON.parse(await runMine(pages, ['--json'])) as MyTasksResponse;
    expect(parsed.tasks.map((task) => task.id)).toEqual([IDS.first, IDS.crossed, IDS.last]);
    expect(parsed.tasks[1].title).toBe('Renamed since page one');
  });
});
