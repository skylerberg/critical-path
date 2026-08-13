import { SvelteSet } from 'svelte/reactivity';
import { api, ApiError, assertOk } from '../api/client';
import { apiMessage } from './apiMessages';
import type { components } from '../api/api.generated';
import { BoardAttachments } from './board-attachments.svelte';
import { BoardChecklists } from './board-checklists.svelte';
import { BoardComments, chronological } from './board-comments.svelte';
import { filtersToSearch, mergeFilterSearch, noFilters, type BoardFilters } from './board-filters';
import type { BoardPort } from './board-port';
import { optimisticTask } from './board-task';
import type {
  ArchivedTask,
  BoardColumn,
  BoardLabel,
  BoardProject,
  BoardTask,
  ChecklistItem,
  CommentBody,
  CycleTask,
  PublicBoardPayload,
  TaskAttachment,
  TaskComment,
} from './board-types';
import { patchById, removeById, upsertById } from './collections';
import { type ColumnSort, sortTasks } from './column-sort';
import { connectivity } from './connectivity.svelte';
import { mergeVersion, type TaskVersion } from './conflictDrafts.svelte';
import { buildGraph, cycleNodeIds, cyclePathIds } from './graph';
import { newId } from './ids';
import { readBoardSnapshot, saveBoardSnapshot } from './offline-cache';
import type { SerializedRequest } from './outbox-ops';
import { outbox, type SubmitInput, type SubmitResult } from './outbox.svelte';
import type { RealtimeEvent } from './realtime-types';
import {
  append,
  appendRun,
  byRank,
  neighborsAfterDrop,
  placeAtIndex,
  placeBetweenNeighbors,
  restack,
  type Neighbors,
  type Placement,
  type Ranked,
} from './ranks';
import { canEditProject } from './roles';
import { router, splitPath } from './router.svelte';
import { projects } from './projects.svelte';
import { session } from './session.svelte';
import { crossProjectDeps } from './crossProjectDeps.svelte';
import { taskActivity } from './taskActivity.svelte';
import { truncateTitle } from './titles';
import { toasts } from './toasts.svelte';
import { users, type User } from './users.svelte';

// Declared in board-types.ts because the sub-stores need them and this module
// imports the sub-stores. Re-exported here, which is where every consumer already
// reads them from.
export type { CommentBody, TaskAttachment, TaskComment };

// What an open card knows about the series that created it: the rule as English
// plus the two fields its recurrence menu is built from. Taken from the API
// rather than restated here, so a field the card stops being sent is a compile
// error instead of a silently undefined dropdown.
export type TaskSeriesRef = components['schemas']['TaskSeriesRef'];

type BulkRelationsResponse = components['schemas']['BulkTaskRelationsResponse'];
type BulkTasksResponse = components['schemas']['TasksBatchResponse'];
type DuplicatedColumnResponse = components['schemas']['DuplicatedColumnResponse'];
type MovedTasksResponse = components['schemas']['MovedTasksResponse'];
type BulkMovedTasksResponse = components['schemas']['BulkMovedTasksResponse'];
type ArchivedTasksResponse = components['schemas']['ArchivedTasksResponse'];
type BulkArchivedTasksResponse = components['schemas']['BulkArchivedTasksResponse'];

// The board's own shape for a card that is no longer archived. Only needed
// while a restore is queued, when there is no server row to adopt yet.
function unarchive(task: ArchivedTask | undefined): BoardTask | undefined {
  if (task === undefined) {
    return undefined;
  }
  const { archived_at, ...row } = task;
  void archived_at;
  return row;
}

export type TaskUpdateOutcome =
  | { status: 'ok'; updated_at: string }
  // Held for a network that isn't there. The text is safe and the editor should
  // settle exactly as it does on success — it is just not saved yet, which the
  // sync indicator is responsible for saying.
  | { status: 'queued' }
  | { status: 'conflict' }
  | { status: 'error' };

// Anchors on the visual neighbor above the drop, so it stays correct when the
// display order is a filtered partition rather than pure rank order. Both this
// and the neighbors a queued move remembers come from `neighborsAfterDrop`, so
// what gets sent now and what gets replayed later cannot describe different drops.
export function placementAfterDrop(items: readonly Ranked[], movedId: string): Placement {
  const others = items.filter((item) => item.id !== movedId);
  return placeBetweenNeighbors(others, neighborsAfterDrop(items, movedId)).placement;
}

const CYCLE_PATH_MS = 5000;
const MAX_CYCLE_TITLES = 6;
const MAX_CYCLE_TITLE_CHARS = 40;
// Mirrors the batch endpoint's own limit, so an oversized paste is refused
// before any card is drawn.
const MAX_BATCH_TASKS = 100;
// One identity for every empty column, so a reader deriving from an empty
// column's tasks doesn't see a fresh array on every read.
const NO_TASKS: BoardTask[] = [];

// The response describes the card as created, so adopting it wholesale reverts
// anything edited while it was in flight. Diffing against what was inserted finds
// those fields without enumerating which are editable — which holds only because
// the store replaces values rather than mutating them in place.
function mergeCopy(base: BoardTask, current: BoardTask, server: BoardTask): BoardTask {
  const merged = { ...server };
  for (const key of Object.keys(server) as (keyof BoardTask)[]) {
    if (current[key] !== base[key]) {
      (merged as Record<string, unknown>)[key] = current[key];
    }
  }
  return merged;
}

// Elision keeps the repeated last entry so the message still reads as a loop.
// A null title is a step in a project the viewer cannot read: the loop can now
// leave this board and come back, and those hops keep their place in the chain
// without being named.
function cycleMessage(prefix: string, titles: readonly (string | null)[]): string {
  if (titles.length === 0) {
    return prefix;
  }
  const shown = titles.map((title) =>
    title === null ? 'a task in another project' : truncateTitle(title, MAX_CYCLE_TITLE_CHARS)
  );
  const parts =
    shown.length <= MAX_CYCLE_TITLES
      ? shown
      : [...shown.slice(0, MAX_CYCLE_TITLES - 2), '…', shown[shown.length - 1]!];
  return `${prefix}: ${parts.join(' → ')}`;
}

// Null unless the server sent a well-formed path, so a pod that predates the
// `cycle` key still falls back to the plain message.
function cycleFromApiError(error: unknown): { message: string; cycle: CycleTask[] } | null {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return null;
  }
  const cycle = (error.body as { cycle?: unknown } | null | undefined)?.cycle;
  if (!Array.isArray(cycle) || cycle.length === 0) {
    return null;
  }
  const steps = cycle.filter(
    (step): step is CycleTask =>
      typeof step === 'object' &&
      step !== null &&
      typeof (step as { id?: unknown }).id === 'string' &&
      typeof (step as { title?: unknown }).title === 'string'
  );
  return steps.length === cycle.length ? { message: error.message, cycle: steps } : null;
}

