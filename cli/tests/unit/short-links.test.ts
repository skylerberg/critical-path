import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { decodeId, encodeId, slugify, taskUrl } from '../../src/short-links';

// Asserted verbatim in web/src/lib/short-links.test.ts, the web app's twin
// suite. The two copies share no package, and these pairs are what stops them
// drifting.
const VECTORS: [uuid: string, alias: string][] = [
  ['00000000-0000-0000-0000-000000000000', 'AAAAAAAAAAAAAAAAAAAAAA'],
  ['ffffffff-ffff-ffff-ffff-ffffffffffff', 'HxECNQWFdpvuJxIw3HPrmH'],
  ['7c098c3d-1f2e-4a6b-8c9d-0e1f2a3b4c5d', 'DwDZhW21Arz6NkibWPJZy1'],
  ['0550a4bd-9e33-4f10-a2b7-6c5d4e3f2a1b', 'AKBykCIbK5eny27ibPhskr'],
  ['deadbeef-0000-4000-8000-feedfacecafe', 'GwLrToEBWPYKIkSF5unkbc'],
];

// The largest uuid and the string one step past it. 22 base62 characters reach
// about eight times 2^128, so this pair is where a well-formed alias stops
// naming anything.
const LARGEST_UUID_ALIAS = 'HxECNQWFdpvuJxIw3HPrmH';
const FIRST_UNNAMEABLE_ALIAS = 'HxECNQWFdpvuJxIw3HPrmI';

describe('encodeId', () => {
  it('matches the fixed cross-package vectors', () => {
    for (const [uuid, alias] of VECTORS) {
      expect(encodeId(uuid)).toBe(alias);
    }
  });

  // The whole point of base62 over base64url. An alias that can begin with '-'
  // is an option flag to every CLI parser, which broke `cpath project show`
  // outright for the 1 project in 64 whose id started one.
  it('emits 22 alphanumeric characters and never a leading dash', () => {
    for (let i = 0; i < 5000; i++) {
      expect(encodeId(randomUUID())).toMatch(/^[A-Za-z0-9]{22}$/);
    }
  });

  it('accepts an uppercase uuid and normalizes it', () => {
    expect(encodeId('7C098C3D-1F2E-4A6B-8C9D-0E1F2A3B4C5D')).toBe('DwDZhW21Arz6NkibWPJZy1');
  });

  it('throws on anything that is not a uuid', () => {
    expect(() => encodeId('p1')).toThrow(TypeError);
    expect(() => encodeId('DwDZhW21Arz6NkibWPJZy1')).toThrow(TypeError);
  });
});

describe('decodeId', () => {
  it('matches the fixed cross-package vectors', () => {
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

  // Fixed-width big-endian base62 gives each id one spelling; that is the case
  // the base64url scheme it replaced could not make, and the web twin asserts it
  // from the other end.
  it('gives an id exactly one spelling', () => {
    const [uuid, alias] = VECTORS[2]!;
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let position = 0; position < alias.length; position++) {
      for (const character of ALPHABET) {
        if (character === alias[position]) continue;
        const variant = alias.slice(0, position) + character + alias.slice(position + 1);
        expect(decodeId(variant)).not.toBe(uuid);
      }
    }
  });

  it('rejects a well-formed alias that names no uuid', () => {
    expect(decodeId(LARGEST_UUID_ALIAS)).toBe('ffffffff-ffff-ffff-ffff-ffffffffffff');
    expect(decodeId(FIRST_UNNAMEABLE_ALIAS)).toBeNull();
    expect(decodeId('9'.repeat(22))).toBeNull();
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
  });

  // The dash and underscore are no longer in the alphabet, so every alias minted
  // by the base64url scheme this replaced is now unreadable. That is the known
  // cost of the change, asserted rather than discovered.
  it('rejects an alias minted by the old base64url scheme', () => {
    expect(decodeId('-KGyw9TlT2qLnA0eLzpLXA')).toBeNull();
    expect(decodeId('_____________________w')).toBeNull();
    expect(decodeId('3q2-7wAAQACAAP7t-s7K_g')).toBeNull();
  });

  it('is case sensitive, so a lowercased ref is not the same alias', () => {
    const alias = 'DwDZhW21Arz6NkibWPJZy1';
    expect(decodeId(alias.toLowerCase())).toBeNull();
    expect(decodeId(`d${alias.slice(1)}`)).not.toBe(decodeId(alias));
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
    ).toBe('https://example.test/t/AKBykCIbK5eny27ibPhskr/fix-the-login-bug');
  });

  it('still produces a slug segment for an unslugifiable title', () => {
    expect(taskUrl('https://example.test', '0550a4bd-9e33-4f10-a2b7-6c5d4e3f2a1b', '★★★')).toBe(
      'https://example.test/t/AKBykCIbK5eny27ibPhskr/-'
    );
  });
});
