// Dev-only entry (NOT part of the production build) that mounts the REAL
// TaskDetail so a browser can answer what jsdom cannot: where showModal() leaves
// the caret, and how many writes one edit produces when the overlay is dismissed.
// Served by `vite dev` at /scripts/task-detail-probe.html. See
// scripts/check-task-detail.mjs.
import './board-probe-net';
import './task-detail-probe-net';
import { mount, unmount } from 'svelte';
import '../src/app.css';
import { board } from '../src/lib/board.svelte';
import { connectivity } from '../src/lib/connectivity.svelte';
import { session } from '../src/lib/session.svelte';
import TaskDetail from '../src/components/TaskDetail.svelte';

const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const PROJECT_ID = id(1),
  USER_ID = id(2),
  TASK_ID = id(10),
  COLUMN_ID = id(20);

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
board.tasks = [
  {
    id: TASK_ID,
    column_id: COLUMN_ID,
    title: 'Stored title',
    description: null,
    sort_key: 'V0',
    due_date: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    cover_image_url: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
  },
] as unknown as typeof board.tasks;

const app = mount(TaskDetail, {
  target: document.getElementById('app')!,
  props: { taskId: TASK_ID, closePath: '/p/probe', taskPath: (t: string) => `/t/${t}` },
});
(window as unknown as { __unmount: () => void }).__unmount = () => {
  void unmount(app);
};
export {};
