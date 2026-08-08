import { describe, it, expect } from 'vitest';
import { toCsv, tasksCsv, tiptapToPlainText } from '../../../src/services/export/csv';
import type { ProjectExport, TiptapDoc } from '../../../src/schemas/index';
import { rankKey } from '../../helpers/fixtures';

describe('toCsv', () => {
  it('leaves plain fields unquoted and terminates every row with CRLF', () => {
    expect(toCsv([['a', 'b'], ['c']])).toBe('a,b\r\nc\r\n');
  });

  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });

  it('leaves an empty field empty and unquoted', () => {
    expect(toCsv([['', 'a', '']])).toBe(',a,\r\n');
  });

  it('quotes fields containing a comma, quote, CR or LF', () => {
    expect(toCsv([['a,b']])).toBe('"a,b"\r\n');
    expect(toCsv([['a"b']])).toBe('"a""b"\r\n');
    expect(toCsv([['a\nb']])).toBe('"a\nb"\r\n');
    expect(toCsv([['a\r\nb']])).toBe('"a\r\nb"\r\n');
  });

  it('quotes fields with leading or trailing whitespace', () => {
    expect(toCsv([[' a']])).toBe('" a"\r\n');
    expect(toCsv([['a ']])).toBe('"a "\r\n');
    expect(toCsv([['a b']])).toBe('a b\r\n');
  });

  it('doubles every embedded quote', () => {
    expect(toCsv([['He said "hi", then\nleft']])).toBe('"He said ""hi"", then\nleft"\r\n');
  });

  it('leaves a leading = untouched so the title survives the round trip', () => {
    expect(toCsv([['=SUM(A1:A2)']])).toBe('=SUM(A1:A2)\r\n');
  });
});

describe('tiptapToPlainText', () => {
  it('returns an empty string for null', () => {
    expect(tiptapToPlainText(null)).toBe('');
  });

  it('separates paragraphs with a newline and leaves no trailing newline', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'second' }] },
      ],
    };
    expect(tiptapToPlainText(doc)).toBe('first\nsecond');
  });

  it('includes heading text and flattens nested lists', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
            },
          ],
        },
      ],
    };
    expect(tiptapToPlainText(doc)).toBe('Plan\none\ntwo');
  });

  it('turns a hardBreak into a newline', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'hardBreak' },
            { type: 'text', text: 'b' },
          ],
        },
      ],
    };
    expect(tiptapToPlainText(doc)).toBe('a\nb');
  });

  it('contributes nothing for image and horizontalRule nodes', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
        { type: 'image', attrs: { src: '/api/images/8f14e45f-ceea-467a-9b0e-8e3f5c9f1a2b' } },
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ],
    };
    expect(tiptapToPlainText(doc)).toBe('before\nafter');
  });

  it('writes a mention as its label', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'ask ' },
            {
              type: 'mention',
              attrs: { id: '8f14e45f-ceea-467a-9b0e-8e3f5c9f1a2b', label: 'Alice' },
            },
            { type: 'text', text: ' first' },
          ],
        },
      ],
    };
    expect(tiptapToPlainText(doc)).toBe('ask @Alice first');
  });

  it('leaks no markup from marks', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            {
              type: 'text',
              text: 'link',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
          ],
        },
      ],
    };
    expect(tiptapToPlainText(doc)).toBe('bold and link');
  });

  it('returns an empty string for a document with no content', () => {
    expect(tiptapToPlainText({ type: 'doc' })).toBe('');
  });
});

function exportFixture(overrides: Partial<ProjectExport> = {}): ProjectExport {
  return {
    format: 'critical-path-project-export',
    version: 3,
    exported_at: '2026-07-26T12:00:00.000Z',
    project: {
      id: 'p1',
      name: 'Project',
      description: '',
      archived_at: null,
      created_at: '2026-07-01T00:00:00.000Z',
      created_by: 'u1',
      member_ids: [],
      members: [],
      is_public: false,
      color: null,
    },
    users: [{ id: 'u1', name: 'Owner' }],
    columns: [
      { id: 'c1', name: 'To Do', sort_key: rankKey(1000), is_done: false },
      { id: 'c2', name: 'Done', sort_key: rankKey(2000), is_done: true },
    ],
    labels: [{ id: 'l1', name: 'bug', color: '#ff0000' }],
    tasks: [],
    ...overrides,
  };
}

