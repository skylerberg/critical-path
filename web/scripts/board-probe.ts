// Dev-only probe (NOT shipped). Mounts the real Board.svelte and SelectionBar
// (real Tailwind v4 CSS, real svelte-dnd-action) with seeded data in a shell that mirrors
// App.svelte + Project.svelte, so headless Chrome can measure the TRUE rendered
// layout. Driven by scripts/check-board-layout-real.mjs; documented by the
// browser-repro skill.
import { mount } from 'svelte';
import '../src/app.css';
import { board } from '../src/lib/board.svelte';
import { selection } from '../src/lib/selection.svelte';
import { session } from '../src/lib/session.svelte';
import SelectionBar from '../src/components/SelectionBar.svelte';
import Board from '../src/routes/Board.svelte';

const params = new URLSearchParams(location.search);
const COLS = Number(params.get('cols') ?? '4');
const TASKS = Number(params.get('tasks') ?? '12');
const READONLY = params.get('readonly') === '1';
const SELECTED = Number(params.get('selected') ?? '0');

// Card links are built by encoding the id, which rejects anything that is not a
// uuid, so seeded ids have to be shaped like the real ones or nothing renders.
function probeId(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

// Column-major with a stride wider than the column, so no two cells can land on
// the same number. A fixed stride of 100 silently handed column 1 the ids column
// 0 already had as soon as a column held more than 100 cards — and a board
// seeded with duplicate ids breaks Svelte's keyed each and quietly invalidates
// every measurement taken on it.
const TASK_ID_BASE = 1000;
function taskId(column: number, index: number): string {
  return probeId(TASK_ID_BASE + column * (TASKS + 1) + index);
}

const PROJECT_ID = probeId(1);
const USER_ID = probeId(2);
board.currentProjectId = PROJECT_ID;
// Signed in as the project's creator, which is what makes the set mutable — every
// selection mutator no-ops on a board the user cannot edit.
session.user = {
  id: USER_ID,
  name: 'Probe',
  email: 'probe@example.com',
  avatar_url: null,
  email_verified: true,
};
// Minimal project: the board only needs project to be non-null for derived state.
(board as unknown as { project: unknown }).project = {
  id: PROJECT_ID,
  name: 'Probe project',
  created_by: USER_ID,
  member_ids: [],
  members: [],
};

(board as unknown as { columns: unknown[] }).columns = Array.from({ length: COLS }, (_, c) => ({
  id: `c${c}`,
  name: `Column ${c + 1}`,
  position: c * 1000,
  is_done: c === COLS - 1,
}));

const tasks: { id: string; [field: string]: unknown }[] = [];
for (let c = 0; c < COLS; c++) {
  for (let t = 0; t < TASKS; t++) {
    tasks.push({
      id: taskId(c, t),
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
// Loud rather than silent: duplicate ids still render a board that looks right,
// so without this the probe measures a board no real project could produce and
// reports the numbers as if they were sound.
if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
  throw new Error(`board-probe seeded duplicate task ids (cols=${COLS}, tasks=${TASKS})`);
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

const shell = document.getElementById('project-shell')!;

mount(Board, {
  target: shell,
  props: { projectId: PROJECT_ID, readonly: READONLY },
});

// A board that pans on its own after arrival is a time series, not a state, so
// the samples have to start before the first frame — the check script reads
// them back and asserts the spread is zero.
const scrollSamples: number[] = [];
(window as unknown as { __boardScroll: number[] }).__boardScroll = scrollSamples;
(function sampleScroll() {
  const scroller = [...shell.querySelectorAll('div')].find(
    (el) => getComputedStyle(el).overflowX === 'auto'
  );
  if (scroller) {
    scrollSamples.push(scroller.scrollLeft);
  }
  if (scrollSamples.length < 120) {
    requestAnimationFrame(sampleScroll);
  }
})();

for (let t = 0; t < SELECTED; t++) {
  selection.toggle(taskId(0, t));
}

mount(SelectionBar, { target: shell });
