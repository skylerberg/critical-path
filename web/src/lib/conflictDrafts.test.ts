import { beforeEach, describe, expect, it } from 'vitest';
import { conflictDrafts, type ConflictDraft } from './conflictDrafts.svelte';

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

  it('clears everything, which is what ending a session does', () => {
    conflictDrafts.set('t1', draft('Design cards v2'));
    conflictDrafts.set('t2', draft('Cut prototype v2'));

    conflictDrafts.clearAll();

    expect(conflictDrafts.get('t1')).toBeNull();
    expect(conflictDrafts.get('t2')).toBeNull();
  });
});