function taskFixture(
  overrides: Partial<ProjectExport['tasks'][number]>
): ProjectExport['tasks'][number] {
  return {
    id: 't1',
    column_id: 'c1',
    title: 'Task',
    description: null,
    sort_key: rankKey(1000),
    due_date: null,
    created_at: '2026-07-02T00:00:00.000Z',
    updated_at: '2026-07-03T00:00:00.000Z',
    column_since: '2026-07-02T00:00:00.000Z',
    archived_at: null,
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    cover_image_url: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
    checklist_items: [],
    attachments: [],
    ...overrides,
  };
}

describe('tasksCsv', () => {
  it('starts with the BOM and the documented header row', () => {
    const csv = tasksCsv(exportFixture());
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv.slice(1)).toBe(
      'id,title,column,is_done,position,due_date,labels,assignees,blocked_by,image_count,attachment_count,created_at,updated_at,archived_at,checklist,description\r\n'
    );
  });

  it('renders the checklist as tickboxes joined with "; ", in the order given', () => {
    const csv = tasksCsv(
      exportFixture({
        tasks: [
          taskFixture({
            checklist_items: [
              { id: 'k1', text: 'first', checked: true, sort_key: rankKey(1000) },
              { id: 'k2', text: 'second', checked: false, sort_key: rankKey(2000) },
            ],
          }),
        ],
      })
    );
    expect(csv.split('\r\n')[1]).toContain(',[x] first; [ ] second,');
  });

  it('writes one row per task with resolved column, labels, assignees and blockers', () => {
    const csv = tasksCsv(
      exportFixture({
        tasks: [
          taskFixture({ id: 't1', title: 'Blocker task', column_id: 'c2' }),
          taskFixture({
            id: 't2',
            title: 'Blocked task',
            sort_key: rankKey(2000),
            due_date: '2026-08-03',
            label_ids: ['l1'],
            assignee_ids: ['u1'],
            blocker_ids: ['t1'],
            attachments: [
              {
                id: 'i1',
                kind: 'image',
                is_cover: false,
                path: 'attachments/i1.png',
                title: null,
                description: null,
                filename: 'a.png',
                content_type: 'image/png',
                size_bytes: 4,
                url: null,
                unfurl_state: null,
                created_at: '2026-07-04T00:00:00.000Z',
              },
              {
                id: 'a1',
                kind: 'file',
                is_cover: false,
                path: 'attachments/a1.pdf',
                title: null,
                description: null,
                filename: 'spec.pdf',
                content_type: 'application/pdf',
                size_bytes: 9,
                url: null,
                unfurl_state: null,
                created_at: '2026-07-04T00:00:00.000Z',
              },
            ],
          }),
        ],
      })
    );

    const lines = csv.split('\r\n');
    expect(lines[1]).toBe(
      't1,Blocker task,Done,true,1,,,,,0,0,2026-07-02T00:00:00.000Z,2026-07-03T00:00:00.000Z,,,'
    );
    expect(lines[2]).toBe(
      't2,Blocked task,To Do,false,2,2026-08-03,bug,Owner,Blocker task,1,2,2026-07-02T00:00:00.000Z,2026-07-03T00:00:00.000Z,,,'
    );
    expect(lines[3]).toBe('');
  });

  it('joins multiple labels, assignees and blockers with "; "', () => {
    const csv = tasksCsv(
      exportFixture({
        labels: [
          { id: 'l1', name: 'bug', color: '#ff0000' },
          { id: 'l2', name: 'ui', color: '#00ff00' },
        ],
        users: [
          { id: 'u1', name: 'Owner' },
          { id: 'u2', name: 'Dev' },
        ],
        tasks: [
          taskFixture({ id: 't1', title: 'One' }),
          taskFixture({ id: 't2', title: 'Two', sort_key: rankKey(2000) }),
          taskFixture({
            id: 't3',
            title: 'Three',
            sort_key: rankKey(3000),
            label_ids: ['l1', 'l2'],
            assignee_ids: ['u1', 'u2'],
            blocker_ids: ['t1', 't2'],
          }),
        ],
      })
    );

    expect(csv.split('\r\n')[3]).toBe(
      't3,Three,To Do,false,3,,bug; ui,Owner; Dev,One; Two,0,0,' +
        '2026-07-02T00:00:00.000Z,2026-07-03T00:00:00.000Z,,,'
    );
  });

  it('orders names by the naming collection, not by the id list', () => {
    const csv = tasksCsv(
      exportFixture({
        labels: [
          { id: 'l2', name: 'aardvark', color: '#00ff00' },
          { id: 'l1', name: 'zebra', color: '#ff0000' },
        ],
        users: [
          { id: 'u2', name: 'Ann' },
          { id: 'u1', name: 'Zoe' },
        ],
        tasks: [
          taskFixture({ id: 't1', title: 'First' }),
          taskFixture({ id: 't2', title: 'Second', sort_key: rankKey(2000) }),
          taskFixture({
            id: 't3',
            title: 'Third',
            sort_key: rankKey(3000),
            label_ids: ['l1', 'l2'],
            assignee_ids: ['u1', 'u2'],
            blocker_ids: ['t2', 't1'],
          }),
        ],
      })
    );

    const row = csv.split('\r\n')[3];
    expect(row).toContain('aardvark; zebra');
    expect(row).toContain('Ann; Zoe');
    expect(row).toContain('First; Second');
  });

  it('skips ids that do not resolve', () => {
    const csv = tasksCsv(
      exportFixture({
        tasks: [
          taskFixture({
            label_ids: ['missing', 'l1'],
            assignee_ids: ['missing'],
            blocker_ids: ['missing'],
          }),
        ],
      })
    );

    expect(csv.split('\r\n')[1]).toBe(
      't1,Task,To Do,false,1,,bug,,,0,0,2026-07-02T00:00:00.000Z,2026-07-03T00:00:00.000Z,,,'
    );
  });

  it('writes the archive timestamp of an archived task and leaves it empty otherwise', () => {
    const csv = tasksCsv(
      exportFixture({
        tasks: [
          taskFixture({ id: 't1', title: 'Live' }),
          taskFixture({
            id: 't2',
            title: 'Shelved',
            sort_key: rankKey(2000),
            archived_at: '2026-07-05T00:00:00.000Z',
          }),
        ],
      })
    );

    const lines = csv.split('\r\n');
    expect(lines[1]).toBe(
      't1,Live,To Do,false,1,,,,,0,0,2026-07-02T00:00:00.000Z,2026-07-03T00:00:00.000Z,,,'
    );
    expect(lines[2]).toBe(
      't2,Shelved,To Do,false,2,,,,,0,0,2026-07-02T00:00:00.000Z,2026-07-03T00:00:00.000Z,' +
        '2026-07-05T00:00:00.000Z,,'
    );
  });

  it('quotes a title containing quotes, a comma and a newline', () => {
    const csv = tasksCsv(
      exportFixture({ tasks: [taskFixture({ title: 'He said "hi", then\nleft' })] })
    );
    expect(csv).toContain('"He said ""hi"", then\nleft"');
  });

  it('flattens the description into the last column', () => {
    const csv = tasksCsv(
      exportFixture({
        tasks: [
          taskFixture({
            description: {
              type: 'doc',
              content: [
                { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
              ],
            },
          }),
        ],
      })
    );
    expect(csv).toContain(',"H\nbody"\r\n');
  });
});