class BoardStore {
  project = $state<BoardProject | null>(null);
  columns = $state<BoardColumn[]>([]);
  tasks = $state<BoardTask[]>([]);
  labels = $state<BoardLabel[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  errorStatus = $state<number | null>(null);
  // When the board on screen last came from the server. Rendered only by
  // UnsyncedChangesPanel, which sits behind the sync indicator's Details button
  // and so is reachable only while the outbox has something in it. Nothing shows
  // it otherwise — the indicator's own line names the state, never its age, and
  // `staleRead` below is what covers a board left behind with an empty queue.
  syncedAt = $state<string | null>(null);
  // The last refresh did not produce server data, and the board on screen is
  // whatever preceded it. Separate from `error`, which replaces the board with an
  // error page: this is the case where the board stays up, which is the right call
  // for a read nobody asked for and the reason one needs saying out loud at all.
  // Neither the outbox nor the socket can stand in for it — a read can fail with
  // nothing queued and the socket fine, and that combination shows nothing else.
  staleRead = $state(false);
  currentProjectId = $state<string | null>(null);
  readonly = $state(false);
  canEdit = $derived(this.project !== null && canEditProject(this.project, session.user?.id));
  // Read-only signal for the shortcut layer; nothing in this store reacts to it.
  dragging = $state(false);
  // The card overlay's checklist drags from its own zone, outside the board's.
  detailDragging = $state(false);
  dragBusy = $derived(this.dragging || this.detailDragging);
  filterLabelIds = $state<string[]>([]);
  filterAssigneeIds = $state<string[]>([]);
  filterQuery = $state('');
  // In the store rather than the view so it survives switching views and back.
  graphShowDone = $state(false);
  cyclePath = $state<CycleTask[] | null>(null);
  archivedTasks = $state<ArchivedTask[]>([]);
  archivedLoading = $state(false);
  archivedLoaded = $state(false);
  archivedError = $state<string | null>(null);
  // One instance, mutated in place: a SvelteSet makes its contents reactive, not
  // the field holding it, so reassigning would leave the template subscribed to
  // the set it read at mount.
  readonly changedTaskIds = new SvelteSet<string>();
  // The cards whose details were opened during this visit, remembered rather than
  // only dropped from the set above: the visit's capture can land after an overlay
  // is already up — a link straight to a card on a board still in the cache serves
  // it from there and only revalidates behind the scenes — and would otherwise
  // tint the very card being read.
  readonly #lookedAtTaskIds = new Set<string>();

  // Monotonic tokens rather than project-id checks: ids cannot tell a stale
  // request apart from a fresh one across a P1->P2->P1 flip.
  #loadToken = 0;
  #fetchToken = 0;
  #archivedToken = 0;
  #seenArmed = false;
  #cyclePathTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #ownsFilterUrl: boolean;

  // Per instance, never module-level: `awayBoard` below is a second live board,
  // and a shared sub-store would give the two of them one set of comments.
  readonly #comments: BoardComments;
  readonly #checklists: BoardChecklists;
  readonly #attachments: BoardAttachments;

  // Only the board on screen owns the address bar. A second one loaded for a card
  // on another project has no filters of its own, and a response landing after the
  // user walks onto that same project would strip theirs out of the URL.
  constructor({ ownsFilterUrl = true }: { ownsFilterUrl?: boolean } = {}) {
    this.#ownsFilterUrl = ownsFilterUrl;
    // Arrow functions so `this` is the store and every read happens at call time
    // against the live `$state`. Handing over `this` instead would keep exactly
    // the coupling the split removes.
    const port: BoardPort = {
      currentProjectId: () => this.currentProjectId,
      tasks: () => this.tasks,
      setTasks: (tasks) => {
        this.tasks = tasks;
      },
      tasksInColumn: (columnId) => this.tasksInColumn(columnId),
      send: (input) => this.#send(input),
      mutationFailed: (error) => this.#mutationFailed(error),
      loadTaskDetail: (taskId) => this.loadTaskDetail(taskId),
    };
    this.#comments = new BoardComments(port);
    this.#checklists = new BoardChecklists(port);
    this.#attachments = new BoardAttachments(port);
  }

  // Filters are adopted before the first await, so a link built from the store during
  // the fetch already carries the incoming project's narrowing.
  async load(
    projectId: string,
    filters: BoardFilters = noFilters(),
    opts: { readonly?: boolean } = {}
  ): Promise<void> {
    const wantsReadonly = opts.readonly ?? false;
    const sameProject = this.currentProjectId === projectId && this.readonly === wantsReadonly;
    if (!sameProject) {
      this.reset();
    }
    this.currentProjectId = projectId;
    this.readonly = wantsReadonly;
    this.setFilters(filters);
    if (sameProject && this.error === null) {
      // Stale-while-revalidate: serve the cached board flicker-free. Quiet, because
      // the board is already painted: raising the error page over a revalidation
      // nobody asked for would replace a working screen — and every open editor in
      // it — on one bad response. Opening a card runs this, so on a flaky network
      // it is the read most likely to fail under someone who is mid-sentence.
      if (!this.loading) {
        void this.refetch({ quiet: true });
      }
      return;
    }
    this.loading = true;
    const token = ++this.#loadToken;
    await this.refetch();
    if (token === this.#loadToken) {
      this.loading = false;
    }
  }

  // Entering a project asks for one capture of what changed, held for that visit.
  // The stale-while-revalidate reads that follow — an overlay opening, a view
  // switch — must not replace it with the empty set the stamp has since made true.
  armSeen(): void {
    this.#seenArmed = true;
    this.#lookedAtTaskIds.clear();
  }

  // Reading a card's details is looking at it, so that card's tint goes even though
  // the rest of the visit's capture stays. Local only: the board's marker was
  // already stamped on entry, so there is nothing left for the server to record.
  clearChanged(taskId: string): void {
    this.#lookedAtTaskIds.add(taskId);
    this.changedTaskIds.delete(taskId);
  }

  // A teammate's live change earns the same tint as the entry capture's, so a
  // card that moved while the reader was looking elsewhere is still findable
  // afterwards — which is the half a spoken announcement cannot do, since it
  // cannot be re-read or navigated to. Deliberately ignores #lookedAtTaskIds:
  // having opened a card earlier in this visit is no reason to hide that it has
  // changed since.
  markRemotelyChanged(taskIds: Iterable<string>): void {
    if (this.readonly) {
      return;
    }
    for (const id of taskIds) {
      this.changedTaskIds.add(id);
    }
  }

  // `quiet` suppresses the error page for every read the user did not ask for: one
  // supplementing an action that already succeeded, and every background
  // revalidation over a board that is already painted. The error page is for a load
  // with nothing to show behind it, and for the retry button on that page — anywhere
  // else it throws away a working screen, and any editor open in it, over one bad
  // response on a network that is about to work again.
  async refetch({ quiet = false }: { quiet?: boolean } = {}): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return;
    }
    const token = ++this.#fetchToken;
    try {
      const { data, projectUsers, comments, checklists } = this.readonly
        ? await this.#fetchPublic(projectId)
        : {
            data: assertOk(
              await api.GET('/api/projects/{id}', { params: { path: { id: projectId } } })
            ),
            projectUsers: null,
            comments: null,
            checklists: null,
          };
      if (token !== this.#fetchToken) {
        return;
      }
      // Behind the staleness check: a losing response must not refill the user
      // cache the read-only page dropped on its way out.
      if (projectUsers !== null) {
        users.setForProject(projectId, projectUsers);
      }
      if (comments !== null) {
        this.taskComments = comments;
      }
      if (checklists !== null) {
        this.taskChecklists = checklists;
      }
      this.project = data.project;
      projects.adoptMembership(data.project);
      this.columns = [...data.columns].sort(byRank);
      this.tasks = data.tasks;
      this.labels = data.labels;
      this.error = null;
      this.errorStatus = null;
      // Now that the label set is known, drop any the incoming URL named but this
      // project does not have.
      this.setFilters(this.filters);
      if (this.#seenArmed) {
        this.#seenArmed = false;
        // An anonymous public board has no marker to move and nothing to compare
        // against; a signed-in viewer is not this, and gets the whole feature.
        if (!this.readonly) {
          this.changedTaskIds.clear();
          // Coalesced despite the type: an API pod that predates the marker omits
          // the key, and the feature has to degrade to invisible rather than throw.
          for (const id of data.changed_task_ids ?? []) {
            if (!this.#lookedAtTaskIds.has(id)) {
              this.changedTaskIds.add(id);
            }
          }
          void projects.markSeen(projectId);
        }
      }
      this.syncedAt = new Date().toISOString();
      this.staleRead = false;
    } catch (error) {
      if (token !== this.#fetchToken) {
        return;
      }
      // Set before the two returns below, because both of them leave the previous
      // board on screen: quiet is the whole point of those returns, and a quiet
      // failure nobody records is a board that silently stops matching the server.
      this.staleRead = true;
      // A server that refused is a real error. A server that could not be
      // reached is not, as long as this device still has the board: showing the
      // last known state and saying so beats an error page over data we have.
      if (!(error instanceof ApiError) && (await this.#hydrateFromCache(projectId))) {
        return;
      }
      if (quiet) {
        return;
      }
      this.error = apiMessage(error, 'Failed to load board');
      this.errorStatus = error instanceof ApiError ? error.status : null;
    }
  }

