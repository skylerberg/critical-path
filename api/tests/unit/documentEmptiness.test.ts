import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { describe, it, expect } from 'vitest';
import {
  findTiptapDocProblem,
  isEmptyTiptapDoc,
  type TiptapDoc,
  type TiptapNode,
} from '../../src/schemas/tiptap';

// Whether a document counts as empty is decided twice. Here, `isEmptyTiptapDoc`
// is what refuses an empty comment body; in `web/src/lib/tiptap.ts`, a
// `hasVisibleContent` of the same name is what decides whether the editor sends
// a description at all. The header of src/schemas/tiptap.ts names the hazard
// this test exists to hold off: "a second opinion about a node type in one of
// them is how a document comes to be empty in one place and not in another."
//
// Neither side can import the other — four packages, four node_modules, no
// workspace — and a shared runtime module is not available at any price, so the
// agreement is held by reading web's decision out of its source and running it
// against the same corpus, the way documentedLimits.test.ts and
// eventCatalog.test.ts read README.md.
//
// The corpus spells out the expected verdict rather than only asserting that
// the two match, so two implementations that had drifted together still fail.

const WEB_TIPTAP = new URL('../../../web/src/lib/tiptap.ts', import.meta.url);
// In dependency order: the built function is these four and nothing else, which
// is the whole of what web consults to answer the question.
const WEB_FUNCTIONS = ['isNode', 'childrenOf', 'hasVisibleContent', 'isEmptyDoc'];

function readWebIsEmptyDoc(): (doc: unknown) => boolean {
  const source = readFileSync(WEB_TIPTAP, 'utf8');
  const declarations = WEB_FUNCTIONS.map((name) => {
    // Anchored on a closing brace in column one, which is where prettier puts
    // the end of a top-level declaration in that file.
    const match = new RegExp(String.raw`^(?:export )?function ${name}\([\s\S]*?^}$`, 'm').exec(
      source
    );
    if (match === null) {
      throw new Error(
        `web/src/lib/tiptap.ts no longer declares ${name}(). This test checks nothing ` +
          `until it is pointed at whatever replaced it — do not delete the name from ` +
          `WEB_FUNCTIONS to make this pass.`
      );
    }
    return match[0].replace(/^export /, '');
  });
  const body = `${stripTypeScriptTypes(declarations.join('\n\n'), { mode: 'strip' })}\nreturn isEmptyDoc;`;
  // Built rather than imported because web's module cannot be loaded here: its
  // sibling imports pull in svelte and `.svelte.ts` runes that this vitest
  // project has no plugin to compile. The input is a file in this repository,
  // read at test time.
  return new Function(body)() as (doc: unknown) => boolean;
}

interface Document {
  what: string;
  doc: TiptapDoc;
  empty: boolean;
}

