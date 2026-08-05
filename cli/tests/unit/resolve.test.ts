import { describe, it, expect } from 'vitest';
import { matchRef, matchRefOrAlias } from '../../src/resolve';
import { encodeId } from '../../src/short-links';
import { CliError } from '../../src/api/errors';

interface Item {
  id: string;
  name: string;
}

const items: Item[] = [
  { id: 'aaaa1111-0000-4000-8000-000000000001', name: 'Fix login bug' },
  { id: 'aaaa2222-0000-4000-8000-000000000002', name: 'Fix logout bug' },
  { id: 'bbbb1111-0000-4000-8000-000000000003', name: 'Ship the release' },
  { id: 'cccc1111-0000-4000-8000-000000000004', name: 'aaaa2222' },
];

function match(ref: string, list: Item[] = items): Item {
  return matchRef(
    ref,
    list,
    'task',
    (i) => i.id,
    (i) => i.name
  );
}

function errorOf(fn: () => unknown): CliError {
  try {
    fn();
  } catch (err) {
    if (err instanceof CliError) return err;
    throw err;
  }
  throw new Error('expected a CliError');
}

describe('matchRef', () => {
  it('matches an exact UUID first', () => {
    expect(match('aaaa1111-0000-4000-8000-000000000001').name).toBe('Fix login bug');
  });

  it('matches an exact name case-insensitively', () => {
    expect(match('ship the release').id).toContain('bbbb1111');
  });

  it('prefers an exact name over an id prefix', () => {
    expect(match('aaaa2222').name).toBe('aaaa2222');
  });

  it('matches a unique id prefix of at least 4 characters', () => {
    expect(match('bbbb').name).toBe('Ship the release');
  });

  it('matches a unique name substring', () => {
    expect(match('release').id).toContain('bbbb1111');
  });

  it('reports ambiguity with candidates and exit code 2', () => {
    const err = errorOf(() => match('fix log'));
    expect(err.exitCode).toBe(2);
    expect(err.message).toContain('Ambiguous');
    expect(err.message).toContain('Fix login bug');
    expect(err.message).toContain('Fix logout bug');
  });

  it('treats an ambiguous id prefix as ambiguous', () => {
    const err = errorOf(() => match('aaaa'));
    expect(err.exitCode).toBe(2);
  });

  it('does not treat short hex strings as id prefixes', () => {
    expect(match('aaa').name).toBe('aaaa2222');
  });

  it('fails with exit code 4 when nothing matches', () => {
    const err = errorOf(() => match('does-not-exist'));
    expect(err.exitCode).toBe(4);
    expect(err.message).toContain('No task matching');
  });
});

describe('matchRefOrAlias', () => {
  const target = items[0];
  const alias = encodeId(target.id);
  // Decodes to a valid uuid, which is what lets a decode shadow a name.
  const alsoANameShapedLikeAnAlias = 'ArchivedRoadmapQ3Notes';
  const withAliasShapedName: Item[] = [
    ...items,
    { id: 'dddd1111-0000-4000-8000-000000000005', name: alsoANameShapedLikeAnAlias },
  ];

  function aliasMatch(ref: string, list: Item[] = items): Item {
    return matchRefOrAlias(
      ref,
      list,
      'task',
      (i) => i.id,
      (i) => i.name
    );
  }

  it('resolves an alias to the row it names', () => {
    expect(aliasMatch(alias)).toBe(target);
  });

  it('does not resolve a case-flipped alias to the same row', () => {
    const first = alias[0];
    const flipped = `${first === first.toUpperCase() ? first.toLowerCase() : first.toUpperCase()}${alias.slice(1)}`;
    expect(flipped).not.toBe(alias);
    expect(errorOf(() => aliasMatch(flipped)).exitCode).toBe(4);
  });

  it('leaves a name that is shaped like an alias reachable by that name', () => {
    expect(aliasMatch(alsoANameShapedLikeAnAlias, withAliasShapedName).id).toContain('dddd1111');
  });

  it('names the ref as typed when a decodable ref matches nothing', () => {
    const err = errorOf(() => aliasMatch('ReleaseNotesVersion34Q', withAliasShapedName));
    expect(err.exitCode).toBe(4);
    expect(err.message).toBe('No task matching "ReleaseNotesVersion34Q"');
  });
});
