<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { cardCursor } from '../lib/card-cursor.svelte';
  import { link, router } from '../lib/router.svelte';
  import { SEARCH_DEBOUNCE_MS, SEARCH_MAX_QUERY_LENGTH, searchPath } from '../lib/search-query';
  import { projectHref, taskHref } from '../lib/short-links';
  import { search } from '../lib/search.svelte';
  import { shortcuts } from '../lib/shortcuts.svelte';
  import { truncateTitle } from '../lib/titles';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import Spinner from '../components/ui/Spinner.svelte';

  interface Props {
    q: string;
  }

  let { q }: Props = $props();

  let typed = $state(untrack(() => q));
  let inputElement = $state<HTMLInputElement | null>(null);
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

  $effect(() => {
    if (!shortcuts.searchFocusRequested) {
      return;
    }
    untrack(() => {
      shortcuts.searchFocusRequested = false;
      inputElement?.focus();
      inputElement?.select();
    });
  });

  function cancelCommit(): void {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
  }

  function commit(value: string): void {
    const next = searchPath(value);
    // Replaces rather than pushes, so a run of keystrokes collapses into one
    // history entry and Back leaves the page instead of walking the query. A
    // no-op redirect is skipped because the router hands the page a fresh route
    // object either way, which would re-issue the identical search.
    if (next !== router.path) {
      router.redirect(next);
    }
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

  onDestroy(cancelCommit);

  // Group order, not server order: j and k have to walk the page the way it reads.
  $effect(() => {
    cardCursor.setRows(
      search.groups.flatMap((group) => group.results.map((result) => result.task_id))
    );
  });
  onDestroy(() => cardCursor.clear());

  const showResults = $derived(search.results.length > 0);
  const showSpinner = $derived(search.status === 'loading' && !showResults);
  const statusText = $derived.by(() => {
    const length = search.query.length;
    if (length > SEARCH_MAX_QUERY_LENGTH) {
      return `That is too long — searches take at most ${SEARCH_MAX_QUERY_LENGTH} characters.`;
    }
    if (search.status === 'idle') {
      return 'Type to search every project you can access.';
    }
    if (search.status === 'loaded' && !showResults) {
      return `No tasks match “${search.query}”.`;
    }
    if (showResults) {
      return `${search.results.length} ${search.results.length === 1 ? 'result' : 'results'}`;
    }
    return null;
  });
</script>

<main class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 lg:p-8">
  <h1 class="text-2xl font-semibold">Search</h1>

  <div class="relative">
    <svg
      class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
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
    <Input
      type="search"
      autofocus
      bind:value={typed}
      bind:element={inputElement}
      oninput={() => scheduleCommit(typed)}
      onkeydown={handleKeydown}
      aria-label="Search tasks"
      maxlength={SEARCH_MAX_QUERY_LENGTH}
      placeholder="Search every project — all words must match"
      class="w-full pl-9"
    />
  </div>

  {#if search.status === 'error'}
    <div
      role="alert"
      class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger bg-surface p-3"
    >
      <p class="text-sm text-danger">{search.error}</p>
      <Button variant="secondary" onclick={() => void search.run(search.query)}>Try again</Button>
    </div>
  {/if}

  {#if statusText !== null}
    <div role="status" class="flex items-center gap-2 text-sm text-muted">
      <span>{statusText}</span>
      {#if search.status === 'loading'}
        <!-- Hidden from assistive tech: a live region nested in this one would
             announce twice and make the region ambiguous to queries. -->
        <span aria-hidden="true"><Spinner size="sm" /></span>
      {/if}
    </div>
  {/if}

  {#if showSpinner}
    <div class="flex justify-center py-16">
      <Spinner size="lg" />
    </div>
  {:else if showResults}
    <div use:link class="flex flex-col gap-6">
      {#each search.groups as group (group.projectId)}
        <section class="flex flex-col gap-1">
          <h2 class="text-base font-semibold">
            <a href={projectHref(group.projectId, group.projectName)} class="hover:text-accent"
              >{group.projectName}</a
            >
          </h2>
          <ul class="flex flex-col rounded-lg border border-edge bg-surface">
            {#each group.results as result (result.task_id)}
              <li class="border-b border-edge last:border-b-0">
                <a
                  href={taskHref(result.task_id, result.title)}
                  data-card-row={result.task_id}
                  onfocus={() => cardCursor.set(result.task_id)}
                  onpointerenter={() => cardCursor.set(result.task_id)}
                  class="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent-soft {cardCursor.taskId ===
                  result.task_id
                    ? 'bg-accent-soft ring-2 ring-accent'
                    : ''}"
                >
                  <span class="text-ink">{truncateTitle(result.title)}</span>
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
