import { describe, expect, it } from 'vitest';
import { baseOf, CardWriteSessions, type CardWriteSession } from './card-write-session';

function session(overrides: Partial<CardWriteSession> = {}): CardWriteSession {
  return { ...new CardWriteSessions().for('t1'), ...overrides };
}

describe('CardWriteSessions', () => {
  it('hands back the same session for a task, so a baseline survives leaving the card', () => {
    const sessions = new CardWriteSessions();
    const first = sessions.for('t1');
    first.baseUpdatedAt = '2026-01-02T00:00:00Z';

    expect(sessions.for('t1')).toBe(first);
    expect(sessions.for('t1').baseUpdatedAt).toBe('2026-01-02T00:00:00Z');
  });

  it('keeps one card’s baseline out of another’s', () => {
    const sessions = new CardWriteSessions();
    sessions.for('t1').baseUpdatedAt = '2026-01-02T00:00:00Z';

    expect(sessions.for('t2')).not.toBe(sessions.for('t1'));
    expect(sessions.for('t2').baseUpdatedAt).toBeNull();
  });

  it('starts a session unloaded, so nothing sends a precondition it never read', () => {
    expect(new CardWriteSessions().for('t1')).toEqual({
      id: 't1',
      baseUpdatedAt: null,
      baseTitle: null,
      baseDescription: null,
      removing: false,
    });
  });
});

describe('baseOf', () => {
  it('reads the version the fields were populated from', () => {
    const doc = { type: 'doc' as const, content: [] };

    expect(baseOf(session({ baseTitle: 'Design cards', baseDescription: doc }))).toEqual({
      title: 'Design cards',
      description: doc,
    });
  });

  it('reads an unloaded title as empty and a cleared description as null', () => {
    expect(baseOf(session())).toEqual({ title: '', description: null });
  });
});
