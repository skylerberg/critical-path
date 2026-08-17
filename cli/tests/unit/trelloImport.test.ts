import { describe, it, expect } from 'vitest';
import { actionCardId, createdAt, isoDay, type TrelloBoard } from '../../src/trello/export';
import { taskId } from '../../src/trello/ids';
import { hexForTrelloColor } from '../../src/trello/colors';
import { rewriteImageSources, toDocument } from '../../src/trello/markdown';
import { buildPlan } from '../../src/trello/plan';

function plainText(node: unknown): string {
  const value = node as { type?: string; text?: string; content?: unknown[] };
  if (value.type === 'text') return value.text ?? '';
  return (value.content ?? []).map(plainText).join(value.type === 'doc' ? '\n' : '');
}

function linkHrefs(node: unknown): string[] {
  const value = node as {
    marks?: { type: string; attrs?: { href?: string } }[];
    content?: unknown[];
  };
  const own = (value.marks ?? [])
    .filter((mark) => mark.type === 'link')
    .map((mark) => mark.attrs?.href ?? '');
  return [...own, ...(value.content ?? []).flatMap(linkHrefs)];
}

describe('markdown neutralisation', () => {
  it('keeps a bracketed expression that is not a link, rather than rejecting the card', () => {
    // A pasted Python traceback: "[rule.endpoint](**req.view_args)" parses as a
    // link whose href the converter refuses. The characters are the content.
    const source = 'return self.view_functions[rule.endpoint](**req.view_args)';
    expect(plainText(toDocument(source))).toContain('[rule.endpoint](**req.view_args)');
  });

  it('keeps bare angle brackets that Markdown reads as raw HTML', () => {
    expect(plainText(toDocument('it will have a <GUID>.png name'))).toContain('<GUID>.png');
    expect(plainText(toDocument('overflow:hidden ends up on <body>'))).toContain('<body>');
  });

  it('still converts the Markdown it supports', () => {
    const doc = toDocument('# Title\n\n- one\n- two\n\n**bold** and `code`');
    const types = (doc.content ?? []).map((node) => (node as { type: string }).type);
    expect(types).toEqual(['heading', 'bulletList', 'paragraph']);
    expect(plainText(doc)).toContain('bold');
  });

  it('rewrites a Trello attachment image to an uploaded image src', () => {
    const trelloUrl = 'https://trello.com/1/cards/abc/attachments/def/download/image.png';
    const src = '/api/images/50a53a94-2db4-5a71-8b87-c347cadde1d9';
    const doc = toDocument(
      rewriteImageSources(`![image.png](${trelloUrl})`, new Map([[trelloUrl, src]]))
    );
    expect(doc.content?.[0]).toMatchObject({ type: 'image', attrs: { src } });
  });

  it('degrades an image Trello never uploaded to literal text', () => {
    const doc = toDocument('![shot](https://example.com/a.png)');
    expect(plainText(doc)).toContain('![shot](https://example.com/a.png)');
  });
});

