import { describe, it, expect } from 'vitest';
import {
  collectMentionIds,
  newMentionIds,
  MAX_MENTION_RECIPIENTS,
} from '../../src/services/mentions';

function mention(id: unknown, label = 'Someone'): Record<string, unknown> {
  return { type: 'mention', attrs: { id, label } };
}

function doc(content: unknown[]): Record<string, unknown> {
  return { type: 'doc', content };
}

function paragraph(...content: unknown[]): Record<string, unknown> {
  return { type: 'paragraph', content };
}

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const carol = '33333333-3333-4333-8333-333333333333';
// The only id here whose casing can differ at all.
const dave = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('collectMentionIds', () => {
  it('finds mentions nested in lists and blockquotes, first-seen order', () => {
    const input = doc([
      paragraph({ type: 'text', text: 'cc ' }, mention(carol)),
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [paragraph(mention(alice))] }],
      },
      { type: 'blockquote', content: [paragraph(mention(bob))] },
    ]);
    expect(collectMentionIds(input)).toEqual([carol, alice, bob]);
  });

  it('dedupes repeats of the same person', () => {
    expect(collectMentionIds(doc([paragraph(mention(bob), mention(bob), mention(alice))]))).toEqual(
      [bob, alice]
    );
  });

  it('returns an empty list for documents with nothing to collect', () => {
    expect(collectMentionIds(null)).toEqual([]);
    expect(collectMentionIds(undefined)).toEqual([]);
    expect(collectMentionIds(doc([]))).toEqual([]);
    expect(collectMentionIds({ type: 'doc' })).toEqual([]);
    expect(collectMentionIds(doc([paragraph({ type: 'text', text: 'no one' })]))).toEqual([]);
  });

  it('ignores a mention whose id is not a string', () => {
    expect(collectMentionIds(doc([paragraph(mention(42), { type: 'mention' })]))).toEqual([]);
  });

  it('collapses spellings of one id that differ only in case', () => {
    expect(collectMentionIds(doc([paragraph(mention(dave.toUpperCase()), mention(dave))]))).toEqual(
      [dave]
    );
  });
});

describe('newMentionIds', () => {
  it('returns only the ids the previous document did not carry', () => {
    const previous = doc([paragraph(mention(alice))]);
    const next = doc([paragraph(mention(alice), mention(bob))]);
    expect(newMentionIds(previous, next)).toEqual([bob]);
  });

  it('returns nothing when the same document is saved again', () => {
    const same = doc([paragraph(mention(alice), mention(bob))]);
    expect(newMentionIds(same, same)).toEqual([]);
  });

  it('returns nothing when a mention is removed', () => {
    const previous = doc([paragraph(mention(alice), mention(bob))]);
    expect(newMentionIds(previous, doc([paragraph(mention(alice))]))).toEqual([]);
  });

  it('treats every mention as new when there was no previous document', () => {
    expect(newMentionIds(null, doc([paragraph(mention(alice), mention(bob))]))).toEqual([
      alice,
      bob,
    ]);
  });

  it('returns nothing when a re-save only changes the casing of an id', () => {
    const previous = doc([paragraph(mention(dave))]);
    expect(newMentionIds(previous, doc([paragraph(mention(dave.toUpperCase()))]))).toEqual([]);
  });

  // The cap is applied to resolved recipients, after the access filter, so ids
  // that can never be notified cannot starve one that can.
  it('returns every newly added id, uncapped', () => {
    const many = Array.from({ length: MAX_MENTION_RECIPIENTS + 15 }, (_, i) =>
      mention(`${i}`.padStart(8, '0') + '-0000-4000-8000-000000000000')
    );
    expect(newMentionIds(null, doc([paragraph(...many)]))).toHaveLength(many.length);
  });
});
