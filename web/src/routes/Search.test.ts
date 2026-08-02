import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import Search from './Search.svelte';
import { router } from '../lib/router.svelte';
import { search } from '../lib/search.svelte';
import { searchPath, type SearchResult } from '../lib/search-query';
import { shortcuts } from '../lib/shortcuts.svelte';
import { TASK_TITLE_MAX_LENGTH, truncateTitle } from '../lib/titles';

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

// The shell reads q off the live route, so the page sees every URL rewrite it
// makes; a plain string prop would freeze the page at its initial query.
function renderAt(q: string): void {
  router.navigate(searchPath(q), { replace: true });
  render(Search, {
    props: {
      get q(): string {
        const route = router.current;
        return route.name === 'search' ? route.params.q : '';
      },
    },
  });
}

function box(): HTMLElement {
  return screen.getByRole('searchbox', { name: 'Search tasks' });
}

async function type(value: string): Promise<void> {
  await fireEvent.input(box(), { target: { value } });
  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
  await tick();
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  search.reset();
  shortcuts.reset();
  router.beforeNavigate = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Search page', () => {
  it('focuses the box and shows the idle hint before anything is typed', () => {
    respondWith([]);
    renderAt('');

    expect(box()).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Type to search every project');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('debounces typing into one request carrying q and puts the query in the URL', async () => {
    respondWith([]);
    renderAt('');

    await fireEvent.input(box(), { target: { value: 's' } });
    await fireEvent.input(box(), { target: { value: 'sh' } });
    await fireEvent.input(box(), { target: { value: 'shi' } });
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(requestAt(0).url).searchParams.get('q')).toBe('shi');
    expect(router.path).toBe('/search?q=shi');
  });

  it('searches on a single character', async () => {
    respondWith([]);
    renderAt('');

    await type('s');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(new URL(requestAt(0).url).searchParams.get('q')).toBe('s');
  });

  it('commits on Enter without waiting out the debounce', async () => {
    respondWith([]);
    renderAt('');

    await fireEvent.input(box(), { target: { value: 'export' } });
    await fireEvent.keyDown(box(), { key: 'Enter' });
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(router.path).toBe('/search?q=export');

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not re-run the search when a commit lands on the URL already shown', async () => {
    respondWith([]);
    renderAt('');
    await type('export');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await fireEvent.keyDown(box(), { key: 'Enter' });
    await tick();
    await type('export ');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(router.path).toBe('/search?q=export');
  });

  it('empties the box and the results on Escape', async () => {
    respondWith([result('t-1', 'p-1', 'Colori', 'Ship the export API')]);
    renderAt('');
    await type('export');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Ship the export API/ })).toBeInTheDocument();
    });

    await fireEvent.keyDown(box(), { key: 'Escape' });
    await tick();

    expect(box()).toHaveValue('');
    expect(router.path).toBe('/search');
    expect(screen.queryByRole('link', { name: /Ship the export API/ })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Type to search every project');
  });

  it('follows a query that changes outside the box and abandons the pending one', async () => {
    respondWith([]);
    renderAt('export');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await fireEvent.input(box(), { target: { value: 'export api' } });
    router.navigate('/search');
    await tick();

    expect(box()).toHaveValue('');

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(router.path).toBe('/search');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refocuses the box when the search shortcut fires on this page', async () => {
    respondWith([]);
    renderAt('export');
    (box() as HTMLInputElement).blur();

    shortcuts.searchFocusRequested = true;
    await tick();

    expect(box()).toHaveFocus();
    expect(shortcuts.searchFocusRequested).toBe(false);
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

  it('clips a long result title to the display limit', async () => {
    const long = 'S'.repeat(TASK_TITLE_MAX_LENGTH);
    respondWith([result('t-1', 'p-1', 'Colori', long)]);
    renderAt('');

    await type('export');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Colori' })).toBeInTheDocument();
    });
    expect(screen.getByText(truncateTitle(long))).toBeInTheDocument();
    expect(screen.queryByText(long)).toBeNull();
  });

  it('runs the query already in the URL on arrival', async () => {
    respondWith([result('t-1', 'p-1', 'Colori', 'Ship the export API')]);
    renderAt('export');

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Ship the export API/ })).toBeInTheDocument();
    });
    expect(new URL(requestAt(0).url).searchParams.get('q')).toBe('export');
    expect(box()).toHaveValue('export');
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

  it('leaves no rows, count or cap notice behind when a query fails', async () => {
    respondWith([result('t-1', 'p-1', 'Colori', 'Ship the export API')], true);
    renderAt('');
    await type('export');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Ship the export API/ })).toBeInTheDocument();
    });

    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'Boom' }));
    await type('export api');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    });
    expect(screen.queryByRole('link', { name: /Ship the export API/ })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/Add another word to narrow it down/)).toBeNull();
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
