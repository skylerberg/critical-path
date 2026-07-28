import { describe, expect, it } from 'vitest';
import { canEditProject, roleFor, type ProjectRole } from './roles';

function project(overrides: {
  created_by?: string | null;
  member_ids?: string[];
  members?: { user_id: string; role: ProjectRole }[];
}) {
  return {
    created_by: null,
    member_ids: [],
    ...overrides,
  };
}

describe('roleFor', () => {
  it('makes the creator an editor without a member entry', () => {
    const item = project({ created_by: 'u-me', member_ids: [], members: [] });
    expect(roleFor(item, 'u-me')).toBe('editor');
    expect(canEditProject(item, 'u-me')).toBe(true);
  });

  it('reads the stored role of a member', () => {
    const item = project({
      created_by: 'u-owner',
      member_ids: ['u-me', 'u-other'],
      members: [
        { user_id: 'u-me', role: 'viewer' },
        { user_id: 'u-other', role: 'editor' },
      ],
    });
    expect(roleFor(item, 'u-me')).toBe('viewer');
    expect(canEditProject(item, 'u-me')).toBe(false);
    expect(roleFor(item, 'u-other')).toBe('editor');
    expect(canEditProject(item, 'u-other')).toBe(true);
  });

  it('treats an unrecognised role as a viewer', () => {
    const item = project({
      created_by: 'u-owner',
      member_ids: ['u-me'],
      members: [{ user_id: 'u-me', role: 'admin' as ProjectRole }],
    });
    expect(roleFor(item, 'u-me')).toBe('viewer');
  });

  it('is null for a non-member and for an unknown user', () => {
    const item = project({
      created_by: 'u-owner',
      member_ids: ['u-other'],
      members: [{ user_id: 'u-other', role: 'editor' }],
    });
    expect(roleFor(item, 'u-me')).toBeNull();
    expect(roleFor(item, undefined)).toBeNull();
    expect(canEditProject(item, undefined)).toBe(false);
  });

  it('falls back to editor for a member a payload without roles lists', () => {
    const withoutMembers = project({ created_by: 'u-owner', member_ids: ['u-me'] });
    expect(roleFor(withoutMembers, 'u-me')).toBe('editor');
    expect(canEditProject(withoutMembers, 'u-me')).toBe(true);

    const emptyMembers = project({
      created_by: 'u-owner',
      member_ids: ['u-me'],
      members: [],
    });
    expect(roleFor(emptyMembers, 'u-me')).toBe('editor');
  });
});