describe('Trello identifiers', () => {
  it('derives a stable uuid per card, which is what makes a re-run resumable', () => {
    expect(taskId('60bf456050c6732765ac7cf6')).toBe(taskId('60bf456050c6732765ac7cf6'));
    expect(taskId('60bf456050c6732765ac7cf6')).not.toBe(taskId('60bf456050c6732765ac7cf7'));
    expect(taskId('60bf456050c6732765ac7cf6')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('reads the creation date out of the ObjectId, the only place it survives', () => {
    expect(isoDay(createdAt('5a8892dbaa7130f038dd63f4'))).toBe('2018-02-17');
  });

  it('accepts either field the two Trello sources use to name a card', () => {
    expect(actionCardId({ card: { id: 'fromCard' } })).toBe('fromCard');
    expect(actionCardId({ idCard: 'fromIdCard' })).toBe('fromIdCard');
    expect(actionCardId({})).toBeNull();
  });
});

describe('label colours', () => {
  it('maps Trello palette names to hex and refuses an unknown one', () => {
    expect(hexForTrelloColor('green_dark')).toBe('#1f845a');
    expect(hexForTrelloColor(null)).toMatch(/^#[0-9a-f]{6}$/);
    expect(() => hexForTrelloColor('chartreuse')).toThrow(/Unknown Trello label colour/);
  });
});

function board(overrides: Partial<TrelloBoard> = {}): TrelloBoard {
  return {
    id: 'b1',
    name: 'Board',
    shortUrl: 'https://trello.com/b/b1',
    labels: [],
    lists: [],
    members: [],
    cards: [],
    checklists: [],
    actions: [],
    ...overrides,
  } as TrelloBoard;
}

function card(overrides: Record<string, unknown>): TrelloBoard['cards'][number] {
  return {
    id: '5a8892dbaa7130f038dd63f4',
    idShort: 1,
    name: 'A card',
    desc: '',
    closed: false,
    pos: 1,
    url: 'https://trello.com/c/aaa/1-a-card',
    shortUrl: 'https://trello.com/c/aaa',
    idList: 'open',
    idLabels: [],
    idMembers: [],
    idChecklists: [],
    idAttachmentCover: null,
    dateLastActivity: '2024-01-01T00:00:00.000Z',
    dateClosed: null,
    attachments: [],
    badges: { comments: 0 },
    ...overrides,
  } as TrelloBoard['cards'][number];
}

const LISTS = [
  { id: 'open', name: 'Doing', closed: false, pos: 2 },
  { id: 'gone', name: 'Alpha 1.0', closed: true, pos: 1 },
];

function planFor(cards: TrelloBoard['cards'], extra: Partial<TrelloBoard> = {}) {
  return buildPlan(board({ lists: LISTS, cards, ...extra }), {
    assigneeMap: new Map([['member-1', 'ffffffff-ffff-4fff-8fff-ffffffffffff']]),
    doneListNames: new Set(['Doing']),
    comments: [],
  });
}

describe('plan', () => {
  it('sends cards from an archived list to the synthetic column, since columns cannot be archived', () => {
    const plan = planFor([
      card({ id: '5a8892dbaa7130f038dd63f4', idList: 'open' }),
      card({ id: '5add6699d585f7f8f9558693', idList: 'gone', closed: true, idShort: 2 }),
    ]);
    expect(plan.columns.map((column) => column.name)).toEqual(['Doing', 'Archived (Trello)']);
    const archived = plan.columns[1]!;
    expect(plan.tasks.filter((task) => task.columnId === archived.id)).toHaveLength(1);
    expect(plan.columns[0]!.isDone).toBe(true);
  });

  it('records the original list in the footer, which is where an archived list survives', () => {
    const plan = planFor([card({ idList: 'gone', closed: true })]);
    expect(plainText(plan.tasks[0]!.description)).toContain('List: Alpha 1.0');
  });

  it('gives every card a description even when Trello had none', () => {
    const plan = planFor([card({ idShort: 842, shortUrl: 'https://trello.com/c/e00aszcG' })]);
    const text = plainText(plan.tasks[0]!.description);
    expect(text).toContain('card #842');
    // The card number and dates read as text; the back-link is a real link, so
    // the URL lives on the mark rather than in the visible characters.
    expect(linkHrefs(plan.tasks[0]!.description)).toContain('https://trello.com/c/e00aszcG');
  });

  it('assigns a mapped member and footnotes one with no account', () => {
    const plan = planFor([card({ idMembers: ['member-1', 'member-2'] })], {
      members: [{ id: 'member-2', username: 'fx_wood', fullName: 'FX-Wood' }],
    } as Partial<TrelloBoard>);
    expect(plan.tasks[0]!.assigneeIds).toEqual(['ffffffff-ffff-4fff-8fff-ffffffffffff']);
    expect(plainText(plan.tasks[0]!.description)).toContain('Assigned in Trello to FX-Wood');
    expect(plan.unmappedMembers.get('FX-Wood')).toBe(1);
  });

  it('names a checklist on its items when the name carries meaning', () => {
    const plan = planFor([card({ id: '5a8892dbaa7130f038dd63f4' })], {
      checklists: [
        {
          id: 'cl1',
          idCard: '5a8892dbaa7130f038dd63f4',
          name: 'Things to fix',
          pos: 1,
          checkItems: [{ id: 'ci1', name: 'One', pos: 1, state: 'complete' }],
        },
        {
          id: 'cl2',
          idCard: '5a8892dbaa7130f038dd63f4',
          name: 'Checklist',
          pos: 2,
          checkItems: [{ id: 'ci2', name: 'Two', pos: 1, state: 'incomplete' }],
        },
      ],
    } as Partial<TrelloBoard>);
    expect(plan.checklistItems.map((item) => [item.text, item.checked])).toEqual([
      ['[Things to fix] One', true],
      ['Two', false],
    ]);
  });
});
