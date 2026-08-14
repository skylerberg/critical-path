import { beforeEach, describe, expect, it } from 'vitest';
import { conflictDrafts, mergeVersion, type ConflictDraft } from './conflictDrafts.svelte';

const doc = {
  type: 'doc' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'mine' }] }],
};

function draft(title: string): ConflictDraft {
  return {
    mine: { title, description: doc },
    base: { title: 'Design cards', description: null },
  };
}

beforeEach(() => {
  conflictDrafts.clearAll();
});

describe('conflictDrafts', () => {
  it('returns null for a task with no unresolved conflict', () => {
    expect(conflictDrafts.get('t1')).toBeNull();
  });

  it('keeps a draft per task and replaces one in place', () => {
    conflictDrafts.set('t1', draft('Design cards v2'));
    conflictDrafts.set('t2', draft('Cut prototype v2'));
    conflictDrafts.set('t1', draft('Design cards v3'));

    expect(conflictDrafts.get('t1')?.mine.title).toBe('Design cards v3');
    expect(conflictDrafts.get('t2')?.mine.title).toBe('Cut prototype v2');
  });

  it('clears one task without touching the rest', () => {
    conflictDrafts.set('t1', draft('Design cards v2'));
    conflictDrafts.set('t2', draft('Cut prototype v2'));

    conflictDrafts.clear('t1');

    expect(conflictDrafts.get('t1')).toBeNull();
    expect(conflictDrafts.get('t2')).not.toBeNull();
  });

  // What the resolver offers as "mine" for every guarded write and for the
  // offline coalesce. Clearing a description is an edit like any other, so a
  // patch that carries `null` has to beat the baseline's text — a `??` here
  // would hand the user back the version they deleted and call it theirs.
  describe('mergeVersion', () => {
    const base = { title: 'Design cards', description: doc };

    it('keeps a cleared description cleared', () => {
      expect(mergeVersion(base, { description: null })).toEqual({
        title: 'Design cards',
        description: null,
      });
    });

    it('leaves the baseline description alone for a title-only patch', () => {
      expect(mergeVersion(base, { title: 'Design cards v2' })).toEqual({
        title: 'Design cards v2',
        description: doc,
      });
    });

    it('lays a patched description over the baseline', () => {
      const next = { type: 'doc' as const, content: [{ type: 'paragraph' }] };
      expect(mergeVersion(base, { description: next })).toEqual({
        title: 'Design cards',
        description: next,
      });
    });
  });

  it('clears everything, which is what ending a session does', () => {
    conflictDrafts.set('t1', draft('Design cards v2'));
    conflictDrafts.set('t2', draft('Cut prototype v2'));

    conflictDrafts.clearAll();

    expect(conflictDrafts.get('t1')).toBeNull();
    expect(conflictDrafts.get('t2')).toBeNull();
  });
});
