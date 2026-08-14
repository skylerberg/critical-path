// Dev-only (NOT shipped): the rows scripts/task-detail-probe.ts seeds the board
// with, and the same rows scripts/task-detail-probe-net.ts answers a detail read
// from.
//
// A module of its own rather than the entry's own constants, because the network
// stub needs them too and must not import the board to get them: the api client
// captures window.fetch as it initialises, and pulling the board in from the stub
// would run that capture before the stub is installed.
export const probeId = (n: number): string =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const PROJECT_ID = probeId(1);
export const USER_ID = probeId(2);
export const COLUMN_ID = probeId(20);
export const FIRST_TASK_ID = probeId(10);
export const SECOND_TASK_ID = probeId(11);

function paragraph(text: string): Record<string, unknown> {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

// Two cards, each with text already in its description. The gesture under test is
// leaving one card for the other with unsaved words in the editor, and neither a
// single card nor an empty editor can produce it — which is why the description
// paths were unreachable from the browser tier for as long as they were.
export const TASKS = [
  {
    id: FIRST_TASK_ID,
    column_id: COLUMN_ID,
    title: 'Stored title',
    description: paragraph('Stored description'),
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
  {
    id: SECOND_TASK_ID,
    column_id: COLUMN_ID,
    title: 'Second title',
    description: paragraph('Second description'),
    sort_key: 'V1',
    due_date: null,
    created_at: '2026-01-01T00:00:00Z',
    // Deliberately unlike the first card's, so a precondition can name which card
    // a write was written against rather than only which path it went to.
    updated_at: '2026-03-03T00:00:00Z',
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
];
