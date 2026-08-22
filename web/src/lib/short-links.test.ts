import { describe, expect, it } from 'vitest';
import { newId } from './ids';
import {
  decodeId,
  encodeId,
  projectHref,
  publicBoardHref,
  publicTaskHref,
  slugify,
  taskHref,
} from './short-links';

// Asserted verbatim in the CLI's twin suite; the two implementations share no
// package, and these pairs are the only thing that stops them drifting.
const VECTORS: [uuid: string, alias: string][] = [
  ['00000000-0000-0000-0000-000000000000', 'AAAAAAAAAAAAAAAAAAAAAA'],
  ['ffffffff-ffff-ffff-ffff-ffffffffffff', 'HxECNQWFdpvuJxIw3HPrmH'],
  ['7c098c3d-1f2e-4a6b-8c9d-0e1f2a3b4c5d', 'DwDZhW21Arz6NkibWPJZy1'],
  ['0550a4bd-9e33-4f10-a2b7-6c5d4e3f2a1b', 'AKBykCIbK5eny27ibPhskr'],
  ['deadbeef-0000-4000-8000-feedfacecafe', 'GwLrToEBWPYKIkSF5unkbc'],
];

describe('encodeId', () => {
  it('matches the fixed cross-repo vectors', () => {
    for (const [uuid, alias] of VECTORS) {
      expect(encodeId(uuid)).toBe(alias);
    }
  });

  it('emits 22 URL-safe characters with no padding', () => {
    for (let i = 0; i < 1000; i++) {
      expect(encodeId(newId())).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it('accepts an uppercase uuid and normalizes it', () => {
    expect(encodeId('7C098C3D-1F2E-4A6B-8C9D-0E1F2A3B4C5D')).toBe('DwDZhW21Arz6NkibWPJZy1');
  });

  it('throws on anything that is not a uuid', () => {
    expect(() => encodeId('p1')).toThrow(TypeError);
    expect(() => encodeId('')).toThrow(TypeError);
    expect(() => encodeId('DwDZhW21Arz6NkibWPJZy1')).toThrow(TypeError);
    expect(() => encodeId('7c098c3d1f2e4a6b8c9d0e1f2a3b4c5d')).toThrow(TypeError);
  });
});

describe('decodeId', () => {
  it('matches the fixed cross-repo vectors', () => {
    for (const [uuid, alias] of VECTORS) {
      expect(decodeId(alias)).toBe(uuid);
    }
  });

  it('round-trips every id', () => {
    for (let i = 0; i < 1000; i++) {
      const id = newId();
      expect(decodeId(encodeId(id))).toBe(id);
    }
  });

  // Fixed-width big-endian base62 is a bijection, so this replaces the old
  // scheme's problem outright: base64url's four spare bits gave every id fifteen
  // working spellings, and the decoder had to re-encode to reject them.
  it('gives an id exactly one spelling', () => {
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const [uuid, alias] = VECTORS[2]!;
    for (let position = 0; position < alias.length; position++) {
      for (const character of ALPHABET) {
        if (character === alias[position]) continue;
        const variant = alias.slice(0, position) + character + alias.slice(position + 1);
        expect(decodeId(variant)).not.toBe(uuid);
      }
    }
  });

  // 22 base62 characters reach about eight times 2^128, so a well-formed alias
  // can still name nothing. These two are adjacent: the largest uuid, and the
  // string one step past it.
  it('rejects a well-formed alias that names no uuid', () => {
    expect(decodeId('HxECNQWFdpvuJxIw3HPrmH')).toBe('ffffffff-ffff-ffff-ffff-ffffffffffff');
    expect(decodeId('HxECNQWFdpvuJxIw3HPrmI')).toBeNull();
    expect(decodeId('9'.repeat(22))).toBeNull();
  });

  // The dash and underscore left the alphabet, so every alias minted by the
  // base64url scheme this replaced is now unreadable. The known cost, asserted.
  it('rejects an alias minted by the old base64url scheme', () => {
    expect(decodeId('-KGyw9TlT2qLnA0eLzpLXA')).toBeNull();
    expect(decodeId('_____________________w')).toBeNull();
    expect(decodeId('3q2-7wAAQACAAP7t-s7K_g')).toBeNull();
  });

  it('rejects the wrong length', () => {
    expect(decodeId('AAAAAAAAAAAAAAAAAAAAA')).toBeNull();
    expect(decodeId('AAAAAAAAAAAAAAAAAAAAAAA')).toBeNull();
    expect(decodeId('')).toBeNull();
    expect(decodeId('zzz')).toBeNull();
  });

  it('rejects characters outside the alphabet', () => {
    expect(decodeId('DwDZhW21Arz6NkibWPJZ+1')).toBeNull();
    expect(decodeId('DwDZhW21Arz6NkibWPJZ/1')).toBeNull();
    expect(decodeId('DwDZhW21Arz6NkibWPJZ=1')).toBeNull();
    expect(decodeId('DwDZhW21Arz6NkibWPJZ 1')).toBeNull();
  });

  it('is case sensitive', () => {
    const alias = 'DwDZhW21Arz6NkibWPJZy1';
    const flipped = 'FAmMPR8uSmuMnQ4fKjtMXQ';
    expect(flipped).not.toBe(alias);
    expect(decodeId(flipped)).not.toBe(decodeId(alias));
  });

  it('rejects a lowercased alias', () => {
    expect(decodeId('DwDZhW21Arz6NkibWPJZy1'.toLowerCase())).toBeNull();
  });
});

describe('slugify', () => {
  it('lowercases and joins runs of non-alphanumerics with a single dash', () => {
    expect(slugify('Fix the login bug')).toBe('fix-the-login-bug');
    expect(slugify('  Ship  v2.0 — now! ')).toBe('ship-v2-0-now');
    expect(slugify('Colorimetry')).toBe('colorimetry');
  });

  it('returns a dash when nothing survives', () => {
    expect(slugify('★★★')).toBe('-');
    expect(slugify('日本語')).toBe('-');
    expect(slugify('')).toBe('-');
    expect(slugify('---')).toBe('-');
  });

  it('truncates to 60 characters without a trailing dash', () => {
    const slug = slugify('a'.repeat(80));
    expect(slug).toHaveLength(60);
    const cut = slugify(`${'b'.repeat(59)} tail`);
    expect(cut).toBe('b'.repeat(59));
    expect(cut.endsWith('-')).toBe(false);
  });

  it('is idempotent', () => {
    for (const title of ['Fix the login bug', '★★★', 'a'.repeat(80), 'Ship v2.0']) {
      expect(slugify(slugify(title))).toBe(slugify(title));
    }
  });
});

describe('href builders', () => {
  const projectId = '7c098c3d-1f2e-4a6b-8c9d-0e1f2a3b4c5d';
  const taskId = '0550a4bd-9e33-4f10-a2b7-6c5d4e3f2a1b';

  it('builds project hrefs', () => {
    expect(projectHref(projectId, 'Colorimetry')).toBe('/p/DwDZhW21Arz6NkibWPJZy1/colorimetry');
    expect(projectHref(projectId, 'Colorimetry', 'graph')).toBe(
      '/p/DwDZhW21Arz6NkibWPJZy1/colorimetry/graph'
    );
    expect(projectHref(projectId, '★★★')).toBe('/p/DwDZhW21Arz6NkibWPJZy1/-');
  });

  it('builds task hrefs', () => {
    expect(taskHref(taskId, 'Fix the login bug')).toBe(
      '/t/AKBykCIbK5eny27ibPhskr/fix-the-login-bug'
    );
    expect(taskHref(taskId, 'Fix the login bug', 'graph')).toBe(
      '/t/AKBykCIbK5eny27ibPhskr/fix-the-login-bug/graph'
    );
  });

  it('builds public hrefs without a slug', () => {
    expect(publicBoardHref(projectId)).toBe('/public/projects/DwDZhW21Arz6NkibWPJZy1');
    expect(publicTaskHref(projectId, taskId)).toBe(
      '/public/projects/DwDZhW21Arz6NkibWPJZy1/tasks/AKBykCIbK5eny27ibPhskr'
    );
  });

  it('never needs escaping', () => {
    for (const href of [
      projectHref(projectId, 'Ship v2.0 — now!'),
      taskHref(taskId, '50% off?'),
      publicTaskHref(projectId, taskId),
    ]) {
      expect(encodeURI(href)).toBe(href);
    }
  });
});
