import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import LabelManager from './LabelManager.svelte';
import { board } from '../lib/board.svelte';
import { connectivity } from '../lib/connectivity.svelte';
import { outbox } from '../lib/outbox.svelte';
import { toasts } from '../lib/toasts.svelte';
import type { BoardPayload } from '../lib/board-types';

const PROJECT_ID = 'p1';

function payload(): BoardPayload {
  return {
    project: {
      id: PROJECT_ID,
      name: 'Game',
      description: '',
      archived_at: null,
      created_by: null,
      member_ids: [],
      members: [],
      is_public: false,
      color: null,
      created_at: '2026-01-01T00:00:00Z',
    },
    columns: [{ id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false }],
    tasks: [],
    labels: [{ id: 'l1', name: 'art', color: '#ff0000' }],
    changed_task_ids: [],
  };
}

// Answers the board read every failure path takes, so a test asserting the write
// is not also asserting what the resync after it did.
function mockRoutes(override?: (request: Request, url: URL) => Response | undefined): void {
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const url = new URL(request.url);
    return (
      override?.(request, url) ??
      (request.method === 'GET' && url.pathname === `/api/projects/${PROJECT_ID}`
        ? jsonResponse(200, payload())
        : jsonResponse(200, {}))
    );
  });
}

function open(): void {
  render(LabelManager, { props: { open: true, onclose: vi.fn() } });
}

async function submitNewLabel(fields: { name?: string; color?: string }): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: 'New label' }));
  if (fields.name !== undefined) {
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: fields.name } });
  }
  if (fields.color !== undefined) {
    await fireEvent.input(screen.getByLabelText('Custom color'), {
      target: { value: fields.color },
    });
  }
  await fireEvent.submit(screen.getByRole('form', { name: 'New label' }));
}

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  outbox.reset();
  connectivity.resetForTests();
  for (const toast of [...toasts.toasts]) {
    toasts.dismiss(toast.id);
  }
  board.currentProjectId = PROJECT_ID;
  board.labels = [{ id: 'l1', name: 'art', color: '#ff0000' }];
  mockRoutes();
});

describe('LabelManager', () => {
  it('lists the labels the board holds', () => {
    open();

    expect(screen.getByText('art')).toBeInTheDocument();
  });

  it('creates a label and closes the form', async () => {
    open();
    await submitNewLabel({ name: 'design' });

    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'New label' })).toBeNull();
    });
    expect(board.labels.map((label) => label.name)).toEqual(['art', 'design']);
    const request = requestAt(0);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/labels');
    expect(await request.json()).toMatchObject({ project_id: PROJECT_ID, name: 'design' });
  });

  // Both branches refuse before the request rather than after it: a name the
  // server would reject and a colour it would store as written.
  it('refuses a blank name without asking the server', async () => {
    open();
    await submitNewLabel({ name: '   ' });

    expect(screen.getByRole('alert')).toHaveTextContent('Name is required');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(board.labels).toHaveLength(1);
  });

  it('refuses a colour that is not a hex value without asking the server', async () => {
    open();
    await submitNewLabel({ name: 'design', color: 'red' });

    expect(screen.getByRole('alert')).toHaveTextContent('Color must be a hex value like #4f46e5');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(board.labels).toHaveLength(1);
  });

  it('names the label that already exists when the server refuses the create', async () => {
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/labels'
        ? jsonResponse(409, { error: 'Label name already in use' })
        : undefined
    );

    open();
    await submitNewLabel({ name: 'art' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A label named "art" already exists in this project'
    );
    // Left open with the name still in it: the user has to change it to get out.
    expect(screen.getByRole('form', { name: 'New label' })).toBeInTheDocument();
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('art');
  });

  it('prefills the form from the label being edited and PATCHes it', async () => {
    open();
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('art');
    expect(screen.getByLabelText<HTMLInputElement>('Custom color').value).toBe('#ff0000');

    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'artwork' } });
    await fireEvent.submit(screen.getByRole('form', { name: 'Edit label' }));

    const request = requestAt(0);
    expect(request.method).toBe('PATCH');
    expect(new URL(request.url).pathname).toBe('/api/labels/l1');
    expect(await request.json()).toEqual({ name: 'artwork', color: '#ff0000' });
    expect(board.labels[0]?.name).toBe('artwork');
  });

  it('deletes the label the row belongs to', async () => {
    board.labels = [
      { id: 'l1', name: 'art', color: '#ff0000' },
      { id: 'l2', name: 'code', color: '#00ff00' },
    ];

    open();
    await fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]!);

    const request = requestAt(0);
    expect(request.method).toBe('DELETE');
    expect(new URL(request.url).pathname).toBe('/api/labels/l2');
    expect(board.labels.map((label) => label.id)).toEqual(['l1']);
  });
});
