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
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const VECTORS: [uuid: string, alias: string][] = [
  ['00000000-0000-0000-0000-000000000000', 'AAAAAAAAAAAAAAAAAAAAAA'],
  ['ffffffff-ffff-ffff-ffff-ffffffffffff', '_____________________w'],
  ['7c098c3d-1f2e-4a6b-8c9d-0e1f2a3b4c5d', 'fAmMPR8uSmuMnQ4fKjtMXQ'],
  ['0550a4bd-9e33-4f10-a2b7-6c5d4e3f2a1b', 'BVCkvZ4zTxCit2xdTj8qGw'],
  ['deadbeef-0000-4000-8000-feedfacecafe', '3q2-7wAAQACAAP7t-s7K_g'],
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
    expect(encodeId('7C098C3D-1F2E-4A6B-8C9D-0E1F2A3B4C5D')).toBe('fAmMPR8uSmuMnQ4fKjtMXQ');
  });

  it('throws on anything that is not a uuid', () => {
    expect(() => encodeId('p1')).toThrow(TypeError);
    expect(() => encodeId('')).toThrow(TypeError);
    expect(() => encodeId('fAmMPR8uSmuMnQ4fKjtMXQ')).toThrow(TypeError);
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

  // The catcher for an implementation built on atob / Buffer.from(x, 'base64url') /
  // Uint8Array.fromBase64: each of those accepts all 16 spellings and returns the
  // same uuid, which would give every card sixteen working URLs.
  it('rejects every non-canonical trailing character', () => {
    for (const [, alias] of VECTORS) {
      const stem = alias.slice(0, 21);
      const canonical = alias[21]!;
      const canonicalIndex = ALPHABET.indexOf(canonical);
      expect(canonicalIndex % 16).toBe(0);
      for (let offset = 1; offset < 16; offset++) {
        const variant = stem + ALPHABET[canonicalIndex + offset]!;
        expect(variant).not.toBe(alias);
        expect(decodeId(variant)).toBeNull();
      }
    }
  });

  it('accepts only the four canonical terminal characters', () => {
    const stem = 'AAAAAAAAAAAAAAAAAAAAA';
    const accepted = [...ALPHABET].filter((c) => decodeId(stem + c) !== null);
    expect(accepted).toEqual(['A', 'Q', 'g', 'w']);
  });

  it('rejects the wrong length', () => {
    expect(decodeId('AAAAAAAAAAAAAAAAAAAAA')).toBeNull();
    expect(decodeId('AAAAAAAAAAAAAAAAAAAAAAA')).toBeNull();
    expect(decodeId('')).toBeNull();
    expect(decodeId('zzz')).toBeNull();
  });

  it('rejects characters outside the alphabet', () => {
    expect(decodeId('fAmMPR8uSmuMnQ4fKjtM+Q')).toBeNull();
    expect(decodeId('fAmMPR8uSmuMnQ4fKjtM/Q')).toBeNull();
    expect(decodeId('fAmMPR8uSmuMnQ4fKjtM=Q')).toBeNull();
    expect(decodeId('fAmMPR8uSmuMnQ4fKjt MQ')).toBeNull();
  });

  it('is case sensitive', () => {
    const alias = 'fAmMPR8uSmuMnQ4fKjtMXQ';
    const flipped = 'FAmMPR8uSmuMnQ4fKjtMXQ';
    expect(flipped).not.toBe(alias);
    expect(decodeId(flipped)).not.toBe(decodeId(alias));
  });

  it('rejects a lowercased alias', () => {
    expect(decodeId('fAmMPR8uSmuMnQ4fKjtMXQ'.toLowerCase())).toBeNull();
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
    expect(projectHref(projectId, 'Colorimetry')).toBe('/p/fAmMPR8uSmuMnQ4fKjtMXQ/colorimetry');
    expect(projectHref(projectId, 'Colorimetry', 'graph')).toBe(
      '/p/fAmMPR8uSmuMnQ4fKjtMXQ/colorimetry/graph'
    );
    expect(projectHref(projectId, '★★★')).toBe('/p/fAmMPR8uSmuMnQ4fKjtMXQ/-');
  });

  it('builds task hrefs', () => {
    expect(taskHref(taskId, 'Fix the login bug')).toBe(
      '/t/BVCkvZ4zTxCit2xdTj8qGw/fix-the-login-bug'
    );
    expect(taskHref(taskId, 'Fix the login bug', 'graph')).toBe(
      '/t/BVCkvZ4zTxCit2xdTj8qGw/fix-the-login-bug/graph'
    );
  });

  it('builds public hrefs without a slug', () => {
    expect(publicBoardHref(projectId)).toBe('/public/projects/fAmMPR8uSmuMnQ4fKjtMXQ');
    expect(publicTaskHref(projectId, taskId)).toBe(
      '/public/projects/fAmMPR8uSmuMnQ4fKjtMXQ/tasks/BVCkvZ4zTxCit2xdTj8qGw'
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
