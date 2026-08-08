import { SvelteSet } from 'svelte/reactivity';
import { api, ApiError, assertOk } from '../api/client';
import type { components } from '../api/api.generated';
import { filtersToSearch, mergeFilterSearch, noFilters, type BoardFilters } from './board-filters';
import type {
  ArchivedTask,
  BoardColumn,
  BoardLabel,
  BoardProject,
  BoardTask,
  ChecklistItem,
  CycleTask,
  PublicBoardPayload,
} from './board-types';
import { type ColumnSort, sortTasks } from './column-sort';
import { saveBlob } from './export';
import { buildGraph, cycleNodeIds, cyclePathIds } from './graph';
import { newId } from './ids';
import type { RealtimeEvent } from './realtime-types';
import {
  append,
  appendRun,
  between,
  byRank,
  placeAtIndex,
  restack,
  type Placement,
  type Ranked,
} from './positions';
import { canEditProject } from './roles';
import { router, splitPath } from './router.svelte';
import { projects } from './projects.svelte';
import { session } from './session.svelte';
import { crossProjectDeps } from './crossProjectDeps.svelte';
import { taskActivity } from './taskActivity.svelte';
import { truncateTitle } from './titles';
import { toasts } from './toasts.svelte';
import { users, type User } from './users.svelte';

export type TaskAttachment = components['schemas']['Attachment'];
export type TaskComment = components['schemas']['Comment'];
export type CommentBody = TaskComment['body'];

type BulkRelationsResponse = components['schemas']['BulkTaskRelationsResponse'];

export type TaskUpdateOutcome =
  | { status: 'ok'; updated_at: string }
  | { status: 'conflict' }
  | { status: 'error' };

// Anchors on the visual neighbor above the drop, so it stays correct when the
// display order is a filtered partition rather than pure position order.
export function placementAfterDrop(items: readonly Ranked[], movedId: string): Placement {
  const index = items.findIndex((item) => item.id === movedId);
  const others = items.filter((item) => item.id !== movedId);
  if (index === -1) {
    return append(others);
  }
  if (index === 0) {
    return placeAtIndex(others, 0);
  }
  // Anchors on the visual neighbour above the drop, then takes the lowest-ranked
  // sibling above it, so the placement stays right when the display is a
  // filtered partition rather than the whole column.
  const previous = items[index - 1]!;
  // Strictly greater by key, not by rank: a sibling that merely ties on key and
  // loses the id tiebreak is not something to squeeze in front of.
  const above = (candidate: Ranked): boolean =>
    previous.sort_key === null
      ? candidate.sort_key !== null
      : candidate.sort_key !== null && candidate.sort_key > previous.sort_key;
  let next: Ranked | null = null;
  for (const item of others) {
    if (above(item) && (next === null || byRank(item, next) < 0)) {
      next = item;
    }
  }
  return next === null ? append(others) : between(previous, next);
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

function optimisticTask(
  id: string,
  columnId: string,
  title: string,
  placement: Placement
): BoardTask {
  const now = new Date().toISOString();
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    sort_key: placement.sort_key,
    due_date: null,
    created_at: now,
    updated_at: now,
    column_since: now,
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    cover_image_url: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
  };
}

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

function chronological(a: TaskComment, b: TaskComment): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

function byPosition(a: ChecklistItem, b: ChecklistItem): number {
  return byRank(a, b);
}

