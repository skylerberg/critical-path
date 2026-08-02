import { describe, it, expect } from 'vitest';
import { toCsv, tasksCsv, tiptapToPlainText } from '../../../src/services/export/csv';
import type { ProjectExport, TiptapDoc } from '../../../src/schemas/index';

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
    version: 2,
    exported_at: '2026-07-26T12:00:00.000Z',
    project: {
      id: 'p1',
      name: 'Project',
      description: '',
      archived_at: null,
      created_at: '2026-07-01T00:00:00.000Z',
      created_by: 'u1',
      member_ids: [],
      is_public: false,
    },
    users: [{ id: 'u1', email: 'owner@example.com', name: 'Owner' }],
    columns: [
      { id: 'c1', name: 'To Do', position: 1000, is_done: false },
      { id: 'c2', name: 'Done', position: 2000, is_done: true },
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
    position: 1000,
    due_date: null,
    created_at: '2026-07-02T00:00:00.000Z',
    updated_at: '2026-07-03T00:00:00.000Z',
    archived_at: null,
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    images: [],
    ...overrides,
  };
}

describe('tasksCsv', () => {
  it('starts with the BOM and the documented header row', () => {
    const csv = tasksCsv(exportFixture());
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv.slice(1)).toBe(
      'id,title,column,is_done,position,due_date,labels,assignees,blocked_by,image_count,created_at,updated_at,archived_at,description\r\n'
    );
  });

  it('writes one row per task with resolved column, labels, assignees and blockers', () => {
    const csv = tasksCsv(
      exportFixture({
        tasks: [
          taskFixture({ id: 't1', title: 'Blocker task', column_id: 'c2' }),
          taskFixture({
            id: 't2',
            title: 'Blocked task',
            position: 2000,
            due_date: '2026-08-03',
            label_ids: ['l1'],
            assignee_ids: ['u1'],
            blocker_ids: ['t1'],
            images: [
              {
                id: 'i1',
                path: 'images/i1.png',
                filename: 'a.png',
                content_type: 'image/png',
                size_bytes: 4,
                created_at: '2026-07-04T00:00:00.000Z',
              },
            ],
          }),
        ],
      })
    );

    const lines = csv.split('\r\n');
    expect(lines[1]).toBe(
      't1,Blocker task,Done,true,1000,,,,,0,2026-07-02T00:00:00.000Z,2026-07-03T00:00:00.000Z,,'
    );
    expect(lines[2]).toBe(
      't2,Blocked task,To Do,false,2000,2026-08-03,bug,owner@example.com,Blocker task,1,2026-07-02T00:00:00.000Z,2026-07-03T00:00:00.000Z,,'
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
          { id: 'u1', email: 'owner@example.com', name: 'Owner' },
          { id: 'u2', email: 'dev@example.com', name: 'Dev' },
        ],
        tasks: [
          taskFixture({ id: 't1', title: 'One' }),
          taskFixture({ id: 't2', title: 'Two', position: 2000 }),
          taskFixture({
            id: 't3',
            title: 'Three',
            position: 3000,
            label_ids: ['l1', 'l2'],
            assignee_ids: ['u1', 'u2'],
            blocker_ids: ['t1', 't2'],
          }),
        ],
      })
    );

    expect(csv.split('\r\n')[3]).toBe(
      't3,Three,To Do,false,3000,,bug; ui,owner@example.com; dev@example.com,One; Two,0,' +
        '2026-07-02T00:00:00.000Z,2026-07-03T00:00:00.000Z,,'
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
          { id: 'u2', email: 'ann@example.com', name: 'Ann' },
          { id: 'u1', email: 'zoe@example.com', name: 'Zoe' },
        ],
        tasks: [
          taskFixture({ id: 't1', title: 'First' }),
          taskFixture({ id: 't2', title: 'Second', position: 2000 }),
          taskFixture({
            id: 't3',
            title: 'Third',
            position: 3000,
            label_ids: ['l1', 'l2'],
            assignee_ids: ['u1', 'u2'],
            blocker_ids: ['t2', 't1'],
          }),
        ],
      })
    );

    const row = csv.split('\r\n')[3];
    expect(row).toContain('aardvark; zebra');
    expect(row).toContain('ann@example.com; zoe@example.com');
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
      't1,Task,To Do,false,1000,,bug,,,0,2026-07-02T00:00:00.000Z,2026-07-03T00:00:00.000Z,,'
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
            position: 2000,
            archived_at: '2026-07-05T00:00:00.000Z',
          }),
        ],
      })
    );

    const lines = csv.split('\r\n');
    expect(lines[1]).toBe(
      't1,Live,To Do,false,1000,,,,,0,2026-07-02T00:00:00.000Z,2026-07-03T00:00:00.000Z,,'
    );
    expect(lines[2]).toBe(
      't2,Shelved,To Do,false,2000,,,,,0,2026-07-02T00:00:00.000Z,2026-07-03T00:00:00.000Z,' +
        '2026-07-05T00:00:00.000Z,'
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
