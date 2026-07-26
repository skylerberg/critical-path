import { describe, it, expect } from 'vitest';
import { toCandidates } from '../../src/completion/candidates';

describe('toCandidates', () => {
  it('completes a unique name by name, with its short id as the description', () => {
    expect(toCandidates([{ id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Backlog' }])).toEqual(
      [{ value: 'Backlog', description: 'aaaaaaaa' }]
    );
  });

  it('falls back to short ids when a name is shared', () => {
    expect(
      toCandidates([
        { id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Deploy' },
        { id: 'bbbbbbbb-2222-4222-8222-222222222222', name: 'Deploy' },
        { id: 'cccccccc-3333-4333-8333-333333333333', name: 'Ship it' },
      ])
    ).toEqual([
      { value: 'aaaaaaaa', description: 'Deploy' },
      { value: 'bbbbbbbb', description: 'Deploy' },
      { value: 'Ship it', description: 'cccccccc' },
    ]);
  });

  it('treats a case-only collision as a collision, like the resolver does', () => {
    expect(
      toCandidates([
        { id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Done' },
        { id: 'bbbbbbbb-2222-4222-8222-222222222222', name: 'done' },
      ])
    ).toEqual([
      { value: 'aaaaaaaa', description: 'Done' },
      { value: 'bbbbbbbb', description: 'done' },
    ]);
  });
});
