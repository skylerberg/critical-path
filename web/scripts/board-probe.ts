// Dev-only probe (NOT shipped). Mounts the real Board.svelte (real Tailwind v4
// CSS, real svelte-dnd-action) with seeded data inside a shell that mirrors
// App.svelte + Project.svelte, so headless Chrome can measure the TRUE rendered
// layout. Driven by scripts/check-board-layout-real.mjs; documented by the
// browser-repro skill.
import { mount } from 'svelte';
import '../src/app.css';
import { board } from '../src/lib/board.svelte';
import Board from '../src/routes/Board.svelte';

const params = new URLSearchParams(location.search);
const COLS = Number(params.get('cols') ?? '4');
const TASKS = Number(params.get('tasks') ?? '12');
const READONLY = params.get('readonly') === '1';

board.currentProjectId = 'p1';
// Minimal project: the board only needs project to be non-null for derived state.
(board as unknown as { project: unknown }).project = { id: 'p1', name: 'Probe project' };

(board as unknown as { columns: unknown[] }).columns = Array.from({ length: COLS }, (_, c) => ({
  id: `c${c}`,
  name: `Column ${c + 1}`,
  position: c * 1000,
  is_done: c === COLS - 1,
}));

const tasks: unknown[] = [];
for (let c = 0; c < COLS; c++) {
  for (let t = 0; t < TASKS; t++) {
    tasks.push({
      id: `t-${c}-${t}`,
      column_id: `c${c}`,
      title: `Task ${t + 1} in column ${c + 1}`,
      description: null,
      position: t * 1000,
      created_at: '',
      updated_at: '',
      label_ids: [],
      assignee_ids: [],
      blocker_ids: [],
      image_count: 0,
      cover_image_url: null,
      due_date: null,
      comment_count: 0,
    });
  }
}
(board as unknown as { tasks: unknown[] }).tasks = tasks;

// Shell mirrors App.svelte (fixed mobile nav + wrapper) and Project.svelte
// (height container + header). Board mounts directly into the flex-col container
// so its flex-1 sizing matches production.
document.getElementById('app')!.innerHTML = `
  <nav class="fixed inset-x-0 bottom-0 z-20 flex items-stretch border-t border-edge bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Primary">
    <a class="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted">My tasks</a>
    <a class="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-accent">Projects</a>
    <a class="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted">Search</a>
  </nav>
  <div class="pb-[var(--cp-bottom-nav-h)] lg:pb-0 lg:pl-56">
    <div id="project-shell" class="flex h-[var(--cp-board-h)] flex-col lg:h-dvh">
      <header class="shrink-0 border-b border-edge bg-surface px-3 py-2 lg:px-4">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 class="min-w-0 truncate text-lg font-semibold">Probe project</h1>
          <nav class="flex gap-1">
            <span class="flex min-h-11 items-center rounded-md px-3 text-sm font-medium">Board</span>
            <span class="flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted">Graph</span>
          </nav>
        </div>
      </header>
    </div>
  </div>
`;

mount(Board, {
  target: document.getElementById('project-shell')!,
  props: { projectId: 'p1', readonly: READONLY },
});