  async #hydrateFromCache(projectId: string): Promise<boolean> {
    const userId = session.user?.id;
    if (userId === undefined || this.readonly) {
      return false;
    }
    const cached = await readBoardSnapshot(userId, projectId);
    if (cached === null || cached.payload.project.id !== projectId) {
      return false;
    }
    this.project = cached.payload.project;
    this.columns = [...cached.payload.columns].sort(byRank);
    this.tasks = cached.payload.tasks;
    this.labels = cached.payload.labels;
    this.error = null;
    this.errorStatus = null;
    this.syncedAt = cached.savedAt;
    this.setFilters(this.filters);
    return true;
  }

  /**
   * Writes what is on screen, not what the server last sent, so a reload while
   * offline comes back holding the user's unsent edits rather than a snapshot
   * that predates them. Called from the shell on a debounce; a board with no
   * project loaded has nothing worth keeping.
   */
  async persistSnapshot(): Promise<void> {
    const userId = session.user?.id;
    if (userId === undefined || this.readonly || this.project === null) {
      return;
    }
    await saveBoardSnapshot(userId, this.project.id, {
      project: this.project,
      columns: this.columns,
      tasks: this.tasks,
      labels: this.labels,
    });
  }

  async loadArchived(): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return;
    }
    const token = ++this.#archivedToken;
    this.archivedLoading = true;
    // Cleared up front so a retry shows its loading state instead of re-rendering
    // the failure it is already retrying.
    this.archivedError = null;
    try {
      const data = assertOk(
        await api.GET('/api/projects/{id}/archived-tasks', { params: { path: { id: projectId } } })
      );
      if (token !== this.#archivedToken) {
        return;
      }
      this.archivedTasks = data.tasks;
      this.archivedLoaded = true;
      this.archivedError = null;
    } catch (error) {
      if (token !== this.#archivedToken) {
        return;
      }
      this.archivedError = apiMessage(error, 'Failed to load the archive');
    } finally {
      if (token === this.#archivedToken) {
        this.archivedLoading = false;
      }
    }
  }

  // A client that never opened the archive pays nothing for the resync.
  async refetchArchived(): Promise<void> {
    if (!this.archivedLoaded) {
      return;
    }
    await this.loadArchived();
  }

  // refetch() can only repair the board, so every "reload everything" backstop
  // has to come through here instead. Quiet for the same reason: every caller — the
  // outbox settling, a socket reconnect, a failed mutation — is repairing a board
  // that is already on screen, and a repair that fails should leave the stale copy
  // up rather than take the screen. `staleRead` is what then says so; quiet means
  // no error page, not no signal.
  async resync(): Promise<void> {
    await this.refetch({ quiet: true });
    await this.refetchArchived();
  }

  // Placeholders stand in for the identity and timestamp fields the public
  // payload withholds; nothing the read-only UI renders reads them.
  async #fetchPublic(projectId: string): Promise<{
    data: {
      project: BoardProject;
      columns: BoardColumn[];
      tasks: BoardTask[];
      labels: BoardLabel[];
      changed_task_ids: string[];
    };
    projectUsers: User[];
    comments: Record<string, TaskComment[]>;
    checklists: Record<string, ChecklistItem[]>;
  }> {
    const data: PublicBoardPayload = assertOk(
      await api.GET('/api/public/projects/{id}/board', { params: { path: { id: projectId } } })
    );
    // Every task gets an entry, empty ones included: an absent one reads as
    // "not fetched yet", and there is no detail request coming to fill it.
    const comments: Record<string, TaskComment[]> = Object.fromEntries(
      data.tasks.map((task) => [task.id, [] as TaskComment[]])
    );
    // Coalesced despite the type: an API pod that predates public comments omits
    // the field entirely.
    for (const comment of data.comments ?? []) {
      comments[comment.task_id]?.push(comment);
    }
    const checklists: Record<string, ChecklistItem[]> = Object.fromEntries(
      data.tasks.map((task) => [task.id, [] as ChecklistItem[]])
    );
    for (const item of data.checklist_items ?? []) {
      // The public shape withholds the timestamps, and nothing read-only shows them.
      checklists[item.task_id]?.push({ ...item, created_at: '', updated_at: '' });
    }
    for (const items of Object.values(checklists)) {
      items.sort(byRank);
    }
    return {
      data: {
        project: {
          ...data.project,
          archived_at: null,
          created_at: '',
          created_by: null,
          member_ids: [],
          members: [],
          is_public: true,
          color: null,
        },
        columns: data.columns,
        tasks: data.tasks.map((task) => ({
          ...task,
          created_at: '',
          updated_at: '',
          column_since: '',
          // Coalesced despite the type, as the comments above are: an API pod that
          // predates checklists omits both counts and svelte-check cannot see it.
          checklist_item_count: task.checklist_item_count ?? 0,
          checklist_done_count: task.checklist_done_count ?? 0,
          // Public boards deliberately withhold it, and a paperclip on a card
          // whose files nobody can reach would only advertise what is missing.
          attachment_count: 0,
          // Withheld for a sharper reason: it measures a project that never
          // agreed to be published, so a stranger watching it fall would learn
          // that another team finished something.
          open_cross_project_blocker_count: 0,
        })),
        labels: data.labels,
        changed_task_ids: [],
      },
      projectUsers: data.users,
      comments,
      checklists,
    };
  }

  reset(): void {
    this.#loadToken += 1;
    this.#fetchToken += 1;
    this.#archivedToken += 1;
    this.project = null;
    this.columns = [];
    this.tasks = [];
    this.labels = [];
    this.archivedTasks = [];
    this.archivedLoading = false;
    this.archivedLoaded = false;
    this.archivedError = null;
    this.changedTaskIds.clear();
    this.#lookedAtTaskIds.clear();
    // #seenArmed is deliberately not cleared: load() resets before the arriving
    // project's capture has happened, and swallowing the flag here would leave a
    // return visit to a board with no highlights at all.
    this.taskComments = {};
    this.taskChecklists = {};
    this.taskSeriesRefs = {};
    this.taskAttachments = {};
    this.loading = false;
    this.syncedAt = null;
    this.staleRead = false;
    this.error = null;
    this.errorStatus = null;
    this.dragging = false;
    this.detailDragging = false;
    this.currentProjectId = null;
    this.readonly = false;
    this.filterLabelIds = [];
    this.filterAssigneeIds = [];
    this.filterQuery = '';
    this.graphShowDone = false;
    this.#clearCyclePath();
  }

  #clearCyclePath(): void {
    if (this.#cyclePathTimer !== null) {
      clearTimeout(this.#cyclePathTimer);
      this.#cyclePathTimer = null;
    }
    this.cyclePath = null;
  }

  // Expires alongside the toast that explains it, so the highlight never
  // outlives its own caption.
  #showCyclePath(path: CycleTask[]): void {
    this.#clearCyclePath();
    this.cyclePath = path;
    this.#cyclePathTimer = setTimeout(() => this.#clearCyclePath(), CYCLE_PATH_MS);
  }

  // One grouped pass over the board rather than a filter-and-sort per column.
  // Every render asks each column for its tasks at least twice — the card list
  // and the header count — so a per-column scan made one render cost columns x
  // tasks, and a 64-column board spent 56ms per render on nothing but grouping.
  readonly #tasksByColumn: Readonly<Record<string, BoardTask[]>> = $derived.by(() => {
    // Null-prototype, so a column id can never collide with an Object member and
    // hand back a function where the caller expects a list of tasks.
    const grouped: Record<string, BoardTask[]> = Object.create(null);
    for (const task of this.tasks) {
      (grouped[task.column_id] ??= []).push(task);
    }
    for (const bucket of Object.values(grouped)) {
      bucket.sort(byRank);
    }
    return grouped;
  });

  /** Shared and read-only: callers that reorder or splice must copy first. */
  tasksInColumn(columnId: string): BoardTask[] {
    return this.#tasksByColumn[columnId] ?? NO_TASKS;
  }

  async createTask(columnId: string, title: string): Promise<string | null> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return null;
    }
    const id = newId();
    const placement = append(this.tasksInColumn(columnId));
    this.tasks = [...this.tasks, optimisticTask(id, columnId, title, placement)];
    const result = await this.#send<BoardTask>({
      entityId: id,
      label: `New card “${truncateTitle(title)}”`,
      semantics: 'create',
      request: {
        method: 'POST',
        path: '/api/tasks',
        body: { id, project_id: projectId, column_id: columnId, title, ...placement },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
      return null;
    }
    if (result.status === 'sent') {
      this.#adoptTimestamps(id, {
        created_at: result.data.created_at,
        updated_at: result.data.updated_at,
      });
    }
    return id;
  }

  async createTasks(columnId: string, titles: string[]): Promise<string[] | null> {
    const projectId = this.currentProjectId;
    if (projectId === null || titles.length === 0) {
      return null;
    }
    if (titles.length > MAX_BATCH_TASKS) {
      toasts.error(`Add at most ${MAX_BATCH_TASKS} tasks at a time (got ${titles.length})`);
      return null;
    }
    const placements = appendRun(this.tasksInColumn(columnId), titles.length);
    const created = titles.map((title, index) =>
      optimisticTask(newId(), columnId, title, placements[index]!)
    );
    this.tasks = [...this.tasks, ...created];
    const result = await this.#send<BulkTasksResponse>({
      // The batch is all-or-nothing on a duplicate id, so replaying it either
      // creates every card or reports that they are already there — never half.
      entityId: created[0]!.id,
      label: `${String(created.length)} new cards`,
      semantics: 'create',
      request: {
        method: 'POST',
        path: '/api/tasks/batch',
        body: {
          project_id: projectId,
          column_id: columnId,
          tasks: created.map((task) => ({
            id: task.id,
            title: task.title,
            sort_key: task.sort_key,
          })),
        },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
      return null;
    }
    if (result.status === 'sent') {
      this.#adoptTimestampsFrom(result.data.tasks);
    }
    return created.map((task) => task.id);
  }

  async duplicateTask(taskId: string): Promise<string | null> {
    const source = this.tasks.find((task) => task.id === taskId);
    if (source === undefined) {
      return null;
    }
    const siblings = this.tasksInColumn(source.column_id);
    const placement = placeAtIndex(siblings, siblings.findIndex((task) => task.id === taskId) + 1);
    const id = newId();
    const now = new Date().toISOString();
    // Labels and assignees come along because the server copies them.
    // Edges, comments and attachments it does not copy, so they start empty.
    const optimistic: BoardTask = {
      ...source,
      id,
      ...placement,
      blocker_ids: [],
      open_cross_project_blocker_count: 0,
      comment_count: 0,
      attachment_count: 0,
      created_at: now,
      updated_at: now,
      column_since: now,
    };
    this.tasks = [...this.tasks, optimistic];
    const result = await this.#send<BoardTask>({
      entityId: id,
      label: `Duplicated “${truncateTitle(source.title)}”`,
      semantics: 'create',
      request: {
        method: 'POST',
        path: '/api/tasks/{id}/duplicate',
        pathParams: { id: taskId },
        body: { id, ...placement },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
      return null;
    }
    if (result.status === 'sent') {
      const created = result.data;
      this.tasks = this.tasks.map((task) =>
        task.id === id ? mergeCopy(optimistic, task, created) : task
      );
    }
    return id;
  }

  // Awaiting the create before addBlocker guarantees the row exists server-side, so
  // the blocker call can never race ahead of it (the label-race class of bug).
  // addBlocker(taskId, blockerTaskId) reads as "blockerTaskId blocks taskId", hence
  // the inverted argument order for each direction below.
  async createAndLinkTask(
    title: string,
    opts: { blockerOf?: string; blockedBy?: string } = {}
  ): Promise<string | null> {
    // A done column can sit first, and dropping a brand-new task straight into it
    // would file it as finished — and hide it from the graph that just made it.
    const column = this.columns.find((c) => !c.is_done) ?? this.columns[0];
    if (column === undefined) {
      return null;
    }
    const id = await this.createTask(column.id, title);
    if (id === null) {
      return null;
    }
    if (opts.blockerOf !== undefined) {
      await this.addBlocker(opts.blockerOf, id);
    } else if (opts.blockedBy !== undefined) {
      await this.addBlocker(id, opts.blockedBy);
    }
    return id;
  }

  /**
   * `intent` is the same drop expressed as the cards it landed between, and it
   * is what gets queued when this cannot be sent now. A `sort_key` is only
   * meaningful against the board it was computed from, so replaying one minutes
   * later would drop the card wherever that key happens to fall; the neighbors
   * still mean what the user meant. Defaults to the end of the column, which is
   * what the callers that append actually intend.
   */
  async moveTask(
    taskId: string,
    columnId: string,
    placement: Placement,
    intent: Neighbors = { afterId: null, beforeId: null }
  ): Promise<void> {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId ? { ...task, column_id: columnId, ...placement } : task
    );
    const title = this.tasks.find((task) => task.id === taskId)?.title ?? '';
    const result = await this.#send({
      entityId: taskId,
      label: `Moved “${truncateTitle(title)}”`,
      semantics: 'move',
      move: { columnId, ...intent },
      request: {
        method: 'PATCH',
        path: '/api/tasks/{id}',
        pathParams: { id: taskId },
        body: { column_id: columnId, ...placement },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
    }
    // Not conditional on success: a failed move resyncs the board, and the log
    // has to end up showing what the server kept.
    taskActivity.invalidate(taskId);
  }

  // False when the project has no done column, so callers can decline the action
  // instead of offering one that would silently do nothing.
  markTaskDone(taskId: string): boolean {
    const doneColumn = this.columns.find((column) => column.is_done);
    if (doneColumn === undefined) {
      return false;
    }
    void this.moveTask(taskId, doneColumn.id, append(this.tasksInColumn(doneColumn.id)));
    return true;
  }

  // Merges only the timestamps, never the whole response body: a label or assignee
  // change applied optimistically while the write was in flight must survive.
  #adoptTimestamps(taskId: string, times: { created_at?: string; updated_at: string }): void {
    this.tasks = this.tasks.map((task) => (task.id === taskId ? { ...task, ...times } : task));
  }

  // Plural so a 100-card batch is one pass over the tasks, not one per card.
  #adoptTimestampsFrom(rows: readonly BoardTask[]): void {
    const times = new Map(rows.map((row) => [row.id, row]));
    this.tasks = this.tasks.map((task) => {
      const row = times.get(task.id);
      return row === undefined
        ? task
        : { ...task, created_at: row.created_at, updated_at: row.updated_at };
    });
  }

  /**
   * `base` is the version the editor was populated from. It is only needed when
   * the write might have to wait: a queued edit that comes back 409 has to be
   * able to offer the user the same both-versions choice an online one does, and
   * that needs the baseline as well as the text, captured now rather than
   * reconstructed later from a board that has since moved on.
   */
  async updateTask(
    taskId: string,
    patch: {
      title?: string;
      description?: BoardTask['description'];
      due_date?: BoardTask['due_date'];
    },
    expectedUpdatedAt?: string,
    base?: TaskVersion
  ): Promise<TaskUpdateOutcome> {
    this.tasks = this.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
    const body = {
      ...patch,
      ...(expectedUpdatedAt !== undefined ? { expected_updated_at: expectedUpdatedAt } : {}),
    };
    // Only a patch carrying a precondition can come back as a conflict; a move
    // or a due-date change is last-write-wins and the server ignores it.
    const guarded = expectedUpdatedAt !== undefined && base !== undefined;
    const title = this.tasks.find((task) => task.id === taskId)?.title ?? '';
    const result = await this.#send<BoardTask>({
      entityId: taskId,
      label: `Edited “${truncateTitle(title)}”`,
      semantics: guarded ? 'contentEdit' : 'plain',
      conflict: guarded ? { taskId, base, mine: mergeVersion(base, patch) } : undefined,
      request: { method: 'PATCH', path: '/api/tasks/{id}', pathParams: { id: taskId }, body },
    });
    taskActivity.invalidate(taskId);
    if (result.status === 'sent') {
      this.#adoptTimestamps(taskId, { updated_at: result.data.updated_at });
      return { status: 'ok', updated_at: result.data.updated_at };
    }
    if (result.status === 'queued') {
      // The baseline deliberately does not advance: the precondition still names
      // the last version the server confirmed, which is what the queued patch
      // carries and what it will be judged against.
      return { status: 'queued' };
    }
    if (result.error.status === 409) {
      // No toast: the caller owns the conflict surface, and the refetch is what
      // lets it offer the server's current version. Quiet, because the surface it
      // is feeding is the open overlay — an error page here would unmount the very
      // editor holding the text the conflict promises is safe.
      await this.refetch({ quiet: true });
      return { status: 'conflict' };
    }
    await this.#mutationFailed(result.error);
    return { status: 'error' };
  }

  // Plural so emptying a column is one pass over the tasks, not one per card.
  #dropTasks(taskIds: readonly string[]): void {
    const dropped = new Set(taskIds);
    this.tasks = this.tasks
      .filter((task) => !dropped.has(task.id))
      .map((task) =>
        task.blocker_ids.some((id) => dropped.has(id))
          ? { ...task, blocker_ids: task.blocker_ids.filter((id) => !dropped.has(id)) }
          : task
      );
  }

  // A local archive edit outranks any load already in flight: that response was
  // built before the edit and would put the row back.
  #discardArchivedLoad(): void {
    this.#archivedToken += 1;
    this.archivedLoading = false;
  }

  async deleteTask(taskId: string): Promise<void> {
    const title = this.tasks.find((task) => task.id === taskId)?.title ?? '';
    this.#dropTasks([taskId]);
    this.#discardArchivedLoad();
    this.archivedTasks = this.archivedTasks.filter((task) => task.id !== taskId);
    const result = await this.#send({
      entityId: taskId,
      label: `Deleted “${truncateTitle(title)}”`,
      request: { method: 'DELETE', path: '/api/tasks/{id}', pathParams: { id: taskId } },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
    }
  }

  async archiveTask(taskId: string): Promise<void> {
    // Captured before the drop: nothing else holds the row afterwards.
    const task = this.tasks.find((t) => t.id === taskId);
    if (task === undefined) {
      return;
    }
    this.#dropTasks([taskId]);
    this.#discardArchivedLoad();
    this.archivedTasks = [
      { ...task, archived_at: new Date().toISOString() },
      ...this.archivedTasks,
    ];
    const result = await this.#send<ArchivedTask>({
      entityId: taskId,
      label: `Archived “${truncateTitle(task.title)}”`,
      request: { method: 'POST', path: '/api/tasks/{id}/archive', pathParams: { id: taskId } },
    });
    if (result.status === 'sent') {
      this.archivedTasks = this.archivedTasks.map((t) => (t.id === taskId ? result.data : t));
    }
    if (result.status === 'failed') {
      this.archivedTasks = this.archivedTasks.filter((t) => t.id !== taskId);
      await this.#mutationFailed(result.error);
    }
    taskActivity.invalidate(taskId);
  }

  async restoreTask(taskId: string): Promise<void> {
    const archived = this.archivedTasks.find((t) => t.id === taskId);
    this.#discardArchivedLoad();
    this.archivedTasks = this.archivedTasks.filter((t) => t.id !== taskId);
    const result = await this.#send<BoardTask>({
      entityId: taskId,
      label: `Restored “${truncateTitle(archived?.title ?? '')}”`,
      request: { method: 'POST', path: '/api/tasks/{id}/restore', pathParams: { id: taskId } },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
      taskActivity.invalidate(taskId);
      return;
    }
    // Queued, the server's version of the restored row is not available — so the
    // card is put back from the archived copy rather than vanishing from both
    // lists until the network returns.
    const restored = result.status === 'sent' ? result.data : unarchive(archived);
    if (restored !== undefined) {
      this.tasks = this.tasks.some((t) => t.id === restored.id)
        ? this.tasks.map((t) => (t.id === restored.id ? restored : t))
        : [...this.tasks, restored];
    }
    if (result.status === 'sent') {
      // The tasks this one blocks are not derivable from the response, and only
      // a board read names that direction.
      await this.refetch({ quiet: true });
    }
    taskActivity.invalidate(taskId);
  }

  async createColumn(name: string): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return;
    }
    const id = newId();
    const placement = append(this.columns);
    this.columns = [...this.columns, { id, name, ...placement, is_done: false }];
    const result = await this.#send({
      entityId: id,
      label: `New column “${truncateTitle(name)}”`,
      semantics: 'create',
      request: {
        method: 'POST',
        path: '/api/columns',
        body: { id, project_id: projectId, name, ...placement },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
    }
  }

  async renameColumn(columnId: string, name: string): Promise<void> {
    this.columns = this.columns.map((column) =>
      column.id === columnId ? { ...column, name } : column
    );
    const result = await this.#send({
      entityId: columnId,
      label: `Renamed a column to “${truncateTitle(name)}”`,
      request: {
        method: 'PATCH',
        path: '/api/columns/{id}',
        pathParams: { id: columnId },
        body: { name },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
    }
  }

  async moveColumn(columnId: string, placement: Placement): Promise<void> {
    this.columns = this.columns
      .map((column) => (column.id === columnId ? { ...column, ...placement } : column))
      .sort(byRank);
    const name = this.columns.find((column) => column.id === columnId)?.name ?? '';
    const result = await this.#send({
      entityId: columnId,
      label: `Moved column “${truncateTitle(name)}”`,
      request: {
        method: 'PATCH',
        path: '/api/columns/{id}',
        pathParams: { id: columnId },
        body: { ...placement },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
    }
  }

  async toggleColumnDone(columnId: string): Promise<void> {
    const column = this.columns.find((c) => c.id === columnId);
    if (column === undefined) {
      return;
    }
    const is_done = !column.is_done;
    this.columns = this.columns.map((c) => (c.id === columnId ? { ...c, is_done } : c));
    const result = await this.#send({
      entityId: columnId,
      label: `Marked “${truncateTitle(column.name)}” as ${is_done ? 'done' : 'not done'}`,
      request: {
        method: 'PATCH',
        path: '/api/columns/{id}',
        pathParams: { id: columnId },
        body: { is_done },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
    }
  }

  async duplicateColumn(columnId: string): Promise<void> {
    const source = this.columns.find((column) => column.id === columnId);
    if (source === undefined) {
      return;
    }
    const placement = placeAtIndex(
      this.columns,
      this.columns.findIndex((column) => column.id === columnId) + 1
    );
    const id = newId();
    const projectId = this.currentProjectId;
    // The copies of the cards cannot be optimistic — the server names them — but
    // the empty column can, so it appears beside the original straight away.
    this.columns = [
      ...this.columns,
      { id, name: source.name, ...placement, is_done: source.is_done },
    ].sort(byRank);
    const result = await this.#send<DuplicatedColumnResponse>({
      entityId: id,
      label: `Duplicated column “${truncateTitle(source.name)}”`,
      semantics: 'create',
      request: {
        method: 'POST',
        path: '/api/columns/{id}/duplicate',
        pathParams: { id: columnId },
        body: { id, ...placement },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
      return;
    }
    if (result.status !== 'sent') {
      return;
    }
    const data = result.data;
    // Other mutations key off an id already on the board, so a late response is a
    // no-op. This one appends outright, into whatever board is showing now.
    if (this.currentProjectId !== projectId) {
      return;
    }
    this.columns = this.columns.map((column) =>
      column.id === id
        ? {
            id: data.column.id,
            name: data.column.name,
            sort_key: data.column.sort_key,
            is_done: data.column.is_done,
          }
        : column
    );
    // Computed after the await so a realtime echo that landed while the request
    // was in flight is not added a second time.
    const held = new Set(this.tasks.map((task) => task.id));
    this.tasks = [...this.tasks, ...data.tasks.filter((task) => !held.has(task.id))];
  }

  // The server relocates every row in the column, archived ones included, so
  // leaving them behind would strand them on a column id the board no longer has.
  async deleteColumn(columnId: string, moveTasksTo?: string): Promise<void> {
    const movedLive = this.tasksInColumn(columnId);
    const movedArchived = this.archivedTasks.filter((task) => task.column_id === columnId);
    this.columns = this.columns.filter((column) => column.id !== columnId);
    if (moveTasksTo !== undefined && movedLive.length + movedArchived.length > 0) {
      // Rank then id, the order the server relocates in.
      const relocating = [...movedLive, ...movedArchived].sort(
        (a, b) => byRank(a, b) || a.id.localeCompare(b.id)
      );
      const run = appendRun(this.tasksInColumn(moveTasksTo), relocating.length);
      const movedPositions = new Map(relocating.map((task, index) => [task.id, run[index]!]));
      const place = <T extends { id: string; column_id: string; sort_key: string }>(task: T): T => {
        const placement = movedPositions.get(task.id);
        return placement === undefined ? task : { ...task, column_id: moveTasksTo, ...placement };
      };
      this.tasks = this.tasks.map(place);
      this.archivedTasks = this.archivedTasks.map(place);
    } else {
      this.tasks = this.tasks.filter((task) => task.column_id !== columnId);
      this.archivedTasks = this.archivedTasks.filter((task) => task.column_id !== columnId);
    }
    const name = this.columns.find((column) => column.id === columnId)?.name ?? '';
    const result = await this.#send<MovedTasksResponse | undefined>({
      entityId: columnId,
      label: `Deleted column “${truncateTitle(name)}”`,
      request: {
        method: 'DELETE',
        path: '/api/columns/{id}',
        pathParams: { id: columnId },
        query: moveTasksTo === undefined ? undefined : { move_tasks_to: moveTasksTo },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
    }
    if (result.status === 'sent' && result.data !== undefined) {
      const byId = new Map(result.data.moved_tasks.map((task) => [task.id, task]));
      const apply = <T extends { id: string; column_id: string; sort_key: string }>(task: T): T => {
        const movedTask = byId.get(task.id);
        return movedTask === undefined
          ? task
          : {
              ...task,
              column_id: movedTask.column_id,
              sort_key: movedTask.sort_key,
            };
      };
      this.tasks = this.tasks.map(apply);
      this.archivedTasks = this.archivedTasks.map(apply);
    }
    for (const task of [...movedLive, ...movedArchived]) {
      taskActivity.invalidate(task.id);
    }
  }

  // Archived cards stay put, matching the server: the column survives, so it is
  // still there to restore them into.
  async moveTasksToColumn(columnId: string, targetColumnId: string): Promise<void> {
    const moved = this.tasksInColumn(columnId);
    if (this.currentProjectId === null || moved.length === 0) {
      return;
    }
    const run = appendRun(this.tasksInColumn(targetColumnId), moved.length);
    const optimistic = new Map(moved.map((task, index) => [task.id, run[index]!] as const));
    this.tasks = this.tasks.map((task) => {
      const placement = optimistic.get(task.id);
      return placement === undefined ? task : { ...task, column_id: targetColumnId, ...placement };
    });
    const result = await this.#send<MovedTasksResponse>({
      entityId: columnId,
      label: `Moved ${String(moved.length)} cards to another column`,
      request: {
        method: 'POST',
        path: '/api/columns/{id}/move-tasks',
        pathParams: { id: columnId },
        body: { target_column_id: targetColumnId },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
    }
    if (result.status === 'sent') {
      const byId = new Map(result.data.moved_tasks.map((task) => [task.id, task]));
      this.tasks = this.tasks.map((task) => {
        const movedTask = byId.get(task.id);
        return movedTask === undefined
          ? task
          : {
              ...task,
              column_id: movedTask.column_id,
              sort_key: movedTask.sort_key,
            };
      });
      // The reconcile leaves an unlisted task alone, so one the server refused to
      // move — already archived, per an event we have not seen — would otherwise
      // sit in the target column forever. Sets, not counts: an id we did not send
      // can mask one the server skipped.
      if (byId.size !== moved.length || moved.some((task) => !byId.has(task.id))) {
        await this.resync();
      }
    }
    for (const task of moved) {
      taskActivity.invalidate(task.id);
    }
  }

  // A one-shot sort: rewrite the column's sort keys to match the key once, then
  // manual order resumes. The whole column is re-stamped so later drags have
  // room, and the server is the source of truth on the echoed values.
  async sortColumn(columnId: string, sort: ColumnSort): Promise<void> {
    if (this.currentProjectId === null) {
      return;
    }
    const ordered = sortTasks(this.tasksInColumn(columnId), sort);
    if (ordered.length <= 1) {
      return;
    }
    const orderedIds = ordered.map((task) => task.id);
    const optimistic = new Map(restack(ordered).map(({ id, sort_key }) => [id, sort_key]));
    this.tasks = this.tasks.map((task) => {
      const sortKey = optimistic.get(task.id);
      return sortKey === undefined ? task : { ...task, sort_key: sortKey };
    });
    const result = await this.#send<MovedTasksResponse>({
      entityId: columnId,
      label: 'Sorted a column',
      request: {
        method: 'POST',
        path: '/api/columns/{id}/reorder',
        pathParams: { id: columnId },
        body: { task_ids: orderedIds },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
    }
    if (result.status === 'sent') {
      const byId = new Map(result.data.moved_tasks.map((task) => [task.id, task]));
      this.tasks = this.tasks.map((task) => {
        const movedTask = byId.get(task.id);
        return movedTask === undefined ? task : { ...task, sort_key: movedTask.sort_key };
      });
    }
  }

  async archiveTasksInColumn(columnId: string): Promise<void> {
    const archiving = this.tasksInColumn(columnId);
    if (this.currentProjectId === null || archiving.length === 0) {
      return;
    }
    const archivingIds = archiving.map((task) => task.id);
    this.#dropTasks(archivingIds);
    this.#discardArchivedLoad();
    const now = new Date().toISOString();
    this.archivedTasks = [
      ...archiving.map((task) => ({ ...task, archived_at: now })),
      ...this.archivedTasks,
    ];
    const result = await this.#send<ArchivedTasksResponse>({
      entityId: columnId,
      label: `Archived ${String(archivingIds.length)} cards in a column`,
      request: {
        method: 'POST',
        path: '/api/columns/{id}/archive-tasks',
        pathParams: { id: columnId },
      },
    });
    if (result.status === 'sent') {
      const byId = new Map(result.data.tasks.map((task) => [task.id, task]));
      this.archivedTasks = this.archivedTasks.map((task) => byId.get(task.id) ?? task);
      // A card we dropped from the board but the server did not archive is gone
      // from both lists until something else refetches. Sets, not counts: an id we
      // did not send can mask one the server skipped.
      if (byId.size !== archivingIds.length || archivingIds.some((id) => !byId.has(id))) {
        await this.resync();
      }
    }
    if (result.status === 'failed') {
      const dropped = new Set(archivingIds);
      this.archivedTasks = this.archivedTasks.filter((task) => !dropped.has(task.id));
      await this.#mutationFailed(result.error);
    }
    for (const id of archivingIds) {
      taskActivity.invalidate(id);
    }
  }

  // The caller passes ids in board order and the server appends in that order,
  // so the optimistic stamp and the commit agree and nothing visibly reshuffles.
  async bulkMoveTasks(taskIds: readonly string[], columnId: string): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null || taskIds.length === 0) {
      return;
    }
    const run = appendRun(this.tasksInColumn(columnId), taskIds.length);
    const optimistic = new Map(taskIds.map((id, index) => [id, run[index]!]));
    this.tasks = this.tasks.map((task) => {
      const placement = optimistic.get(task.id);
      return placement === undefined ? task : { ...task, column_id: columnId, ...placement };
    });
    const result = await this.#send<BulkMovedTasksResponse>({
      entityId: columnId,
      label: `Moved ${String(taskIds.length)} cards`,
      request: {
        method: 'POST',
        path: '/api/tasks/bulk-move',
        body: { project_id: projectId, task_ids: [...taskIds], column_id: columnId },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
    }
    if (result.status === 'sent') {
      const byId = new Map(result.data.moved_tasks.map((task) => [task.id, task]));
      this.tasks = this.tasks.map((task) => {
        const moved = byId.get(task.id);
        return moved === undefined
          ? task
          : { ...task, column_id: moved.column_id, sort_key: moved.sort_key };
      });
      if (
        this.#bulkSkipped('Moved', taskIds, result.data.skipped_task_ids) ||
        this.#bulkDisagrees(taskIds, byId)
      ) {
        await this.resync();
      }
    }
    for (const id of taskIds) {
      taskActivity.invalidate(id);
    }
  }

  async bulkArchiveTasks(taskIds: readonly string[]): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null || taskIds.length === 0) {
      return;
    }
    const wanted = new Set(taskIds);
    // Captured before the drop: nothing else holds the rows afterwards.
    const archiving = this.tasks.filter((task) => wanted.has(task.id));
    this.#dropTasks(taskIds);
    this.#discardArchivedLoad();
    const now = new Date().toISOString();
    this.archivedTasks = [
      ...archiving.map((task) => ({ ...task, archived_at: now })),
      ...this.archivedTasks,
    ];
    const result = await this.#send<BulkArchivedTasksResponse>({
      entityId: taskIds[0]!,
      label: `Archived ${String(taskIds.length)} cards`,
      request: {
        method: 'POST',
        path: '/api/tasks/bulk-archive',
        body: { project_id: projectId, task_ids: [...taskIds] },
      },
    });
    if (result.status === 'sent') {
      const byId = new Map(result.data.tasks.map((task) => [task.id, task]));
      this.archivedTasks = this.archivedTasks.map((task) => byId.get(task.id) ?? task);
      if (
        this.#bulkSkipped('Archived', taskIds, result.data.skipped_task_ids) ||
        this.#bulkDisagrees(taskIds, byId)
      ) {
        await this.resync();
      }
    }
    if (result.status === 'failed') {
      this.archivedTasks = this.archivedTasks.filter((task) => !wanted.has(task.id));
      await this.#mutationFailed(result.error);
    }
    for (const id of taskIds) {
      taskActivity.invalidate(id);
    }
  }

  async bulkSetLabel(taskIds: readonly string[], labelId: string, on: boolean): Promise<void> {
    const name = this.labels.find((label) => label.id === labelId)?.name ?? '';
    await this.#bulkSetRelation(taskIds, 'label_ids', labelId, on, {
      label: `${on ? 'Added' : 'Removed'} label “${truncateTitle(name)}” on ${String(taskIds.length)} cards`,
      body: on ? { add_label_ids: [labelId] } : { remove_label_ids: [labelId] },
      path: '/api/tasks/bulk-labels',
    });
  }

  async bulkSetAssignee(taskIds: readonly string[], userId: string, on: boolean): Promise<void> {
    await this.#bulkSetRelation(taskIds, 'assignee_ids', userId, on, {
      label: `${on ? 'Assigned' : 'Unassigned'} ${String(taskIds.length)} cards`,
      body: on ? { add_user_ids: [userId] } : { remove_user_ids: [userId] },
      path: '/api/tasks/bulk-assignees',
    });
  }

  async #bulkSetRelation(
    taskIds: readonly string[],
    field: 'label_ids' | 'assignee_ids',
    valueId: string,
    on: boolean,
    send: { label: string; body: Record<string, string[]>; path: SerializedRequest['path'] }
  ): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null || taskIds.length === 0) {
      return;
    }
    const wanted = new Set(taskIds);
    const next = (held: string[]): string[] =>
      on
        ? held.includes(valueId)
          ? held
          : [...held, valueId]
        : held.filter((id) => id !== valueId);
    this.tasks = this.tasks.map((task) =>
      !wanted.has(task.id)
        ? task
        : field === 'label_ids'
          ? { ...task, label_ids: next(task.label_ids) }
          : { ...task, assignee_ids: next(task.assignee_ids) }
    );
    const result = await this.#send<BulkRelationsResponse>({
      entityId: taskIds[0]!,
      label: send.label,
      request: {
        method: 'POST',
        path: send.path,
        body: { project_id: projectId, task_ids: [...taskIds], ...send.body },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
    }
    if (result.status === 'sent') {
      const byId = new Map(result.data.tasks.map((task) => [task.task_id, task]));
      this.tasks = this.tasks.map((task) => {
        const relations = byId.get(task.id);
        return relations === undefined
          ? task
          : {
              ...task,
              label_ids: relations.label_ids,
              assignee_ids: relations.assignee_ids,
              blocker_ids: relations.blocker_ids,
              open_cross_project_blocker_count: relations.open_cross_project_blocker_count,
            };
      });
      // Only the cards that actually changed come back, so a short list is
      // expected here; an id we never sent is not.
      if (
        this.#bulkSkipped('Updated', taskIds, result.data.skipped_task_ids) ||
        result.data.tasks.some((task) => !wanted.has(task.task_id))
      ) {
        await this.resync();
      }
    }
    for (const id of taskIds) {
      taskActivity.invalidate(id);
    }
  }

  #bulkSkipped(verb: string, requested: readonly string[], skipped: readonly string[]): boolean {
    if (skipped.length === 0) {
      return false;
    }
    toasts.info(
      `${verb} ${String(requested.length - skipped.length)} of ${String(requested.length)} cards. ` +
        `${String(skipped.length)} changed before the action ran.`
    );
    return true;
  }

  // Sets, not counts: an id we did not send can mask one the server skipped, and
  // the reconcile leaves an unlisted card holding its optimistic state.
  #bulkDisagrees(requested: readonly string[], applied: ReadonlyMap<string, unknown>): boolean {
    return applied.size !== requested.length || requested.some((id) => !applied.has(id));
  }

  async createLabel(name: string, color: string): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return;
    }
    const id = newId();
    this.labels = [...this.labels, { id, name, color }];
    const result = await this.#send({
      entityId: id,
      label: `New label “${truncateTitle(name)}”`,
      semantics: 'create',
      request: {
        method: 'POST',
        path: '/api/labels',
        body: { id, project_id: projectId, name, color },
      },
    });
    if (result.status === 'failed') {
      await this.#labelConflictOrFail(result.error);
    }
  }

  async updateLabel(labelId: string, patch: { name?: string; color?: string }): Promise<void> {
    this.labels = this.labels.map((label) =>
      label.id === labelId ? { ...label, ...patch } : label
    );
    const name = this.labels.find((label) => label.id === labelId)?.name ?? '';
    const result = await this.#send({
      entityId: labelId,
      label: `Edited label “${truncateTitle(name)}”`,
      request: {
        method: 'PATCH',
        path: '/api/labels/{id}',
        pathParams: { id: labelId },
        body: patch,
      },
    });
    if (result.status === 'failed') {
      await this.#labelConflictOrFail(result.error);
    }
  }

  async deleteLabel(labelId: string): Promise<void> {
    this.labels = this.labels.filter((label) => label.id !== labelId);
    this.tasks = this.tasks.map((task) =>
      task.label_ids.includes(labelId)
        ? { ...task, label_ids: task.label_ids.filter((id) => id !== labelId) }
        : task
    );
    this.setFilters({
      ...this.filters,
      labelIds: this.filterLabelIds.filter((id) => id !== labelId),
    });
    const result = await this.#send({
      entityId: labelId,
      label: 'Deleted a label',
      request: { method: 'DELETE', path: '/api/labels/{id}', pathParams: { id: labelId } },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
    }
  }

  async setTaskLabels(taskId: string, labelIds: string[]): Promise<void> {
    this.tasks = patchById(this.tasks, taskId, (task) => ({ ...task, label_ids: labelIds }));
    const title = this.tasks.find((task) => task.id === taskId)?.title ?? '';
    const result = await this.#send({
      entityId: taskId,
      label: `Changed labels on “${truncateTitle(title)}”`,
      request: {
        method: 'PUT',
        path: '/api/tasks/{id}/labels',
        pathParams: { id: taskId },
        body: { label_ids: labelIds },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
    }
    taskActivity.invalidate(taskId);
  }

  async setTaskAssignees(taskId: string, userIds: string[]): Promise<void> {
    this.tasks = patchById(this.tasks, taskId, (task) => ({ ...task, assignee_ids: userIds }));
    const title = this.tasks.find((task) => task.id === taskId)?.title ?? '';
    const result = await this.#send({
      entityId: taskId,
      label: `Changed assignees on “${truncateTitle(title)}”`,
      request: {
        method: 'PUT',
        path: '/api/tasks/{id}/assignees',
        pathParams: { id: taskId },
        body: { user_ids: userIds },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
    }
    taskActivity.invalidate(taskId);
  }

  setTaskCover(taskId: string, image: TaskAttachment | null): Promise<void> {
    return this.#attachments.setCover(taskId, image);
  }

  async addBlocker(taskId: string, blockerTaskId: string): Promise<boolean> {
    const target = this.tasks.find((task) => task.id === taskId);
    if (target === undefined || target.blocker_ids.includes(blockerTaskId)) {
      return false;
    }
    const next = this.tasks.map((task) =>
      task.id === taskId ? { ...task, blocker_ids: [...task.blocker_ids, blockerTaskId] } : task
    );
    // Reject a cycle-forming edge before applying it, so the graph never flashes
    // its full-screen cycle state and the backend 409 toast never stacks on ours.
    const { nodes, edges } = buildGraph(next, this.columns);
    const onCycle = cycleNodeIds(nodes, edges);
    if (onCycle.size > 0) {
      // Only local cards can be on a loop this check sees: the default expansion
      // emits no cross-project nodes, and they carry no outgoing edge anyway.
      const taskNodes = nodes.filter((node) => node.kind === 'task');
      const titleById = new Map(taskNodes.map((node) => [node.id, node.title]));
      const steps = cyclePathIds(edges, taskId, blockerTaskId).map((id) => ({
        id,
        title: titleById.get(id) ?? '',
      }));
      // A done task on the loop is one the graph may not be drawing, so the edge
      // that makes this a cycle can be nowhere on screen. `onCycle` also holds
      // everything downstream of the loop, so it only answers when nothing named it.
      const doneIds = new Set(taskNodes.filter((node) => node.isDone).map((node) => node.id));
      const throughDone =
        steps.length > 0
          ? steps.some((step) => doneIds.has(step.id))
          : taskNodes.some((node) => onCycle.has(node.id) && node.isDone);
      if (steps.length > 0) {
        this.#showCyclePath(steps);
      }
      toasts.error(
        cycleMessage(
          throughDone
            ? 'Adding this blocker would create a dependency cycle through a done task'
            : 'Adding this blocker would create a dependency cycle',
          steps.map((step) => step.title)
        )
      );
      return false;
    }
    this.tasks = next;
    const result = await this.#send({
      entityId: taskId,
      label: `Added a blocker to “${truncateTitle(target.title)}”`,
      request: {
        method: 'POST',
        path: '/api/tasks/{id}/blockers',
        pathParams: { id: taskId },
        body: { blocker_task_id: blockerTaskId },
      },
    });
    taskActivity.invalidate(taskId);
    if (result.status === 'failed') {
      await this.#cycleConflictOrFail(result.error);
      return false;
    }
    return true;
  }

  async removeBlocker(taskId: string, blockerTaskId: string): Promise<void> {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId
        ? { ...task, blocker_ids: task.blocker_ids.filter((id) => id !== blockerTaskId) }
        : task
    );
    const title = this.tasks.find((task) => task.id === taskId)?.title ?? '';
    const result = await this.#send({
      entityId: taskId,
      label: `Removed a blocker from “${truncateTitle(title)}”`,
      request: {
        method: 'DELETE',
        path: '/api/tasks/{id}/blockers/{blockerTaskId}',
        pathParams: { id: taskId, blockerTaskId },
      },
    });
    if (result.status === 'failed') {
      await this.#mutationFailed(result.error);
    }
    taskActivity.invalidate(taskId);
  }

  get filters(): BoardFilters {
    return {
      labelIds: this.filterLabelIds,
      assigneeIds: this.filterAssigneeIds,
      query: this.filterQuery,
    };
  }

  get filterSearch(): string {
    return filtersToSearch(this.filters);
  }

  setFilters(filters: BoardFilters): void {
    const labelIds = this.#knownLabelIds(filters.labelIds);
    if (filtersToSearch({ ...filters, labelIds }) !== this.filterSearch) {
      this.filterLabelIds = labelIds;
      this.filterAssigneeIds = filters.assigneeIds;
      this.filterQuery = filters.query;
    }
    // Written even when nothing changed: an incoming URL can name a filter the store
    // has already dropped, and only this takes it back out of the address bar.
    this.#writeFilterUrl();
  }

  // An id the loaded project does not know — a deleted label, or one from another
  // project's link — would dim the whole board with no chip to unpress.
  #knownLabelIds(labelIds: string[]): string[] {
    if (this.project === null) {
      return labelIds;
    }
    return labelIds.filter((id) => this.labels.some((label) => label.id === id));
  }

  // A task URL names no project, so an id comparison alone would silently stop
  // syncing filters to the address bar whenever an overlay is open.
  #routeTargetsCurrentProject(params: { projectId: string | null; taskId?: string }): boolean {
    if (params.projectId !== null) {
      return params.projectId === this.currentProjectId;
    }
    return (
      params.taskId !== undefined &&
      (this.tasks.some((t) => t.id === params.taskId) ||
        this.archivedTasks.some((t) => t.id === params.taskId))
    );
  }

  #writeFilterUrl(): void {
    const route = router.current;
    if (
      !this.#ownsFilterUrl ||
      route.name !== 'project' ||
      !this.#routeTargetsCurrentProject(route.params)
    ) {
      return;
    }
    const { pathname, search } = splitPath(router.path);
    const next = mergeFilterSearch(search, this.filters);
    if (search === next) {
      return;
    }
    // Replaces, so a run of filter edits collapses into one history entry.
    router.redirect(pathname + next);
  }

  toggleLabelFilter(labelId: string): void {
    this.setFilters({
      ...this.filters,
      labelIds: this.filterLabelIds.includes(labelId)
        ? this.filterLabelIds.filter((id) => id !== labelId)
        : [...this.filterLabelIds, labelId],
    });
  }

  toggleAssigneeFilter(userId: string): void {
    this.setFilters({
      ...this.filters,
      assigneeIds: this.filterAssigneeIds.includes(userId)
        ? this.filterAssigneeIds.filter((id) => id !== userId)
        : [...this.filterAssigneeIds, userId],
    });
  }

  setFilterQuery(query: string): void {
    this.setFilters({ ...this.filters, query });
  }

  clearFilters(): void {
    this.setFilters(noFilters());
  }

  // Derived rather than computed per read: the board reads these once per column
  // per render, and every card read the query through taskMatchesFilters.
  readonly doneColumnIds: ReadonlySet<string> = $derived(
    new Set(this.columns.filter((column) => column.is_done).map((column) => column.id))
  );

  readonly #normalizedQuery: string = $derived(this.filterQuery.trim().toLowerCase());

  readonly hasActiveFilters: boolean = $derived(
    this.filterLabelIds.length > 0 ||
      this.filterAssigneeIds.length > 0 ||
      this.#normalizedQuery !== ''
  );

  /** Changes only when the filter changes in a way that can repartition a column. */
  readonly filterSignature: string = $derived(
    JSON.stringify([this.#normalizedQuery, this.filterLabelIds, this.filterAssigneeIds])
  );

  taskMatchesFilters(task: BoardTask): boolean {
    const labelOk =
      this.filterLabelIds.length === 0 ||
      task.label_ids.some((id) => this.filterLabelIds.includes(id));
    const assigneeOk =
      this.filterAssigneeIds.length === 0 ||
      task.assignee_ids.some((id) => this.filterAssigneeIds.includes(id));
    const query = this.#normalizedQuery;
    const queryOk = query === '' || task.title.toLowerCase().includes(query);
    return labelOk && assigneeOk && queryOk;
  }

  // Copies: the board hands this straight to svelte-dnd-action, which reorders
  // it as its own drag state, and the grouped cache behind tasksInColumn is
  // shared with every other reader.
  displayTasksInColumn(columnId: string): BoardTask[] {
    const tasks = this.tasksInColumn(columnId);
    if (!this.hasActiveFilters) {
      return [...tasks];
    }
    const matches: BoardTask[] = [];
    const rest: BoardTask[] = [];
    for (const task of tasks) {
      (this.taskMatchesFilters(task) ? matches : rest).push(task);
    }
    return [...matches, ...rest];
  }

  matchingCountInColumn(columnId: string): number {
    let count = 0;
    for (const task of this.tasksInColumn(columnId)) {
      if (this.taskMatchesFilters(task)) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * The three caches live on their sub-stores; these are the names every consumer
   * already reads and writes, so the move is invisible outside this file.
   *
   * Accessor pairs, not bare getters: `load`, `refetch` and `reset` below all
   * assign to them, as do the component tests. A getter alone would be a
   * TypeError at the first write.
   *
   * A getter is enough for the read half — it calls through to the sub-store's
   * `$state` at access time, inside the reading component's reaction, which is
   * where the subscription has to land. board-substores.svelte.test.ts is the
   * proof, and fails if either half is dropped.
   */
  get taskComments(): Record<string, TaskComment[]> {
    return this.#comments.byTask;
  }

  set taskComments(next: Record<string, TaskComment[]>) {
    this.#comments.byTask = next;
  }

  get taskChecklists(): Record<string, ChecklistItem[]> {
    return this.#checklists.byTask;
  }

  set taskChecklists(next: Record<string, ChecklistItem[]>) {
    this.#checklists.byTask = next;
  }

  get taskAttachments(): Record<string, TaskAttachment[]> {
    return this.#attachments.byTask;
  }

  set taskAttachments(next: Record<string, TaskAttachment[]>) {
    this.#attachments.byTask = next;
  }

  // Everything the card's own Dates panel needs, so it never reads the project's
  // series list to render one card's recurrence.
  taskSeriesRefs = $state<Record<string, TaskSeriesRef | null>>({});

  setTaskSeriesRef(taskId: string, ref: TaskSeriesRef | null): void {
    this.taskSeriesRefs = { ...this.taskSeriesRefs, [taskId]: ref };
  }

  // Series events reach the board only for the card the overlay has open: a
  // deleted series must stop being named there, and an edited rule must not go
  // on showing the wording it had before the edit.
  applySeriesRealtime(event: RealtimeEvent): void {
    if (event.type === 'series_deleted') {
      const { id } = event.data;
      this.#mapSeriesRefs((ref) => (ref.id === id ? null : ref));
    } else if (event.type === 'series_updated') {
      const row = event.data;
      // Every field, not just the wording: the panel preselects from `preset` and
      // labels its options from `start_date`, so refreshing the summary alone
      // would leave an edited rule described correctly and edited wrongly.
      this.#mapSeriesRefs((ref) =>
        ref.id === row.id
          ? {
              id: row.id,
              summary: row.summary,
              preset: row.preset,
              start_date: row.start_date,
            }
          : ref
      );
    }
  }

  #mapSeriesRefs(patch: (ref: TaskSeriesRef) => TaskSeriesRef | null): void {
    let changed = false;
    const next: Record<string, TaskSeriesRef | null> = {};
    for (const [taskId, ref] of Object.entries(this.taskSeriesRefs)) {
      const updated = ref === null ? null : patch(ref);
      if (updated !== ref) changed = true;
      next[taskId] = updated;
    }
    if (changed) {
      this.taskSeriesRefs = next;
    }
  }

  async loadTaskDetail(taskId: string): Promise<void> {
    try {
      const data = assertOk(await api.GET('/api/tasks/{id}', { params: { path: { id: taskId } } }));
      this.taskComments = { ...this.taskComments, [taskId]: data.comments ?? [] };
      this.taskChecklists = { ...this.taskChecklists, [taskId]: data.checklist_items ?? [] };
      this.taskSeriesRefs = { ...this.taskSeriesRefs, [taskId]: data.series };
      this.taskAttachments = { ...this.taskAttachments, [taskId]: data.attachments ?? [] };
      // Heals a card face whose realtime event was missed; short of a full board
      // refetch this is the only authoritative read of the counts and the cover.
      this.tasks = this.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              comment_count: data.comment_count ?? 0,
              checklist_item_count: data.checklist_item_count ?? 0,
              checklist_done_count: data.checklist_done_count ?? 0,
              attachment_count: (data.attachments ?? []).length,
              cover_image_url: data.cover_image_url ?? null,
            }
          : task
      );
    } catch (error) {
      toasts.error(apiMessage(error, 'Failed to load task details'));
    }
  }

  // Everything below delegates to a sub-store. The bodies moved; the names did
  // not, so every caller — 13 files, plus the board's own realtime switch — is
  // untouched by the split.

  createComment(taskId: string, body: CommentBody): Promise<void> {
    return this.#comments.create(taskId, body);
  }

  updateComment(taskId: string, commentId: string, body: CommentBody): Promise<boolean> {
    return this.#comments.update(taskId, commentId, body);
  }

  deleteComment(taskId: string, commentId: string): Promise<void> {
    return this.#comments.remove(taskId, commentId);
  }

  addChecklistItem(taskId: string, text: string): Promise<void> {
    return this.#checklists.add(taskId, text);
  }

  setChecklistItemChecked(taskId: string, itemId: string, checked: boolean): Promise<void> {
    return this.#checklists.setChecked(taskId, itemId, checked);
  }

  renameChecklistItem(taskId: string, itemId: string, text: string): Promise<void> {
    return this.#checklists.rename(taskId, itemId, text);
  }

  moveChecklistItem(taskId: string, itemId: string, placement: Placement): Promise<void> {
    return this.#checklists.move(taskId, itemId, placement);
  }

  deleteChecklistItem(taskId: string, itemId: string): Promise<void> {
    return this.#checklists.remove(taskId, itemId);
  }

  promoteChecklistItem(taskId: string, itemId: string): Promise<string | null> {
    return this.#checklists.promote(taskId, itemId);
  }

  uploadTaskAttachment(taskId: string, file: File): Promise<TaskAttachment | null> {
    return this.#attachments.upload(taskId, file);
  }

  addLinkAttachment(taskId: string, url: string): Promise<void> {
    return this.#attachments.addLink(taskId, url);
  }

  patchAttachment(
    taskId: string,
    id: string,
    patch: { title?: string | null; description?: string | null }
  ): Promise<void> {
    return this.#attachments.patch(taskId, id, patch);
  }

  deleteAttachment(taskId: string, id: string): Promise<void> {
    return this.#attachments.remove(taskId, id);
  }

  downloadAttachment(attachment: TaskAttachment): Promise<void> {
    return this.#attachments.download(attachment);
  }

  // Idempotent direct patches from realtime events; an echo of our own mutation
  // re-applies the same values and is a no-op.
  applyRealtime(event: RealtimeEvent): void {
    if (this.readonly || event.project_id !== this.currentProjectId) {
      return;
    }
    switch (event.type) {
      case 'task_created': {
        const incoming = event.data;
        const task = {
          ...incoming,
          comment_count: incoming.comment_count ?? 0,
          attachment_count: incoming.attachment_count ?? 0,
        };
        this.tasks = upsertById(this.tasks, task);
        break;
      }
      case 'task_updated': {
        // Update-only: a task_updated for a task we no longer hold means it was
        // deleted (a locally-deleted task whose in-flight edit — e.g. the detail
        // overlay's autosave flushed on close — lands after our optimistic remove).
        // Re-adding it here would resurrect a phantom node in the graph.
        const incoming = event.data;
        // An API pod that predates comments omits comment_count; replacing the whole
        // task with its payload would otherwise blank the badge until a full refetch.
        this.tasks = patchById(this.tasks, incoming.id, (t) => ({
          ...incoming,
          comment_count: incoming.comment_count ?? t.comment_count,
          attachment_count: incoming.attachment_count ?? t.attachment_count,
        }));
        taskActivity.invalidate(incoming.id);
        break;
      }
      case 'task_deleted': {
        const { id } = event.data;
        this.#dropTasks([id]);
        this.archivedTasks = removeById(this.archivedTasks, id);
        break;
      }
      case 'task_archived': {
        const archived = event.data;
        this.#dropTasks([archived.id]);
        // Prepended, not upsertById's append: the archive reads newest first.
        this.archivedTasks = this.archivedTasks.some((t) => t.id === archived.id)
          ? patchById(this.archivedTasks, archived.id, () => archived)
          : [archived, ...this.archivedTasks];
        taskActivity.invalidate(archived.id);
        break;
      }
      case 'task_restored': {
        const restored = event.data;
        this.archivedTasks = removeById(this.archivedTasks, restored.id);
        this.tasks = upsertById(this.tasks, restored);
        taskActivity.invalidate(restored.id);
        break;
      }
      case 'task_relations_set': {
        const d = event.data;
        this.tasks = patchById(this.tasks, d.task_id, (t) => ({
          ...t,
          label_ids: d.label_ids,
          assignee_ids: d.assignee_ids,
          blocker_ids: d.blocker_ids,
          open_cross_project_blocker_count: d.open_cross_project_blocker_count,
        }));
        taskActivity.invalidate(d.task_id);
        crossProjectDeps.invalidate(d.task_id);
        break;
      }
      // The far side of an edge changing done state reaches this board as a
      // recount and nothing else — it names no card here, and the card it is
      // about may be one this viewer cannot see.
      case 'cross_project_blockers_changed': {
        const incoming = new Map(
          event.data.tasks.map((t) => [t.task_id, t.open_cross_project_blocker_count])
        );
        this.tasks = this.tasks.map((t) => {
          const count = incoming.get(t.id);
          return count === undefined ? t : { ...t, open_cross_project_blocker_count: count };
        });
        for (const task of event.data.tasks) {
          crossProjectDeps.invalidate(task.task_id);
        }
        break;
      }
      case 'column_created':
      case 'column_updated': {
        const column = event.data;
        this.columns = upsertById(this.columns, column, byRank);
        break;
      }
      case 'column_deleted': {
        const d = event.data;
        this.columns = removeById(this.columns, d.id);
        const moved = new Map(d.moved_tasks.map((m) => [m.id, m]));
        const relocate = <T extends { id: string; column_id: string; sort_key: string }>(
          task: T
        ): T => {
          const m = moved.get(task.id);
          return m === undefined ? task : { ...task, column_id: m.column_id, sort_key: m.sort_key };
        };
        this.tasks = this.tasks.map(relocate).filter((t) => t.column_id !== d.id);
        this.archivedTasks = this.archivedTasks.map(relocate).filter((t) => t.column_id !== d.id);
        for (const movedTask of d.moved_tasks) {
          taskActivity.invalidate(movedTask.id);
        }
        break;
      }
      case 'column_tasks_moved':
      case 'bulk_tasks_moved': {
        const d = event.data;
        const moved = new Map(d.moved_tasks.map((m) => [m.id, m]));
        this.tasks = this.tasks.map((t) => {
          const m = moved.get(t.id);
          return m === undefined ? t : { ...t, column_id: m.column_id, sort_key: m.sort_key };
        });
        for (const movedTask of d.moved_tasks) {
          taskActivity.invalidate(movedTask.id);
        }
        break;
      }
      case 'column_tasks_reordered': {
        // No column change, so only ranks move; no activity to invalidate.
        const d = event.data;
        const moved = new Map(d.moved_tasks.map((m) => [m.id, m]));
        this.tasks = this.tasks.map((t) => {
          const m = moved.get(t.id);
          return m === undefined ? t : { ...t, sort_key: m.sort_key };
        });
        break;
      }
      case 'column_tasks_archived':
      case 'bulk_tasks_archived': {
        const d = event.data;
        this.#dropTasks(d.tasks.map((t) => t.id));
        const incoming = new Map(d.tasks.map((t) => [t.id, t]));
        const heldIds = new Set(this.archivedTasks.map((t) => t.id));
        this.archivedTasks = [
          ...d.tasks.filter((t) => !heldIds.has(t.id)),
          ...this.archivedTasks.map((held) => incoming.get(held.id) ?? held),
        ];
        for (const task of d.tasks) {
          taskActivity.invalidate(task.id);
        }
        break;
      }
      case 'bulk_tasks_relations_set': {
        const d = event.data;
        const incoming = new Map(d.tasks.map((t) => [t.task_id, t]));
        this.tasks = this.tasks.map((t) => {
          const relations = incoming.get(t.id);
          return relations === undefined
            ? t
            : {
                ...t,
                label_ids: relations.label_ids,
                assignee_ids: relations.assignee_ids,
                blocker_ids: relations.blocker_ids,
                open_cross_project_blocker_count: relations.open_cross_project_blocker_count,
              };
        });
        for (const task of d.tasks) {
          taskActivity.invalidate(task.task_id);
          crossProjectDeps.invalidate(task.task_id);
        }
        break;
      }
      case 'label_created':
      case 'label_updated': {
        const label = event.data;
        this.labels = upsertById(this.labels, label);
        break;
      }
      case 'label_deleted': {
        const { id } = event.data;
        this.labels = removeById(this.labels, id);
        this.tasks = this.tasks.map((t) =>
          t.label_ids.includes(id) ? { ...t, label_ids: t.label_ids.filter((l) => l !== id) } : t
        );
        this.setFilters({
          ...this.filters,
          labelIds: this.filterLabelIds.filter((l) => l !== id),
        });
        break;
      }
      case 'attachment_created': {
        const d = event.data;
        this.#attachments.setCount(d.task_id, () => d.attachment_count);
        // Skips the adder's own echo, which the optimistic append already placed.
        this.#attachments.replace(d.task_id, (attachments) =>
          attachments.some((a) => a.id === d.id) ? attachments : [...attachments, d]
        );
        break;
      }
      case 'attachment_updated': {
        const d = event.data;
        this.#attachments.replace(d.task_id, (attachments) =>
          patchById(attachments, d.id, () => d)
        );
        break;
      }
      case 'attachment_deleted': {
        const d = event.data;
        this.#attachments.setCount(d.task_id, () => d.attachment_count);
        this.#attachments.replace(d.task_id, (attachments) => removeById(attachments, d.id));
        // The cover lives on the row, so a delete can clear it. This is the only
        // event that reports one now.
        this.tasks = patchById(this.tasks, d.task_id, (t) => ({
          ...t,
          cover_image_url: d.cover_image_url ?? null,
        }));
        break;
      }
      case 'comment_created': {
        const d = event.data;
        this.#comments.setCount(d.task_id, () => d.comment_count);
        const comment: TaskComment = {
          id: d.id,
          task_id: d.task_id,
          user_id: d.user_id,
          body: d.body,
          created_at: d.created_at,
          updated_at: d.updated_at,
        };
        // Skips the author's own echo, which the optimistic append already placed.
        this.#comments.replace(d.task_id, (comments) =>
          comments.some((c) => c.id === comment.id)
            ? comments
            : [...comments, comment].sort(chronological)
        );
        break;
      }
      case 'comment_updated': {
        const d = event.data;
        this.#comments.replace(d.task_id, (comments) =>
          patchById(comments, d.id, (c) => ({ ...c, body: d.body, updated_at: d.updated_at }))
        );
        break;
      }
      case 'comment_deleted': {
        const d = event.data;
        this.#comments.setCount(d.task_id, () => d.comment_count);
        this.#comments.replace(d.task_id, (comments) => removeById(comments, d.id));
        break;
      }
      case 'checklist_item_created':
      case 'checklist_item_updated': {
        const d = event.data;
        this.#checklists.setCounts(d.task_id, () => ({
          total: d.checklist_item_count,
          done: d.checklist_done_count,
        }));
        const item: ChecklistItem = {
          id: d.id,
          task_id: d.task_id,
          text: d.text,
          checked: d.checked,
          sort_key: d.sort_key,
          created_at: d.created_at,
          updated_at: d.updated_at,
        };
        this.#checklists.replace(d.task_id, (items) => upsertById(items, item, byRank));
        // A reposition writes no activity entry, but the event cannot say which kind
        // of patch it was; the store's refresh collapses a burst into one fetch.
        taskActivity.invalidate(d.task_id);
        break;
      }
      case 'checklist_item_deleted': {
        const d = event.data;
        this.#checklists.setCounts(d.task_id, () => ({
          total: d.checklist_item_count,
          done: d.checklist_done_count,
        }));
        this.#checklists.replace(d.task_id, (items) => removeById(items, d.id));
        taskActivity.invalidate(d.task_id);
        break;
      }
      // The name carries the board's URL slug, so a teammate's rename has to reach
      // the header and the address bar alike. created_by counts as membership
      // because the creator is an implicit editor, so a transfer that left it
      // behind would strip the new owner's editing and keep offering it to the old
      // one.
      case 'project_updated': {
        const d = event.data;
        const project = this.project;
        if (project === null) {
          break;
        }
        this.project = {
          ...project,
          name: d.name ?? project.name,
          created_by: d.created_by ?? project.created_by,
          members: d.members ?? project.members,
          member_ids: d.member_ids ?? project.member_ids,
          // Not `??`: null is the color "None", and coalescing it would keep
          // showing the old one after a teammate cleared it.
          color: d.color !== undefined ? d.color : project.color,
        };
        break;
      }
    }
  }

  /**
   * Every board write goes through here so that "offline" is decided in one
   * place rather than at forty call sites. When the server is reachable this is
   * the request it always was; when it is not, the change is queued and the
   * optimistic update the caller already applied simply stands.
   */
  async #send<T>(input: Omit<SubmitInput, 'projectId'>): Promise<SubmitResult<T>> {
    return outbox.submit<T>({ projectId: this.currentProjectId ?? '', ...input });
  }

  async #mutationFailed(error: unknown): Promise<void> {
    // Queued mutations never reach here — they are held rather than failed. What
    // is left is the handful the outbox does not carry, chiefly attachments, and
    // "something went wrong" is a poor description of a missing network when the
    // app already knows that is what happened.
    if (!(error instanceof ApiError) && !connectivity.reachable) {
      toasts.error('You are offline. This one could not be saved and was not queued.');
      return;
    }
    toasts.error(apiMessage(error, 'Something went wrong'));
    await this.resync();
  }

  async #cycleConflictOrFail(error: unknown): Promise<void> {
    const named = cycleFromApiError(error);
    if (named === null) {
      await this.#mutationFailed(error);
      return;
    }
    this.#showCyclePath(named.cycle);
    toasts.error(
      cycleMessage(
        named.message,
        named.cycle.map((step) => step.title)
      )
    );
    await this.refetch({ quiet: true });
  }

  // Duplicate-name 409s are rethrown after resync so callers can surface them inline.
  async #labelConflictOrFail(error: unknown): Promise<void> {
    if (error instanceof ApiError && error.status === 409) {
      await this.refetch({ quiet: true });
      throw error;
    }
    await this.#mutationFailed(error);
  }
}

export const board = new BoardStore();

// A card acted on from a screen outside its project needs that project's columns,
// labels and cards; loading them here would tear down the board the user is
// looking at, so a second store holds them instead.
export const awayBoard = new BoardStore({ ownsFilterUrl: false });

export type BoardContext = typeof board;
