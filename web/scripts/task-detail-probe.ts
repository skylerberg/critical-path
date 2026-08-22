// Dev-only entry (NOT part of the production build) that mounts the REAL
// TaskDetail so a browser can answer what jsdom cannot: where showModal() leaves
// the caret, and how many writes one edit produces when the overlay is dismissed
// or moved to another card. Served by `vite dev` at
// /scripts/task-detail-probe.html. See scripts/check-task-detail.mjs.
import './board-probe-net';
import './task-detail-probe-net';
import { mount, unmount } from 'svelte';
import '../src/app.css';
import { board } from '../src/lib/board.svelte';
import { connectivity } from '../src/lib/connectivity.svelte';
import { session } from '../src/lib/session.svelte';
import TaskDetail from '../src/components/TaskDetail.svelte';
import { COLUMN_ID, FIRST_TASK_ID, PROJECT_ID, TASKS, USER_ID } from './task-detail-probe-fixture';
import { switchableProps } from './task-detail-probe-props.svelte';

session.user = {
  id: USER_ID,
  name: 'Probe',
  email: 'p@e.com',
  avatar_url: null,
  email_verified: true,
};
connectivity.noteReached();
board.currentProjectId = PROJECT_ID;
board.project = {
  id: PROJECT_ID,
  name: 'Probe',
  created_by: USER_ID,
  members: [],
  member_ids: [USER_ID],
} as unknown as typeof board.project;
board.columns = [
  { id: COLUMN_ID, name: 'Todo', sort_key: 'V0', is_done: false },
] as unknown as typeof board.columns;
board.tasks = TASKS as unknown as typeof board.tasks;

const props = switchableProps(FIRST_TASK_ID);
const app = mount(TaskDetail, { target: document.getElementById('app')!, props });
(window as unknown as { __unmount: () => void }).__unmount = () => {
  void unmount(app);
};
(window as unknown as { __switch: (id: string) => void }).__switch = (id: string) => {
  props.taskId = id;
};
// The driver asserts which card a write landed on and what it was written
// against, so it reads the ids and the timestamps from the seeded rows rather
// than repeating them.
(window as unknown as { __fixture: typeof TASKS }).__fixture = TASKS;
export {};
