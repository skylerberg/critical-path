import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { decodeId, encodeId, slugify, taskUrl } from '../../src/short-links';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Asserted verbatim in the web app's twin suite; the two implementations share no
// package, and these pairs are the only thing that stops them drifting.
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
      expect(encodeId(randomUUID())).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it('accepts an uppercase uuid and normalizes it', () => {
    expect(encodeId('7C098C3D-1F2E-4A6B-8C9D-0E1F2A3B4C5D')).toBe('fAmMPR8uSmuMnQ4fKjtMXQ');
  });

  it('throws on anything that is not a uuid', () => {
    expect(() => encodeId('p1')).toThrow(TypeError);
    expect(() => encodeId('fAmMPR8uSmuMnQ4fKjtMXQ')).toThrow(TypeError);
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
      const id = randomUUID();
      expect(decodeId(encodeId(id))).toBe(id);
    }
  });

  // The catcher for an implementation built on Buffer.from(x, 'base64url') or
  // atob: both accept all 16 spellings and return the same uuid, which would give
  // every card sixteen working URLs.
  it('rejects every non-canonical trailing character', () => {
    for (const [, alias] of VECTORS) {
      const canonicalIndex = ALPHABET.indexOf(alias[21]);
      expect(canonicalIndex % 16).toBe(0);
      for (let offset = 1; offset < 16; offset++) {
        const variant = alias.slice(0, 21) + ALPHABET[canonicalIndex + offset];
        expect(variant).not.toBe(alias);
        expect(decodeId(variant)).toBeNull();
        // The bug being guarded against: the variant does decode elsewhere.
        expect(Buffer.from(variant, 'base64url').toString('hex')).toBe(
          VECTORS.find((v) => v[1] === alias)![0].replace(/-/g, '')
        );
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
  });

  it('is case sensitive, so a lowercased ref is not the same alias', () => {
    const alias = 'fAmMPR8uSmuMnQ4fKjtMXQ';
    expect(decodeId(alias.toLowerCase())).toBeNull();
    expect(decodeId('FAmMPR8uSmuMnQ4fKjtMXQ')).not.toBe(decodeId(alias));
  });

  it('never decodes a plain uuid', () => {
    for (const [uuid] of VECTORS) {
      expect(decodeId(uuid)).toBeNull();
    }
  });
});

describe('slugify', () => {
  it('lowercases and joins runs of non-alphanumerics with a single dash', () => {
    expect(slugify('Fix the login bug')).toBe('fix-the-login-bug');
    expect(slugify('  Ship  v2.0 — now! ')).toBe('ship-v2-0-now');
  });

  it('returns a dash when nothing survives', () => {
    expect(slugify('★★★')).toBe('-');
    expect(slugify('日本語')).toBe('-');
    expect(slugify('')).toBe('-');
  });

  it('truncates to 60 characters without a trailing dash', () => {
    expect(slugify('a'.repeat(80))).toHaveLength(60);
    expect(slugify(`${'b'.repeat(59)} tail`)).toBe('b'.repeat(59));
  });
});

describe('taskUrl', () => {
  it('joins the web base URL, the alias and the slug', () => {
    expect(
      taskUrl('https://example.test', '0550a4bd-9e33-4f10-a2b7-6c5d4e3f2a1b', 'Fix the login bug')
    ).toBe('https://example.test/t/BVCkvZ4zTxCit2xdTj8qGw/fix-the-login-bug');
  });

  it('still produces a slug segment for an unslugifiable title', () => {
    expect(taskUrl('https://example.test', '0550a4bd-9e33-4f10-a2b7-6c5d4e3f2a1b', '★★★')).toBe(
      'https://example.test/t/BVCkvZ4zTxCit2xdTj8qGw/-'
    );
  });
});
