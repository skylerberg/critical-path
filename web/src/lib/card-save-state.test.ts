import { describe, expect, it } from 'vitest';
import { cardSaveMessage, cardSaveState, type CardSaveInputs } from './card-save-state';

const settled: CardSaveInputs = {
  failed: false,
  queued: false,
  draining: false,
  saving: false,
  dirty: false,
};

describe('cardSaveState', () => {
  it('reports a card with nothing outstanding as saved', () => {
    expect(cardSaveState(settled)).toBe('saved');
  });

  it('reports a description save in flight as saving', () => {
    expect(cardSaveState({ ...settled, saving: true })).toBe('saving');
  });

  it('reports a title still in the field as unsent, not as saving', () => {
    // It commits on blur, so nothing is on its way anywhere yet. Naming it
    // "Saving…" would promise a request that does not exist.
    expect(cardSaveState({ ...settled, dirty: true })).toBe('unsent');
  });

  it('reports queued work that is going out as saving', () => {
    expect(cardSaveState({ ...settled, queued: true, draining: true })).toBe('saving');
  });

  it('reports queued work that is not going out as unsent', () => {
    expect(cardSaveState({ ...settled, queued: true })).toBe('unsent');
  });

  it('never calls a card saved while work for it is queued', () => {
    // The claim this indicator most has to avoid: a description save that
    // reported success into the queue is stored on this device and nowhere else.
    expect(cardSaveState({ ...settled, queued: true, saving: false })).not.toBe('saved');
  });

  it('reports a failure over anything else outstanding', () => {
    expect(cardSaveState({ ...settled, failed: true, queued: true, draining: true })).toBe('error');
    expect(cardSaveState({ ...settled, failed: true, saving: true })).toBe('error');
  });
});

describe('cardSaveMessage', () => {
  it('says something for every state', () => {
    const states = ['saved', 'saving', 'unsent', 'error'] as const;
    for (const state of states) {
      expect(cardSaveMessage(state)).not.toBe('');
    }
  });

  it('does not say saved for anything that is not', () => {
    expect(cardSaveMessage('saved')).toBe('Saved');
    for (const state of ['saving', 'unsent', 'error'] as const) {
      expect(cardSaveMessage(state).toLowerCase()).not.toMatch(/^saved/);
    }
  });

  it('distinguishes waiting from failed in words, not only in colour', () => {
    expect(cardSaveMessage('unsent')).not.toBe(cardSaveMessage('error'));
  });
});
