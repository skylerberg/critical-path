<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { link, router } from '../lib/router.svelte';
  import { SEARCH_MIN_QUERY_LENGTH, searchPath } from '../lib/search-query';
  import { search } from '../lib/search.svelte';
  import Button from '../components/ui/Button.svelte';
  import Spinner from '../components/ui/Spinner.svelte';

  interface Props {
    q: string;
  }

  let { q }: Props = $props();

  const SEARCH_DEBOUNCE_MS = 250;

  let typed = $state(untrack(() => q));
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // The URL is the source of truth, so a reload or a shared link replays the same
  // search; typing only rewrites it and this runs whatever it lands on.
  $effect(() => {
    void search.run(q);
  });

  // The page stays mounted across /search?q=… -> /search, so an arrival that did
  // not come from this box (the nav link, a popstate) has to refill it.
  $effect(() => {
    const incoming = q;
    untrack(() => {
      if (typed.trim() === incoming) {
        return;
      }
      cancelCommit();
      typed = incoming;
    });
  });

  function cancelCommit(): void {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
  }

  function commit(value: string): void {
    // Replaces rather than pushes, so a run of keystrokes collapses into one
    // history entry and Back leaves the page instead of walking the query.
    router.redirect(searchPath(value));
  }

  function scheduleCommit(value: string): void {
    cancelCommit();
    searchTimer = setTimeout(() => {
      searchTimer = null;
      commit(value);
    }, SEARCH_DEBOUNCE_MS);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      cancelCommit();
      commit(typed);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelCommit();
      typed = '';
      commit('');
    }
  }

  const focusOnMount = (node: HTMLInputElement): void => {
    node.focus();
  };

  onDestroy(cancelCommit);

  const tooShort = $derived(
    search.query.length > 0 && search.query.length < SEARCH_MIN_QUERY_LENGTH
  );
  const showSpinner = $derived(search.status === 'loading' && search.results.length === 0);
  const showResults = $derived(search.results.length > 0);
</script>

<main class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 lg:p-8">
  <h1 class="text-2xl font-semibold">Search</h1>

  <label class="relative flex items-center">
    <svg
      class="pointer-events-none absolute left-3 size-4 text-muted"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
    <input
      use:focusOnMount
      type="search"
      bind:value={typed}
      oninput={() => scheduleCommit(typed)}
      onkeydown={handleKeydown}
      aria-label="Search tasks"
      placeholder="Search every project — all words must match"
      class="min-h-11 w-full rounded-md border border-edge bg-surface pr-3 pl-9 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
    />
  </label>

  {#if search.status === 'error'}
    <div
      role="alert"
      class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger bg-surface p-3"
    >
      <p class="text-sm text-danger">{search.error}</p>
      <Button variant="secondary" onclick={() => void search.run(search.query)}>Try again</Button>
    </div>
  {/if}

  <div role="status" class="flex items-center gap-2 text-sm text-muted">
    {#if tooShort}
      <span>Keep typing — searches need at least {SEARCH_MIN_QUERY_LENGTH} characters.</span>
    {:else if search.status === 'idle'}
      <span>Type to search every project you can access.</span>
    {:else if search.status === 'loaded' && search.results.length === 0}
      <span>No tasks match “{search.query}”.</span>
    {:else if showResults}
      <span>
        {search.results.length}
        {search.results.length === 1 ? 'result' : 'results'}
      </span>
      {#if search.status === 'loading'}
        <Spinner size="sm" label="Searching" />
      {/if}
    {/if}
  </div>

  {#if showSpinner}
    <div class="flex justify-center py-16">
      <Spinner size="lg" />
    </div>
  {:else if showResults}
    <div use:link class="flex flex-col gap-6">
      {#each search.groups as group (group.projectId)}
        <section class="flex flex-col gap-1">
          <h2 class="text-base font-semibold">
            <a href="/projects/{group.projectId}" class="hover:text-accent">{group.projectName}</a>
          </h2>
          <ul class="flex flex-col rounded-lg border border-edge bg-surface">
            {#each group.results as result (result.task_id)}
              <li class="border-b border-edge last:border-b-0">
                <a
                  href="/projects/{result.project_id}/tasks/{result.task_id}"
                  class="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent-soft"
                >
                  <span class="text-ink">{result.title}</span>
                  <span class="text-xs text-muted">{result.column_name}</span>
                </a>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
      {#if search.truncated}
        <p class="text-sm text-muted">
          Showing the first {search.results.length} matches. Add another word to narrow it down.
        </p>
      {/if}
    </div>
  {/if}
</main>