class BoardStore {
  project = $state<BoardProject | null>(null);
  columns = $state<BoardColumn[]>([]);
  tasks = $state<BoardTask[]>([]);
  labels = $state<BoardLabel[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  errorStatus = $state<number | null>(null);
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

  // Only the board on screen owns the address bar. A second one loaded for a card
  // on another project has no filters of its own, and a response landing after the
  // user walks onto that same project would strip theirs out of the URL.
  constructor({ ownsFilterUrl = true }: { ownsFilterUrl?: boolean } = {}) {
    this.#ownsFilterUrl = ownsFilterUrl;
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
      // Stale-while-revalidate: serve the cached board flicker-free.
      if (!this.loading) {
        void this.refetch();
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

  // `quiet` suppresses the error page for reads that merely supplement an action
  // that already succeeded.
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
    } catch (error) {
      if (token !== this.#fetchToken || quiet) {
        return;
      }
      this.error = error instanceof ApiError ? error.message : 'Failed to load board';
      this.errorStatus = error instanceof ApiError ? error.status : null;
    }
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
      this.archivedError = error instanceof ApiError ? error.message : 'Failed to load the archive';
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
  // has to come through here instead.
  async resync(): Promise<void> {
    await this.refetch();
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
      items.sort(byPosition);
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
    this.taskSeriesSummaries = {};
    this.taskAttachments = {};
    this.loading = false;
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
    try {
      const created = assertOk(
        await api.POST('/api/tasks', {
          body: { id, project_id: projectId, column_id: columnId, title, ...placement },
        })
      );
      this.#adoptTimestamps(id, {
        created_at: created.created_at,
        updated_at: created.updated_at,
      });
      return id;
    } catch (error) {
      await this.#mutationFailed(error);
      return null;
    }
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
    try {
      const data = assertOk(
        await api.POST('/api/tasks/batch', {
          body: {
            project_id: projectId,
            column_id: columnId,
            tasks: created.map((task) => ({
              id: task.id,
              title: task.title,
              sort_key: task.sort_key,
            })),
          },
        })
      );
      this.#adoptTimestampsFrom(data.tasks);
      return created.map((task) => task.id);
    } catch (error) {
      await this.#mutationFailed(error);
      return null;
    }
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
    try {
      const created = assertOk(
        await api.POST('/api/tasks/{id}/duplicate', {
          params: { path: { id: taskId } },
          body: { id, ...placement },
        })
      );
      this.tasks = this.tasks.map((task) =>
        task.id === id ? mergeCopy(optimistic, task, created) : task
      );
      return id;
    } catch (error) {
      await this.#mutationFailed(error);
      return null;
    }
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

  async moveTask(taskId: string, columnId: string, placement: Placement): Promise<void> {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId ? { ...task, column_id: columnId, ...placement } : task
    );
    try {
      assertOk(
        await api.PATCH('/api/tasks/{id}', {
          params: { path: { id: taskId } },
          body: { column_id: columnId, ...placement },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    } finally {
      // In `finally`, not on success: a failed move resyncs the board, and the log
      // has to end up showing what the server kept.
      taskActivity.invalidate(taskId);
    }
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

  async updateTask(
    taskId: string,
    patch: {
      title?: string;
      description?: BoardTask['description'];
      due_date?: BoardTask['due_date'];
    },
    expectedUpdatedAt?: string
  ): Promise<TaskUpdateOutcome> {
    this.tasks = this.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
    try {
      const data = assertOk(
        await api.PATCH('/api/tasks/{id}', {
          params: { path: { id: taskId } },
          body: {
            ...patch,
            ...(expectedUpdatedAt !== undefined ? { expected_updated_at: expectedUpdatedAt } : {}),
          },
        })
      );
      this.#adoptTimestamps(taskId, { updated_at: data.updated_at });
      return { status: 'ok', updated_at: data.updated_at };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // No toast: the caller owns the conflict surface, and the refetch is what
        // lets it offer the server's current version.
        await this.refetch();
        return { status: 'conflict' };
      }
      await this.#mutationFailed(error);
      return { status: 'error' };
    } finally {
      taskActivity.invalidate(taskId);
    }
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
    this.#dropTasks([taskId]);
    this.#discardArchivedLoad();
    this.archivedTasks = this.archivedTasks.filter((task) => task.id !== taskId);
    try {
      assertOk(await api.DELETE('/api/tasks/{id}', { params: { path: { id: taskId } } }));
    } catch (error) {
      await this.#mutationFailed(error);
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
    try {
      const archived = assertOk(
        await api.POST('/api/tasks/{id}/archive', { params: { path: { id: taskId } } })
      );
      this.archivedTasks = this.archivedTasks.map((t) => (t.id === taskId ? archived : t));
    } catch (error) {
      this.archivedTasks = this.archivedTasks.filter((t) => t.id !== taskId);
      await this.#mutationFailed(error);
    } finally {
      taskActivity.invalidate(taskId);
    }
  }

  async restoreTask(taskId: string): Promise<void> {
    this.#discardArchivedLoad();
    this.archivedTasks = this.archivedTasks.filter((t) => t.id !== taskId);
    try {
      const restored = assertOk(
        await api.POST('/api/tasks/{id}/restore', { params: { path: { id: taskId } } })
      );
      this.tasks = this.tasks.some((t) => t.id === restored.id)
        ? this.tasks.map((t) => (t.id === restored.id ? restored : t))
        : [...this.tasks, restored];
      // The tasks this one blocks are not derivable from the response, and only
      // a board read names that direction.
      await this.refetch({ quiet: true });
    } catch (error) {
      await this.#mutationFailed(error);
    } finally {
      taskActivity.invalidate(taskId);
    }
  }

  async createColumn(name: string): Promise<void> {
    const projectId = this.currentProjectId;
    if (projectId === null) {
      return;
    }
    const id = newId();
    const placement = append(this.columns);
    this.columns = [...this.columns, { id, name, ...placement, is_done: false }];
    try {
      assertOk(
        await api.POST('/api/columns', { body: { id, project_id: projectId, name, ...placement } })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async renameColumn(columnId: string, name: string): Promise<void> {
    this.columns = this.columns.map((column) =>
      column.id === columnId ? { ...column, name } : column
    );
    try {
      assertOk(
        await api.PATCH('/api/columns/{id}', { params: { path: { id: columnId } }, body: { name } })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async moveColumn(columnId: string, placement: Placement): Promise<void> {
    this.columns = this.columns
      .map((column) => (column.id === columnId ? { ...column, ...placement } : column))
      .sort(byRank);
    try {
      assertOk(
        await api.PATCH('/api/columns/{id}', {
          params: { path: { id: columnId } },
          body: { ...placement },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async toggleColumnDone(columnId: string): Promise<void> {
    const column = this.columns.find((c) => c.id === columnId);
    if (column === undefined) {
      return;
    }
    const is_done = !column.is_done;
    this.columns = this.columns.map((c) => (c.id === columnId ? { ...c, is_done } : c));
    try {
      assertOk(
        await api.PATCH('/api/columns/{id}', {
          params: { path: { id: columnId } },
          body: { is_done },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error);
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
    try {
      const data = assertOk(
        await api.POST('/api/columns/{id}/duplicate', {
          params: { path: { id: columnId } },
          body: { id, ...placement },
        })
      );
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
    } catch (error) {
      await this.#mutationFailed(error);
    }
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
    try {
      const data = assertOk(
        await api.DELETE('/api/columns/{id}', {
          params: {
            path: { id: columnId },
            query: moveTasksTo === undefined ? undefined : { move_tasks_to: moveTasksTo },
          },
        })
      );
      if (data !== undefined) {
        const byId = new Map(data.moved_tasks.map((task) => [task.id, task]));
        const apply = <T extends { id: string; column_id: string; sort_key: string }>(
          task: T
        ): T => {
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
    } catch (error) {
      await this.#mutationFailed(error);
    } finally {
      for (const task of [...movedLive, ...movedArchived]) {
        taskActivity.invalidate(task.id);
      }
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
    try {
      const data = assertOk(
        await api.POST('/api/columns/{id}/move-tasks', {
          params: { path: { id: columnId } },
          body: { target_column_id: targetColumnId },
        })
      );
      const byId = new Map(data.moved_tasks.map((task) => [task.id, task]));
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
    } catch (error) {
      await this.#mutationFailed(error);
    } finally {
      for (const task of moved) {
        taskActivity.invalidate(task.id);
      }
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
    try {
      const data = assertOk(
        await api.POST('/api/columns/{id}/reorder', {
          params: { path: { id: columnId } },
          body: { task_ids: orderedIds },
        })
      );
      const byId = new Map(data.moved_tasks.map((task) => [task.id, task]));
      this.tasks = this.tasks.map((task) => {
        const movedTask = byId.get(task.id);
        return movedTask === undefined ? task : { ...task, sort_key: movedTask.sort_key };
      });
    } catch (error) {
      await this.#mutationFailed(error);
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
    try {
      const data = assertOk(
        await api.POST('/api/columns/{id}/archive-tasks', { params: { path: { id: columnId } } })
      );
      const byId = new Map(data.tasks.map((task) => [task.id, task]));
      this.archivedTasks = this.archivedTasks.map((task) => byId.get(task.id) ?? task);
      // A card we dropped from the board but the server did not archive is gone
      // from both lists until something else refetches. Sets, not counts: an id we
      // did not send can mask one the server skipped.
      if (byId.size !== archivingIds.length || archivingIds.some((id) => !byId.has(id))) {
        await this.resync();
      }
    } catch (error) {
      const dropped = new Set(archivingIds);
      this.archivedTasks = this.archivedTasks.filter((task) => !dropped.has(task.id));
      await this.#mutationFailed(error);
    } finally {
      for (const id of archivingIds) {
        taskActivity.invalidate(id);
      }
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
    try {
      const data = assertOk(
        await api.POST('/api/tasks/bulk-move', {
          body: { project_id: projectId, task_ids: [...taskIds], column_id: columnId },
        })
      );
      const byId = new Map(data.moved_tasks.map((task) => [task.id, task]));
      this.tasks = this.tasks.map((task) => {
        const moved = byId.get(task.id);
        return moved === undefined
          ? task
          : { ...task, column_id: moved.column_id, sort_key: moved.sort_key };
      });
      if (
        this.#bulkSkipped('Moved', taskIds, data.skipped_task_ids) ||
        this.#bulkDisagrees(taskIds, byId)
      ) {
        await this.resync();
      }
    } catch (error) {
      await this.#mutationFailed(error);
    } finally {
      for (const id of taskIds) {
        taskActivity.invalidate(id);
      }
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
    try {
      const data = assertOk(
        await api.POST('/api/tasks/bulk-archive', {
          body: { project_id: projectId, task_ids: [...taskIds] },
        })
      );
      const byId = new Map(data.tasks.map((task) => [task.id, task]));
      this.archivedTasks = this.archivedTasks.map((task) => byId.get(task.id) ?? task);
      if (
        this.#bulkSkipped('Archived', taskIds, data.skipped_task_ids) ||
        this.#bulkDisagrees(taskIds, byId)
      ) {
        await this.resync();
      }
    } catch (error) {
      this.archivedTasks = this.archivedTasks.filter((task) => !wanted.has(task.id));
      await this.#mutationFailed(error);
    } finally {
      for (const id of taskIds) {
        taskActivity.invalidate(id);
      }
    }
  }

  async bulkSetLabel(taskIds: readonly string[], labelId: string, on: boolean): Promise<void> {
    await this.#bulkSetRelation(taskIds, 'label_ids', labelId, on, async (project_id, task_ids) =>
      assertOk(
        await api.POST('/api/tasks/bulk-labels', {
          body: {
            project_id,
            task_ids,
            ...(on ? { add_label_ids: [labelId] } : { remove_label_ids: [labelId] }),
          },
        })
      )
    );
  }

  async bulkSetAssignee(taskIds: readonly string[], userId: string, on: boolean): Promise<void> {
    await this.#bulkSetRelation(taskIds, 'assignee_ids', userId, on, async (project_id, task_ids) =>
      assertOk(
        await api.POST('/api/tasks/bulk-assignees', {
          body: {
            project_id,
            task_ids,
            ...(on ? { add_user_ids: [userId] } : { remove_user_ids: [userId] }),
          },
        })
      )
    );
  }

  async #bulkSetRelation(
    taskIds: readonly string[],
    field: 'label_ids' | 'assignee_ids',
    valueId: string,
    on: boolean,
    send: (projectId: string, taskIds: string[]) => Promise<BulkRelationsResponse>
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
    try {
      const data = await send(projectId, [...taskIds]);
      const byId = new Map(data.tasks.map((task) => [task.task_id, task]));
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
        this.#bulkSkipped('Updated', taskIds, data.skipped_task_ids) ||
        data.tasks.some((task) => !wanted.has(task.task_id))
      ) {
        await this.resync();
      }
    } catch (error) {
      await this.#mutationFailed(error);
    } finally {
      for (const id of taskIds) {
        taskActivity.invalidate(id);
      }
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
    try {
      assertOk(await api.POST('/api/labels', { body: { id, project_id: projectId, name, color } }));
    } catch (error) {
      await this.#labelConflictOrFail(error);
    }
  }

  async updateLabel(labelId: string, patch: { name?: string; color?: string }): Promise<void> {
    this.labels = this.labels.map((label) =>
      label.id === labelId ? { ...label, ...patch } : label
    );
    try {
      assertOk(
        await api.PATCH('/api/labels/{id}', { params: { path: { id: labelId } }, body: patch })
      );
    } catch (error) {
      await this.#labelConflictOrFail(error);
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
    try {
      assertOk(await api.DELETE('/api/labels/{id}', { params: { path: { id: labelId } } }));
    } catch (error) {
      await this.#mutationFailed(error);
    }
  }

  async setTaskLabels(taskId: string, labelIds: string[]): Promise<void> {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId ? { ...task, label_ids: labelIds } : task
    );
    try {
      assertOk(
        await api.PUT('/api/tasks/{id}/labels', {
          params: { path: { id: taskId } },
          body: { label_ids: labelIds },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    } finally {
      taskActivity.invalidate(taskId);
    }
  }

  async setTaskAssignees(taskId: string, userIds: string[]): Promise<void> {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId ? { ...task, assignee_ids: userIds } : task
    );
    try {
      assertOk(
        await api.PUT('/api/tasks/{id}/assignees', {
          params: { path: { id: taskId } },
          body: { user_ids: userIds },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    } finally {
      taskActivity.invalidate(taskId);
    }
  }

  // Takes the image rather than its id so the store never rebuilds the URL the
  // server owns.
  // Takes the attachment rather than its id so the store never rebuilds the URL
  // the server owns, and flips is_cover on the list it just moved the flag on.
  async setTaskCover(taskId: string, image: TaskAttachment | null): Promise<void> {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId ? { ...task, cover_image_url: image?.image_url ?? null } : task
    );
    this.#replaceAttachments(taskId, (attachments) =>
      attachments.map((entry) =>
        entry.kind === 'image' ? { ...entry, is_cover: entry.id === image?.id } : entry
      )
    );
    try {
      assertOk(
        await api.PUT('/api/tasks/{id}/cover', {
          params: { path: { id: taskId } },
          body: { image_id: image?.id ?? null },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    }
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
    try {
      assertOk(
        await api.POST('/api/tasks/{id}/blockers', {
          params: { path: { id: taskId } },
          body: { blocker_task_id: blockerTaskId },
        })
      );
      return true;
    } catch (error) {
      await this.#cycleConflictOrFail(error);
      return false;
    } finally {
      taskActivity.invalidate(taskId);
    }
  }

  async removeBlocker(taskId: string, blockerTaskId: string): Promise<void> {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId
        ? { ...task, blocker_ids: task.blocker_ids.filter((id) => id !== blockerTaskId) }
        : task
    );
    try {
      assertOk(
        await api.DELETE('/api/tasks/{id}/blockers/{blockerTaskId}', {
          params: { path: { id: taskId, blockerTaskId } },
        })
      );
    } catch (error) {
      await this.#mutationFailed(error);
    } finally {
      taskActivity.invalidate(taskId);
    }
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

  taskComments = $state<Record<string, TaskComment[]>>({});
  taskChecklists = $state<Record<string, ChecklistItem[]>>({});
  taskSeriesSummaries = $state<Record<string, string | null>>({});
  taskAttachments = $state<Record<string, TaskAttachment[]>>({});

  async loadTaskDetail(taskId: string): Promise<void> {
    try {
      const data = assertOk(await api.GET('/api/tasks/{id}', { params: { path: { id: taskId } } }));
      this.taskComments = { ...this.taskComments, [taskId]: data.comments ?? [] };
      this.taskChecklists = { ...this.taskChecklists, [taskId]: data.checklist_items ?? [] };
      this.taskSeriesSummaries = {
        ...this.taskSeriesSummaries,
        [taskId]: data.series_summary ?? null,
      };
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
      toasts.error(error instanceof ApiError ? error.message : 'Failed to load task details');
    }
  }

  // A no-op when the list is not cached, for the same reason the comment stream
  // is: the detail view fetches it on open, and seeding a partial list here
  // would leave that view showing only fragments.
  #replaceAttachments(
    taskId: string,
    next: (attachments: TaskAttachment[]) => TaskAttachment[]
  ): void {
    const cached = this.taskAttachments[taskId];
    if (cached === undefined) {
      return;
    }
    this.taskAttachments = { ...this.taskAttachments, [taskId]: next(cached) };
  }

  async uploadTaskAttachment(taskId: string, file: File): Promise<TaskAttachment | null> {
    try {
      const attachment = assertOk(
        await api.POST('/api/attachments/files', {
          params: {
            query: {
              task_id: taskId,
              filename: file.name || 'attachment',
              content_type: file.type || 'application/octet-stream',
            },
          },
          // The file is the body, so it is handed to fetch untouched: serialising
          // it would read the whole thing into memory on both ends of the wire.
          body: file as unknown as string,
          bodySerializer: (body: unknown) => body as BodyInit,
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      );
      // The realtime echo can land before this response does and append it already.
      const cached = this.taskAttachments[taskId] ?? [];
      if (!cached.some((existing) => existing.id === attachment.id)) {
        this.taskAttachments = { ...this.taskAttachments, [taskId]: [...cached, attachment] };
        this.#setAttachmentCount(taskId, (count) => count + 1);
      }
      return attachment;
    } catch (error) {
      toasts.error(error instanceof ApiError ? error.message : 'Attachment upload failed');
      return null;
    }
  }

  async addLinkAttachment(taskId: string, url: string): Promise<void> {
    const id = newId();
    const now = new Date().toISOString();
    const optimistic: TaskAttachment = {
      id,
      task_id: taskId,
      kind: 'link',
      // A link is neither an image nor a cover.
      image_url: null,
      is_cover: false,
      title: null,
      description: null,
      filename: null,
      content_type: null,
      size_bytes: null,
      url,
      preview_url: null,
      favicon_url: null,
      unfurl_state: 'pending',
      created_at: now,
      updated_at: now,
    };
    this.taskAttachments = {
      ...this.taskAttachments,
      [taskId]: [...(this.taskAttachments[taskId] ?? []), optimistic],
    };
    this.#setAttachmentCount(taskId, (count) => count + 1);
    try {
      const created = assertOk(
        await api.POST('/api/attachments/links', { body: { id, task_id: taskId, url } })
      );
      this.#replaceAttachments(taskId, (attachments) =>
        attachments.map((attachment) => (attachment.id === id ? created : attachment))
      );
    } catch (error) {
      await this.#mutationFailed(error);
      await this.loadTaskDetail(taskId);
    }
  }

  async patchAttachment(
    taskId: string,
    id: string,
    patch: { title?: string | null; description?: string | null }
  ): Promise<void> {
    this.#replaceAttachments(taskId, (attachments) =>
      attachments.map((attachment) =>
        attachment.id === id ? { ...attachment, ...patch } : attachment
      )
    );
    try {
      const updated = assertOk(
        await api.PATCH('/api/attachments/{id}', { params: { path: { id } }, body: patch })
      );
      this.#replaceAttachments(taskId, (attachments) =>
        attachments.map((attachment) => (attachment.id === id ? updated : attachment))
      );
    } catch (error) {
      await this.#mutationFailed(error);
      await this.loadTaskDetail(taskId);
    }
  }

  async deleteAttachment(taskId: string, id: string): Promise<void> {
    // The cover lives on the row, so removing that row takes the cover with it;
    // the card would otherwise keep pointing at bytes that are gone.
    const removed = (this.taskAttachments[taskId] ?? []).find((entry) => entry.id === id);
    if (removed?.is_cover === true) {
      this.tasks = this.tasks.map((task) =>
        task.id === taskId ? { ...task, cover_image_url: null } : task
      );
    }
    this.#replaceAttachments(taskId, (attachments) =>
      attachments.filter((attachment) => attachment.id !== id)
    );
    this.#setAttachmentCount(taskId, (count) => count - 1);
    try {
      assertOk(await api.DELETE('/api/attachments/{id}', { params: { path: { id } } }));
    } catch (error) {
      await this.#mutationFailed(error);
      await this.loadTaskDetail(taskId);
    }
  }

  async downloadAttachment(attachment: TaskAttachment): Promise<void> {
    try {
      const blob = assertOk(
        await api.GET('/api/attachments/{id}/download', {
          params: { path: { id: attachment.id } },
          parseAs: 'blob',
        })
      );
      saveBlob(blob as Blob, attachment.filename ?? 'attachment');
    } catch (error) {
      toasts.error(error instanceof ApiError ? error.message : 'Download failed');
    }
  }

  #setAttachmentCount(taskId: string, next: (current: number) => number): void {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId
        ? { ...task, attachment_count: Math.max(0, next(task.attachment_count ?? 0)) }
        : task
    );
  }

  #setCommentCount(taskId: string, next: (current: number) => number): void {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId ? { ...task, comment_count: next(task.comment_count ?? 0) } : task
    );
  }

  // A no-op when the stream is not cached: the detail view fetches it on open,
  // and seeding a partial list here would leave that view showing only fragments.
  #replaceComments(taskId: string, next: (comments: TaskComment[]) => TaskComment[]): void {
    const cached = this.taskComments[taskId];
    if (cached === undefined) {
      return;
    }
    this.taskComments = { ...this.taskComments, [taskId]: next(cached) };
  }

  async createComment(taskId: string, body: CommentBody): Promise<void> {
    const id = newId();
    const now = new Date().toISOString();
    const optimistic: TaskComment = {
      id,
      task_id: taskId,
      user_id: session.user?.id ?? '',
      body,
      created_at: now,
      updated_at: now,
    };
    this.#replaceComments(taskId, (comments) => [...comments, optimistic]);
    this.#setCommentCount(taskId, (count) => count + 1);
    try {
      const created = assertOk(
        await api.POST('/api/comments', { body: { id, task_id: taskId, body } })
      );
      // A detail fetch landing mid-flight replaces the whole stream, so the
      // optimistic row may be gone and the server row has to be re-inserted.
      if (this.taskComments[taskId] === undefined) {
        await this.loadTaskDetail(taskId);
        return;
      }
      this.#replaceComments(taskId, (comments) =>
        comments.some((comment) => comment.id === id)
          ? comments.map((comment) => (comment.id === id ? created : comment))
          : [...comments, created].sort(chronological)
      );
    } catch (error) {
      await this.#mutationFailed(error);
      await this.loadTaskDetail(taskId);
    }
  }

  // Unlike its siblings this one has an outcome: a rejected edit must leave the
  // caller's editor open, or the resync takes the user's rewrite with it.
  async updateComment(taskId: string, commentId: string, body: CommentBody): Promise<boolean> {
    const now = new Date().toISOString();
    this.#replaceComments(taskId, (comments) =>
      comments.map((comment) =>
        comment.id === commentId ? { ...comment, body, updated_at: now } : comment
      )
    );
    try {
      const updated = assertOk(
        await api.PATCH('/api/comments/{id}', {
          params: { path: { id: commentId } },
          body: { body },
        })
      );
      this.#replaceComments(taskId, (comments) =>
        comments.map((comment) => (comment.id === commentId ? updated : comment))
      );
      return true;
    } catch (error) {
      await this.#mutationFailed(error);
      await this.loadTaskDetail(taskId);
      return false;
    }
  }

  async deleteComment(taskId: string, commentId: string): Promise<void> {
    this.#replaceComments(taskId, (comments) =>
      comments.filter((comment) => comment.id !== commentId)
    );
    this.#setCommentCount(taskId, (count) => Math.max(0, count - 1));
    try {
      assertOk(await api.DELETE('/api/comments/{id}', { params: { path: { id: commentId } } }));
    } catch (error) {
      await this.#mutationFailed(error);
      await this.loadTaskDetail(taskId);
    }
  }

  #setChecklistCounts(
    taskId: string,
    next: (counts: { total: number; done: number }) => { total: number; done: number }
  ): void {
    this.tasks = this.tasks.map((task) => {
      if (task.id !== taskId) {
        return task;
      }
      const { total, done } = next({
        total: task.checklist_item_count ?? 0,
        done: task.checklist_done_count ?? 0,
      });
      return {
        ...task,
        checklist_item_count: Math.max(0, total),
        checklist_done_count: Math.max(0, done),
      };
    });
  }

  // A no-op when the list is not cached, for the same reason #replaceComments is.
  #replaceChecklist(taskId: string, next: (items: ChecklistItem[]) => ChecklistItem[]): void {
    const cached = this.taskChecklists[taskId];
    if (cached === undefined) {
      return;
    }
    this.taskChecklists = { ...this.taskChecklists, [taskId]: next(cached) };
  }

  async addChecklistItem(taskId: string, text: string): Promise<void> {
    const id = newId();
    const now = new Date().toISOString();
    const placement = append(this.taskChecklists[taskId] ?? []);
    const optimistic: ChecklistItem = {
      id,
      task_id: taskId,
      text,
      checked: false,
      ...placement,
      created_at: now,
      updated_at: now,
    };
    this.#replaceChecklist(taskId, (items) => [...items, optimistic]);
    this.#setChecklistCounts(taskId, ({ total, done }) => ({ total: total + 1, done }));
    try {
      const created = assertOk(
        await api.POST('/api/checklist-items', {
          body: { id, task_id: taskId, text, ...placement },
        })
      );
      // A detail fetch landing mid-flight replaces the whole list, so the optimistic
      // row may be gone and the server row has to be re-inserted.
      if (this.taskChecklists[taskId] === undefined) {
        await this.loadTaskDetail(taskId);
        return;
      }
      this.#replaceChecklist(taskId, (items) =>
        items.some((item) => item.id === id)
          ? items.map((item) => (item.id === id ? created : item))
          : [...items, created].sort(byPosition)
      );
    } catch (error) {
      await this.#mutationFailed(error);
      await this.loadTaskDetail(taskId);
    } finally {
      taskActivity.invalidate(taskId);
    }
  }

  async setChecklistItemChecked(taskId: string, itemId: string, checked: boolean): Promise<void> {
    const before = (this.taskChecklists[taskId] ?? []).find((item) => item.id === itemId);
    const now = new Date().toISOString();
    this.#replaceChecklist(taskId, (items) =>
      items.map((item) => (item.id === itemId ? { ...item, checked, updated_at: now } : item))
    );
    if (before !== undefined && before.checked !== checked) {
      this.#setChecklistCounts(taskId, ({ total, done }) => ({
        total,
        done: checked ? done + 1 : done - 1,
      }));
    }
    await this.#patchChecklistItem(taskId, itemId, { checked }, true);
  }

  async renameChecklistItem(taskId: string, itemId: string, text: string): Promise<void> {
    const now = new Date().toISOString();
    this.#replaceChecklist(taskId, (items) =>
      items.map((item) => (item.id === itemId ? { ...item, text, updated_at: now } : item))
    );
    await this.#patchChecklistItem(taskId, itemId, { text }, true);
  }

  // The only checklist write the server records no activity for, so the only one
  // that must not refetch the log.
  async moveChecklistItem(taskId: string, itemId: string, placement: Placement): Promise<void> {
    this.#replaceChecklist(taskId, (items) =>
      items.map((item) => (item.id === itemId ? { ...item, ...placement } : item)).sort(byPosition)
    );
    await this.#patchChecklistItem(taskId, itemId, { ...placement }, false);
  }

  async #patchChecklistItem(
    taskId: string,
    itemId: string,
    body: { text?: string; checked?: boolean; sort_key?: string },
    logged: boolean
  ): Promise<void> {
    try {
      const updated = assertOk(
        await api.PATCH('/api/checklist-items/{id}', { params: { path: { id: itemId } }, body })
      );
      this.#replaceChecklist(taskId, (items) =>
        items.map((item) => (item.id === itemId ? updated : item)).sort(byPosition)
      );
    } catch (error) {
      await this.#mutationFailed(error);
      await this.loadTaskDetail(taskId);
    } finally {
      if (logged) {
        taskActivity.invalidate(taskId);
      }
    }
  }

  async deleteChecklistItem(taskId: string, itemId: string): Promise<void> {
    const removed = (this.taskChecklists[taskId] ?? []).find((item) => item.id === itemId);
    this.#replaceChecklist(taskId, (items) => items.filter((item) => item.id !== itemId));
    this.#setChecklistCounts(taskId, ({ total, done }) => ({
      total: total - 1,
      done: removed?.checked === true ? done - 1 : done,
    }));
    try {
      assertOk(await api.DELETE('/api/checklist-items/{id}', { params: { path: { id: itemId } } }));
    } catch (error) {
      await this.#mutationFailed(error);
      await this.loadTaskDetail(taskId);
    } finally {
      taskActivity.invalidate(taskId);
    }
  }

  // Inserts the new card rather than waiting for its realtime echo: the caller
  // navigates to it, and a card absent from `tasks` has no title to build a slug from.
  async promoteChecklistItem(taskId: string, itemId: string): Promise<string | null> {
    const parent = this.tasks.find((task) => task.id === taskId);
    const item = (this.taskChecklists[taskId] ?? []).find((entry) => entry.id === itemId);
    if (parent === undefined || item === undefined) {
      return null;
    }
    const siblings = this.tasksInColumn(parent.column_id);
    const placement = placeAtIndex(siblings, siblings.findIndex((task) => task.id === taskId) + 1);
    const id = newId();
    this.#replaceChecklist(taskId, (items) => items.filter((entry) => entry.id !== itemId));
    this.#setChecklistCounts(taskId, ({ total, done }) => ({
      total: total - 1,
      done: item.checked ? done - 1 : done,
    }));
    try {
      const created = assertOk(
        await api.POST('/api/checklist-items/{id}/promote', {
          params: { path: { id: itemId } },
          body: { id, ...placement },
        })
      );
      this.tasks = this.tasks.some((task) => task.id === id)
        ? this.tasks.map((task) => (task.id === id ? created : task))
        : [...this.tasks, created];
      return id;
    } catch (error) {
      await this.#mutationFailed(error);
      await this.loadTaskDetail(taskId);
      return null;
    } finally {
      taskActivity.invalidate(taskId);
    }
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
        this.tasks = this.tasks.some((t) => t.id === task.id)
          ? this.tasks.map((t) => (t.id === task.id ? task : t))
          : [...this.tasks, task];
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
        this.tasks = this.tasks.map((t) =>
          t.id === incoming.id
            ? {
                ...incoming,
                comment_count: incoming.comment_count ?? t.comment_count,
                attachment_count: incoming.attachment_count ?? t.attachment_count,
              }
            : t
        );
        taskActivity.invalidate(incoming.id);
        break;
      }
      case 'task_deleted': {
        const { id } = event.data;
        this.#dropTasks([id]);
        this.archivedTasks = this.archivedTasks.filter((t) => t.id !== id);
        break;
      }
      case 'task_archived': {
        const archived = event.data;
        this.#dropTasks([archived.id]);
        this.archivedTasks = this.archivedTasks.some((t) => t.id === archived.id)
          ? this.archivedTasks.map((t) => (t.id === archived.id ? archived : t))
          : [archived, ...this.archivedTasks];
        taskActivity.invalidate(archived.id);
        break;
      }
      case 'task_restored': {
        const restored = event.data;
        this.archivedTasks = this.archivedTasks.filter((t) => t.id !== restored.id);
        this.tasks = this.tasks.some((t) => t.id === restored.id)
          ? this.tasks.map((t) => (t.id === restored.id ? restored : t))
          : [...this.tasks, restored];
        taskActivity.invalidate(restored.id);
        break;
      }
      case 'task_relations_set': {
        const d = event.data;
        this.tasks = this.tasks.map((t) =>
          t.id === d.task_id
            ? {
                ...t,
                label_ids: d.label_ids,
                assignee_ids: d.assignee_ids,
                blocker_ids: d.blocker_ids,
                open_cross_project_blocker_count: d.open_cross_project_blocker_count,
              }
            : t
        );
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
        this.columns = (
          this.columns.some((c) => c.id === column.id)
            ? this.columns.map((c) => (c.id === column.id ? column : c))
            : [...this.columns, column]
        ).sort(byRank);
        break;
      }
      case 'column_deleted': {
        const d = event.data;
        this.columns = this.columns.filter((c) => c.id !== d.id);
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
        // No column change, so only positions move; no activity to invalidate.
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
        this.labels = this.labels.some((l) => l.id === label.id)
          ? this.labels.map((l) => (l.id === label.id ? label : l))
          : [...this.labels, label];
        break;
      }
      case 'label_deleted': {
        const { id } = event.data;
        this.labels = this.labels.filter((l) => l.id !== id);
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
        this.#setAttachmentCount(d.task_id, () => d.attachment_count);
        // Skips the adder's own echo, which the optimistic append already placed.
        this.#replaceAttachments(d.task_id, (attachments) =>
          attachments.some((a) => a.id === d.id) ? attachments : [...attachments, d]
        );
        break;
      }
      case 'attachment_updated': {
        const d = event.data;
        this.#replaceAttachments(d.task_id, (attachments) =>
          attachments.map((a) => (a.id === d.id ? d : a))
        );
        break;
      }
      case 'attachment_deleted': {
        const d = event.data;
        this.#setAttachmentCount(d.task_id, () => d.attachment_count);
        this.#replaceAttachments(d.task_id, (attachments) =>
          attachments.filter((a) => a.id !== d.id)
        );
        // The cover lives on the row, so a delete can clear it. This is the only
        // event that reports one now.
        this.tasks = this.tasks.map((t) =>
          t.id === d.task_id ? { ...t, cover_image_url: d.cover_image_url ?? null } : t
        );
        break;
      }
      case 'comment_created': {
        const d = event.data;
        this.#setCommentCount(d.task_id, () => d.comment_count);
        const comment: TaskComment = {
          id: d.id,
          task_id: d.task_id,
          user_id: d.user_id,
          body: d.body,
          created_at: d.created_at,
          updated_at: d.updated_at,
        };
        // Skips the author's own echo, which the optimistic append already placed.
        this.#replaceComments(d.task_id, (comments) =>
          comments.some((c) => c.id === comment.id)
            ? comments
            : [...comments, comment].sort(chronological)
        );
        break;
      }
      case 'comment_updated': {
        const d = event.data;
        this.#replaceComments(d.task_id, (comments) =>
          comments.map((c) =>
            c.id === d.id ? { ...c, body: d.body, updated_at: d.updated_at } : c
          )
        );
        break;
      }
      case 'comment_deleted': {
        const d = event.data;
        this.#setCommentCount(d.task_id, () => d.comment_count);
        this.#replaceComments(d.task_id, (comments) => comments.filter((c) => c.id !== d.id));
        break;
      }
      case 'checklist_item_created':
      case 'checklist_item_updated': {
        const d = event.data;
        this.#setChecklistCounts(d.task_id, () => ({
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
        this.#replaceChecklist(d.task_id, (items) =>
          (items.some((i) => i.id === item.id)
            ? items.map((i) => (i.id === item.id ? item : i))
            : [...items, item]
          ).sort(byPosition)
        );
        // A reposition writes no activity entry, but the event cannot say which kind
        // of patch it was; the store's refresh collapses a burst into one fetch.
        taskActivity.invalidate(d.task_id);
        break;
      }
      case 'checklist_item_deleted': {
        const d = event.data;
        this.#setChecklistCounts(d.task_id, () => ({
          total: d.checklist_item_count,
          done: d.checklist_done_count,
        }));
        this.#replaceChecklist(d.task_id, (items) => items.filter((i) => i.id !== d.id));
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
          // Not `??`: null is the colour "None", and coalescing it would keep
          // showing the old one after a teammate cleared it.
          color: d.color !== undefined ? d.color : project.color,
        };
        break;
      }
    }
  }

  async #mutationFailed(error: unknown): Promise<void> {
    toasts.error(error instanceof ApiError ? error.message : 'Something went wrong');
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
    await this.refetch();
  }

  // Duplicate-name 409s are rethrown after resync so callers can surface them inline.
  async #labelConflictOrFail(error: unknown): Promise<void> {
    if (error instanceof ApiError && error.status === 409) {
      await this.refetch();
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
