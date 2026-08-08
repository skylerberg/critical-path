import { beforeEach, describe, expect, it } from 'vitest';
import { docDraftKey, draftKey, drafts } from './drafts.svelte';

beforeEach(() => {
  drafts.clearAll();
});

describe('drafts', () => {
  it('reports no draft until one is started', () => {
    expect(drafts.get('a')).toBeNull();
  });

  it('keeps the entry when the text is emptied', () => {
    drafts.set('a', 'half typed');
    drafts.set('a', '');

    expect(drafts.get('a')).toBe('');
  });

  it('drops the entry on clear', () => {
    drafts.set('a', 'half typed');
    drafts.clear('a');

    expect(drafts.get('a')).toBeNull();
  });

  it('holds each key independently', () => {
    drafts.set('a', 'one');
    drafts.set('b', 'two');
    drafts.clear('a');

    expect(drafts.get('a')).toBeNull();
    expect(drafts.get('b')).toBe('two');
  });

  it('drops every draft on clearAll', () => {
    drafts.set('a', 'one');
    drafts.set('b', 'two');
    drafts.clearAll();

    expect(drafts.get('a')).toBeNull();
    expect(drafts.get('b')).toBeNull();
  });

  it('keys composers apart by kind and by owner id', () => {
    const keys = [draftKey.quickAddTask('x'), draftKey.addColumn('x'), draftKey.graphAddTask('x')];

    expect(new Set(keys).size).toBe(keys.length);
    expect(draftKey.quickAddTask('c1')).not.toBe(draftKey.quickAddTask('c2'));
  });

  it('holds a rich-text draft alongside the text ones', () => {
    const key = docDraftKey.taskComment('t1');
    expect(drafts.getDoc(key)).toBeNull();

    const doc = { type: 'doc' as const, content: [{ type: 'paragraph' }] };
    drafts.setDoc(key, doc);
    expect(drafts.getDoc(key)).toEqual(doc);

    drafts.clearDoc(key);
    expect(drafts.getDoc(key)).toBeNull();
  });

  it('keys rich-text drafts by task', () => {
    const doc = { type: 'doc' as const, content: [{ type: 'paragraph' }] };
    drafts.setDoc(docDraftKey.taskComment('t1'), doc);

    expect(drafts.getDoc(docDraftKey.taskComment('t2'))).toBeNull();
  });

  it('drops rich-text drafts on clearAll too', () => {
    drafts.setDoc(docDraftKey.taskComment('t1'), { type: 'doc' as const, content: [] });
    drafts.set(draftKey.addColumn('p1'), 'Doing');

    drafts.clearAll();

    expect(drafts.getDoc(docDraftKey.taskComment('t1'))).toBeNull();
    expect(drafts.get(draftKey.addColumn('p1'))).toBeNull();
  });
});
