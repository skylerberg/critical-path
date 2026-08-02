import '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { board } from './board.svelte';
import type { BoardProject } from './board-types';
import {
  currentProjectMentionCandidates,
  filterMentionCandidates,
  mentionLabel,
  projectMentionCandidates,
} from './mentions';
import { projects, type Project } from './projects.svelte';
import { users, type User } from './users.svelte';

const ada: User = { id: 'u-ada', name: 'Ada Lovelace', avatar_url: null };
const brin: User = { id: 'u-brin', name: 'Sergey Brin', avatar_url: null };
const zed: User = { id: 'u-zed', name: 'Zed', avatar_url: null };

function boardProject(memberIds: string[]): BoardProject {
  return {
    id: 'p1',
    name: 'Project',
    description: '',
    created_by: ada.id,
    member_ids: memberIds,
    members: memberIds.map((user_id) => ({ user_id, role: 'editor' as const })),
    is_public: false,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
  };
}

function listedProject(memberIds: string[]): Project {
  return {
    ...boardProject(memberIds),
    open_task_count: 0,
    done_task_count: 0,
    position: null,
  };
}

beforeEach(() => {
  board.reset();
  projects.reset();
  users.reset();
});

describe('projectMentionCandidates', () => {
  it('keeps the creator and the members and drops a stale assignee', () => {
    expect(projectMentionCandidates(listedProject([brin.id]), [ada, brin, zed])).toEqual([
      ada,
      brin,
    ]);
  });

  it('returns nothing for a project it does not have', () => {
    expect(projectMentionCandidates(null, [ada, brin])).toEqual([]);
    expect(projectMentionCandidates(undefined, [ada, brin])).toEqual([]);
  });
});

describe('filterMentionCandidates', () => {
  it('matches names case-insensitively and never an address', () => {
    expect(filterMentionCandidates([ada, brin, zed], 'AD')).toEqual([ada]);
    expect(filterMentionCandidates([ada, brin, zed], 'BRIN')).toEqual([brin]);
    expect(filterMentionCandidates([ada, brin, zed], 'ada@example.com')).toEqual([]);
    expect(filterMentionCandidates([ada, brin, zed], 'nobody')).toEqual([]);
  });

  it('returns everyone for an empty query, up to the limit', () => {
    expect(filterMentionCandidates([ada, brin, zed], '')).toEqual([ada, brin, zed]);
    expect(filterMentionCandidates([ada, brin, zed], '', 2)).toEqual([ada, brin]);
  });
});

describe('mentionLabel', () => {
  it('prefers the live name and falls back to the stored label', () => {
    users.upsert({ ...ada, name: 'Ada Byron' });

    expect(mentionLabel({ id: ada.id, label: 'Ada Lovelace' })).toBe('Ada Byron');
    expect(mentionLabel({ id: 'u-gone', label: 'Someone Else' })).toBe('Someone Else');
    expect(mentionLabel({ id: 'u-gone' })).toBe('');
    expect(mentionLabel({})).toBe('');
  });
});

describe('currentProjectMentionCandidates', () => {
  it('returns nothing when no project is open', () => {
    expect(currentProjectMentionCandidates()).toEqual([]);
  });

  it('reads membership from the projects store, not the board payload', () => {
    board.currentProjectId = 'p1';
    board.project = boardProject([]);
    projects.projects = [listedProject([brin.id])];
    users.setForProject('p1', [ada, brin, zed]);

    expect(currentProjectMentionCandidates()).toEqual([ada, brin]);
  });

  it('falls back to the board payload before the projects list resolves', () => {
    board.currentProjectId = 'p1';
    board.project = boardProject([brin.id]);
    users.setForProject('p1', [ada, brin, zed]);

    expect(currentProjectMentionCandidates()).toEqual([ada, brin]);
  });
});
