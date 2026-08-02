import { describe, it, expect } from 'vitest';
import {
  normalizeProjectAccent,
  toProjectResponse,
  type ProjectRow,
} from '../../src/services/projectListItem';

const PALETTE = ['rose', 'amber', 'lime', 'emerald', 'sky', 'violet', 'fuchsia', 'slate'];

function row(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'p1',
    name: 'Project',
    description: '',
    archived_at: null,
    created_at: new Date('2026-07-01T00:00:00.000Z'),
    created_by: 'u1',
    is_public: false,
    color: null,
    ...overrides,
  };
}

describe('normalizeProjectAccent', () => {
  it('keeps every key the palette declares', () => {
    for (const key of PALETTE) {
      expect(normalizeProjectAccent(key)).toBe(key);
    }
  });

  it('reads anything else as no colour, so a hand-edited or newer row cannot reach a client', () => {
    expect(normalizeProjectAccent('chartreuse')).toBeNull();
    expect(normalizeProjectAccent('Amber')).toBeNull();
    expect(normalizeProjectAccent('')).toBeNull();
    expect(normalizeProjectAccent(null)).toBeNull();
  });
});

describe('toProjectResponse', () => {
  it('serves the colour through the normalizer rather than the raw column', () => {
    expect(toProjectResponse(row({ color: 'violet' }), []).color).toBe('violet');
    expect(toProjectResponse(row({ color: 'chartreuse' }), []).color).toBeNull();
    expect(toProjectResponse(row(), []).color).toBeNull();
  });
});
