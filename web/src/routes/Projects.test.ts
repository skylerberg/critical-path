import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Projects from './Projects.svelte';
import { projects, type Project } from '../lib/projects.svelte';

// jsdom does not implement <dialog> show/close methods.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
};

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    name: 'Alpha',
    description: '',
    is_template: false,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    open_task_count: 0,
    done_task_count: 0,
    ...overrides,
  };
}

const activeProject = project({
  id: 'p-active',
  name: 'Alpha',
  description: 'A deck-building game',
  open_task_count: 5,
  done_task_count: 3,
});
const templateProject = project({
  id: 'p-template',
  name: 'Starter kit',
  is_template: true,
  created_at: '2026-01-02T00:00:00.000Z',
});
const archivedProject = project({
  id: 'p-archived',
  name: 'Old prototype',
  archived_at: '2026-02-01T00:00:00.000Z',
  created_at: '2026-01-03T00:00:00.000Z',
});

beforeEach(() => {
  fetchMock.mockReset();
  projects.reset();
});

describe('Projects', () => {
  it('renders cards with counts, a templates section, and a collapsed archived section', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { projects: [activeProject, templateProject, archivedProject] })
    );
    render(Projects);

    expect(await screen.findByRole('link', { name: 'Alpha' })).toHaveAttribute(
      'href',
      '/projects/p-active'
    );
    expect(screen.getByText('A deck-building game')).toBeInTheDocument();
    expect(screen.getByText('5 open')).toBeInTheDocument();
    expect(screen.getByText('3 done')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Starter kit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use template' })).toBeInTheDocument();

    expect(screen.queryByRole('link', { name: 'Old prototype' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Archived (1)' }));
    expect(screen.getByRole('link', { name: 'Old prototype' })).toBeInTheDocument();
  });

  it('shows empty states and opens the new project modal', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [] }));
    render(Projects);

    expect(await screen.findByText('No projects yet.')).toBeInTheDocument();
    expect(screen.getByText(/No templates yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'New project' }));

    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create project' })).toBeInTheDocument();
  });

  it('prefills the name when using a template', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [templateProject] }));
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Use template' }));

    expect(screen.getByLabelText('Name')).toHaveValue('Starter kit copy');
  });

  it('opens the delete confirmation from the card menu', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [activeProject] }));
    render(Projects);

    await fireEvent.click(await screen.findByRole('button', { name: 'Options for Alpha' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(screen.getByText(/This permanently removes the project/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeInTheDocument();
  });
});