const IMAGE = { src: '/api/images/123e4567-e89b-12d3-a456-426614174000', alt: '', title: null };
const MENTION = {
  type: 'mention',
  attrs: { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', label: 'Alice' },
};

function doc(...content: TiptapNode[]): TiptapDoc {
  return { type: 'doc', content };
}

const CORPUS: Document[] = [
  { what: 'a doc with no content key', doc: { type: 'doc' }, empty: true },
  { what: 'a doc with an empty content list', doc: doc(), empty: true },
  { what: 'a paragraph with no content key', doc: doc({ type: 'paragraph' }), empty: true },
  {
    what: 'a paragraph with an empty content list',
    doc: doc({ type: 'paragraph', content: [] }),
    empty: true,
  },
  {
    what: 'a paragraph holding only spaces',
    doc: doc({ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }),
    empty: true,
  },
  {
    what: 'a paragraph holding only a tab and a newline',
    doc: doc({ type: 'paragraph', content: [{ type: 'text', text: '\t\n' }] }),
    empty: true,
  },
  {
    what: 'a paragraph holding an empty text node',
    doc: doc({ type: 'paragraph', content: [{ type: 'text', text: '' }] }),
    empty: true,
  },
  {
    what: 'whitespace carrying a mark, which marks nothing',
    doc: doc({
      type: 'paragraph',
      content: [{ type: 'text', text: ' ', marks: [{ type: 'bold' }] }],
    }),
    empty: true,
  },
  {
    what: 'a paragraph holding a hard break and nothing else',
    doc: doc({ type: 'paragraph', content: [{ type: 'hardBreak' }] }),
    empty: true,
  },
  { what: 'an empty heading', doc: doc({ type: 'heading', attrs: { level: 1 } }), empty: true },
  { what: 'an empty code block', doc: doc({ type: 'codeBlock', content: [] }), empty: true },
  {
    what: 'a code block holding only spaces',
    doc: doc({ type: 'codeBlock', content: [{ type: 'text', text: '  ' }] }),
    empty: true,
  },
  {
    what: 'empty nodes nested three deep',
    doc: doc({
      type: 'blockquote',
      content: [
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
        },
      ],
    }),
    empty: true,
  },
  {
    what: 'whitespace nested three deep',
    doc: doc({
      type: 'blockquote',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }],
            },
          ],
        },
      ],
    }),
    empty: true,
  },
  {
    what: 'several paragraphs, each empty a different way',
    doc: doc(
      { type: 'paragraph' },
      { type: 'paragraph', content: [] },
      { type: 'paragraph', content: [{ type: 'text', text: '' }] }
    ),
    empty: true,
  },
  {
    what: 'a paragraph with words in it',
    doc: doc({ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }),
    empty: false,
  },
  {
    what: 'an empty paragraph followed by one with words',
    doc: doc({ type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text: 'x' }] }),
    empty: false,
  },
  { what: 'a bare image', doc: doc({ type: 'image', attrs: IMAGE }), empty: false },
  {
    what: 'an image alone in a paragraph, its alt text empty',
    doc: doc({ type: 'paragraph', content: [{ type: 'image', attrs: IMAGE }] }),
    empty: false,
  },
  {
    what: 'an image nested in a quote',
    doc: doc({
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'image', attrs: IMAGE }] }],
    }),
    empty: false,
  },
  { what: 'a bare rule', doc: doc({ type: 'horizontalRule' }), empty: false },
  {
    what: 'a mention alone in a paragraph, an atom carrying no text',
    doc: doc({ type: 'paragraph', content: [MENTION] }),
    empty: false,
  },
  { what: 'a bare mention', doc: doc(MENTION), empty: false },
  {
    what: 'a code block with a line in it',
    doc: doc({ type: 'codeBlock', content: [{ type: 'text', text: 'x' }] }),
    empty: false,
  },
  {
    what: 'words nested three deep',
    doc: doc({
      type: 'blockquote',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'deep' }] }],
            },
          ],
        },
      ],
    }),
    empty: false,
  },
];

// The two implementations part on exactly two shapes, and the validator rejects
// both: web stops at the first node carrying a `text` property and never looks
// at its children, where this file recurses past it. Neither function is ever
// handed one — arktype validates before `isEmptyTiptapDoc` runs in
// schemas/comments.ts, and web only ever asks about a document the editor built
// or the server already accepted — so the agreement below rests on these staying
// invalid. If a relaxation ever lets one through, this fails first.
const SHAPES_THE_VALIDATOR_HOLDS_OFF: Array<{ what: string; doc: unknown }> = [
  {
    what: 'a paragraph carrying a text property of its own',
    doc: { type: 'doc', content: [{ type: 'paragraph', text: '  ', content: [] }] },
  },
  {
    what: 'a text node carrying children',
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '', content: [{ type: 'text' }] }] },
      ],
    },
  },
];

describe('document emptiness is judged the same way in api and web', () => {
  const webIsEmptyDoc = readWebIsEmptyDoc();

  // Without this, a regex that matched a stub — or an extraction that dropped
  // the recursion — would agree with every row below by accident.
  it('reads a web implementation that answers both ways and recurses', () => {
    expect(webIsEmptyDoc({ type: 'doc', content: [] })).toBe(true);
    expect(webIsEmptyDoc(doc({ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }))).toBe(
      false
    );
    expect(
      webIsEmptyDoc(
        doc({
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
        })
      )
    ).toBe(false);
  });

  for (const { what, doc: document, empty } of CORPUS) {
    it(`calls ${what} ${empty ? 'empty' : 'not empty'}, on both sides`, () => {
      // A row that stopped being a document either side would accept proves
      // nothing about the two agreeing on the ones they see.
      expect(findTiptapDocProblem(document)).toBeNull();
      expect(isEmptyTiptapDoc(document)).toBe(empty);
      expect(webIsEmptyDoc(document)).toBe(empty);
    });
  }

  for (const { what, doc: document } of SHAPES_THE_VALIDATOR_HOLDS_OFF) {
    it(`rejects ${what}, which the two would read differently`, () => {
      expect(findTiptapDocProblem(document)).not.toBeNull();
    });
  }
});
