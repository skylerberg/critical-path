import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Search from './Search.svelte';
import { router } from '../lib/router.svelte';
import { search } from '../lib/search.svelte';
import type { SearchResult } from '../lib/search-query';

const DEBOUNCE_MS = 250;

function result(taskId: string, projectId: string, projectName: string, title: string) {
  return {
    task_id: taskId,
    title,
    project_id: projectId,
    project_name: projectName,
    column_name: 'In Progress',
  };
}

function respondWith(results: SearchResult[], truncated = false): void {
  fetchMock.mockImplementation(async () => jsonResponse(200, { results, truncated }));
}

let rerenderPage: ((props: { q: string }) => Promise<void>) | null = null;

// The query lives in the URL, so the page only ever rewrites it; feeding the new
// q back in is what the app shell does, and the tests have to stand in for it.
async function syncFromUrl(): Promise<void> {
  const route = router.current;
  await rerenderPage?.({ q: route.name === 'search' ? route.params.q : '' });
}

function renderAt(q: string): void {
  router.navigate(q === '' ? '/search' : `/search?q=${encodeURIComponent(q)}`, { replace: true });
  const { rerender } = render(Search, { props: { q } });
  rerenderPage = rerender;
}

async function type(value: string): Promise<void> {
  const input = screen.getByRole('searchbox', { name: 'Search tasks' });
  await fireEvent.input(input, { target: { value } });
  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
  await syncFromUrl();
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  search.reset();
  router.beforeNavigate = undefined;
  rerenderPage = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Search page', () => {
  it('focuses the box and shows the idle hint before anything is typed', () => {
    respondWith([]);
    renderAt('');

    const input = screen.getByRole('searchbox', { name: 'Search tasks' });
    expect(input).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Type to search every project');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('debounces typing into one request carrying q and puts the query in the URL', async () => {
    respondWith([]);
    renderAt('');

    const input = screen.getByRole('searchbox', { name: 'Search tasks' });
    await fireEvent.input(input, { target: { value: 's' } });
    await fireEvent.input(input, { target: { value: 'sh' } });
    await fireEvent.input(input, { target: { value: 'shi' } });
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await syncFromUrl();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(requestAt(0).url).searchParams.get('q')).toBe('shi');
    expect(router.path).toBe('/search?q=shi');
  });

  it('asks for at least two characters instead of firing a doomed request', async () => {
    respondWith([]);
    renderAt('');

    await type('s');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('at least 2 characters');
  });

  it('renders results grouped by project with deep links into the board', async () => {
    respondWith([
      result('t-1', 'p-1', 'Colori', 'Ship the export API'),
      result('t-2', 'p-2', 'Atlas', 'Export docs'),
      result('t-3', 'p-1', 'Colori', 'Export retry'),
    ]);
    renderAt('');

    await type('export');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Colori' })).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Atlas' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ship the export API/ })).toHaveAttribute(
      'href',
      '/projects/p-1/tasks/t-1'
    );
    expect(screen.getByRole('link', { name: /Export docs/ })).toHaveAttribute(
      'href',
      '/projects/p-2/tasks/t-2'
    );
    expect(screen.getByRole('heading', { name: 'Colori' }).querySelector('a')).toHaveAttribute(
      'href',
      '/projects/p-1'
    );
    expect(screen.getByRole('status')).toHaveTextContent('3 results');
  });

  it('runs the query already in the URL on arrival', async () => {
    respondWith([result('t-1', 'p-1', 'Colori', 'Ship the export API')]);
    renderAt('export');

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Ship the export API/ })).toBeInTheDocument();
    });
    expect(new URL(requestAt(0).url).searchParams.get('q')).toBe('export');
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('export');
  });

  it('names the query in the empty state, including a punctuation-only one', async () => {
    respondWith([]);
    renderAt('');

    await type('zzzz');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('No tasks match “zzzz”.');
    });

    await type('!!!');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('No tasks match “!!!”.');
    });
  });

  it('keeps the previous rows on screen while the next query loads', async () => {
    respondWith([result('t-1', 'p-1', 'Colori', 'Ship the export API')]);
    renderAt('');
    await type('export');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Ship the export API/ })).toBeInTheDocument();
    });

    let open!: () => void;
    const wait = new Promise<void>((resolve) => (open = resolve));
    fetchMock.mockImplementation(async () => {
      await wait;
      return jsonResponse(200, { results: [], truncated: false });
    });

    await type('export api');

    expect(screen.getByRole('link', { name: /Ship the export API/ })).toBeInTheDocument();
    open();
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /Ship the export API/ })).toBeNull();
    });
  });

  it('renders the failure and retries it', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'Boom' }));
    renderAt('');

    await type('export');
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    });

    respondWith([result('t-1', 'p-1', 'Colori', 'Ship the export API')]);
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Ship the export API/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns when the result set was capped', async () => {
    respondWith([result('t-1', 'p-1', 'Colori', 'Ship the export API')], true);
    renderAt('');

    await type('export');

    await waitFor(() => {
      expect(screen.getByText(/Add another word to narrow it down/)).toBeInTheDocument();
    });
  });
});
