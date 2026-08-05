import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ProjectColorDialog from './ProjectColorDialog.svelte';
import { ACCENT_KEYS } from '../lib/accents';
import { projects, type Project } from '../lib/projects.svelte';
import { testUuid } from '../lib/test-ids';

const PROJECT_ID = testUuid('p-1');

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    name: 'Alpha',
    description: '',
    archived_at: null,
    created_by: null,
    member_ids: [],
    members: [],
    is_public: false,
    color: null,
    created_at: '2026-01-01T00:00:00.000Z',
    open_task_count: 0,
    done_task_count: 0,
    position: null,
    sort_key: null,
    last_seen_at: null,
    has_unseen_changes: false,
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  projects.reset();
});

describe('ProjectColorDialog', () => {
  it('offers every palette entry plus None, and marks the current one', () => {
    projects.projects = [project({ color: 'sky' })];
    render(ProjectColorDialog, { projectId: PROJECT_ID, current: 'sky', onclose: () => {} });

    const swatches = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));
    expect(swatches).toHaveLength(ACCENT_KEYS.length + 1);
    expect(screen.getByRole('button', { name: 'Sky' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'None' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clears the colour to None', async () => {
    projects.projects = [project({ color: 'sky' })];
    fetchMock.mockResolvedValue(jsonResponse(200, project({ color: null })));
    const onclose = vi.fn();
    render(ProjectColorDialog, { projectId: PROJECT_ID, current: 'sky', onclose });

    await fireEvent.click(screen.getByRole('button', { name: 'None' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(await (fetchMock.mock.calls[0][0] as Request).clone().json()).toEqual({ color: null });
    expect(projects.projects[0]!.color).toBeNull();
    expect(onclose).toHaveBeenCalled();
  });

  it('closes without a request when the current colour is picked again', async () => {
    projects.projects = [project({ color: 'sky' })];
    const onclose = vi.fn();
    render(ProjectColorDialog, { projectId: PROJECT_ID, current: 'sky', onclose });

    await fireEvent.click(screen.getByRole('button', { name: 'Sky' }));

    expect(onclose).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
