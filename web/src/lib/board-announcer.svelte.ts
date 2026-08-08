import { Announcer } from './announcer.svelte';
import { board } from './board.svelte';
import { router } from './router.svelte';
import { session } from './session.svelte';
import { truncateTitle } from './titles';
import { displayName, users } from './users.svelte';
import type { RealtimeEvent } from './realtime-types';

// Long enough that the burst one gesture produces — a column delete and its
// relocations, a paste that creates several cards — becomes one sentence, and
// deliberately longer than the fetch coalescing in taskActivity: speech is
// slower than a request, so a second utterance a second behind the first only
// stacks up in the reader's queue.
const ANNOUNCE_WINDOW_MS = 1500;

type Change = { actorId: string } & (
  | { kind: 'added' | 'restored' | 'archived' | 'deleted'; title: string }
  | { kind: 'moved'; title: string; columnId: string; columnName: string }
  | { kind: 'column-added' | 'column-deleted'; name: string }
);

type ActorEvent = Extract<RealtimeEvent, { data: { actor_user_id: string | null } }>;

// A real check rather than an assertion: the union's account-scoped members have
// no such field, and a payload from a pod that predates it has none either.
function hasActor(event: RealtimeEvent): event is ActorEvent {
  return typeof event.data === 'object' && event.data !== null && 'actor_user_id' in event.data;
}

function columnName(columnId: string): string {
  return board.columns.find((column) => column.id === columnId)?.name ?? '';
}

// The task overlay's card is one the reader is already on, so a tint it cannot
// act on would be noise — the same call the unseen dot makes about the board you
// are already looking at.
function openTaskId(): string | undefined {
  return router.current.name === 'project' ? router.current.params.taskId : undefined;
}

// Read before board.applyRealtime, which is the whole reason record() runs first:
// task_deleted carries only an id and column_deleted no name, so the words for
// them exist only while the store still holds the row. The same snapshot is what
// separates a move between columns from a reorder within one.
function describe(event: ActorEvent, actorId: string): { changes: Change[]; markIds: string[] } {
  const held = (taskId: string): boolean => board.tasks.some((task) => task.id === taskId);

  switch (event.type) {
    case 'task_created':
    case 'task_restored': {
      const { id, title } = event.data;
      if (held(id)) {
        return { changes: [], markIds: [] };
      }
      const kind = event.type === 'task_created' ? 'added' : 'restored';
      return { changes: [{ actorId, kind, title }], markIds: [id] };
    }
    case 'task_deleted': {
      const task = board.tasks.find((candidate) => candidate.id === event.data.id);
      return task === undefined
        ? { changes: [], markIds: [] }
        : { changes: [{ actorId, kind: 'deleted', title: task.title }], markIds: [] };
    }
    case 'task_archived': {
      const { id, title } = event.data;
      return held(id)
        ? { changes: [{ actorId, kind: 'archived', title }], markIds: [] }
        : { changes: [], markIds: [] };
    }
    case 'column_tasks_archived':
    case 'bulk_tasks_archived': {
      const archived = event.data.tasks.filter((task) => held(task.id));
      return {
        changes: archived.map((task) => ({ actorId, kind: 'archived', title: task.title })),
        markIds: [],
      };
    }
    // Compared per task rather than against the event's target column, because
    // bulk_tasks_moved names no source — and because the per-task form also drops
    // the members of a batch that were already where it put them.
    case 'column_tasks_moved':
    case 'bulk_tasks_moved': {
      const changes: Change[] = [];
      const markIds: string[] = [];
      for (const moved of event.data.moved_tasks) {
        const task = board.tasks.find((candidate) => candidate.id === moved.id);
        if (task === undefined || task.column_id === moved.column_id) {
          continue;
        }
        markIds.push(moved.id);
        changes.push({
          actorId,
          kind: 'moved',
          title: task.title,
          columnId: moved.column_id,
          columnName: columnName(moved.column_id),
        });
      }
      return { changes, markIds };
    }
    case 'column_created': {
      const { id, name } = event.data;
      return board.columns.some((column) => column.id === id)
        ? { changes: [], markIds: [] }
        : { changes: [{ actorId, kind: 'column-added', name }], markIds: [] };
    }
    // Its moved_tasks are tinted, but say nothing of their own: the column
    // sentence is what the reader needs, and a card list under it is the running
    // commentary this is meant to avoid.
    case 'column_deleted': {
      const column = board.columns.find((candidate) => candidate.id === event.data.id);
      return column === undefined
        ? { changes: [], markIds: [] }
        : {
            changes: [{ actorId, kind: 'column-deleted', name: column.name }],
            markIds: event.data.moved_tasks.map((moved) => moved.id),
          };
    }
    default:
      return { changes: [], markIds: [] };
  }
}

function quoted(title: string): string {
  return `"${truncateTitle(title)}"`;
}

function cards(count: number): string {
  return `${String(count)} card${count === 1 ? '' : 's'}`;
}

const CLAUSE_ORDER = [
  'added',
  'restored',
  'moved',
  'archived',
  'deleted',
  'column-added',
  'column-deleted',
] as const;

function namedClause(change: Change): string {
  switch (change.kind) {
    case 'added':
      return `added ${quoted(change.title)}`;
    case 'restored':
      return `restored ${quoted(change.title)}`;
    case 'archived':
      return `archived ${quoted(change.title)}`;
    case 'deleted':
      return `deleted ${quoted(change.title)}`;
    case 'moved':
      return `moved ${quoted(change.title)} to ${change.columnName}`;
    case 'column-added':
      return `added the ${change.name} column`;
    case 'column-deleted':
      return `deleted the ${change.name} column`;
  }
}

function countedClause(kind: Change['kind'], group: Change[]): string {
  switch (kind) {
    case 'added':
      return `added ${cards(group.length)}`;
    case 'restored':
      return `restored ${cards(group.length)}`;
    case 'archived':
      return `archived ${cards(group.length)}`;
    case 'deleted':
      return `deleted ${cards(group.length)}`;
    case 'moved': {
      // Only where the whole batch landed together: "moved 3 cards to Done" is
      // wrong the moment two of them went somewhere else.
      const [first] = group as Extract<Change, { kind: 'moved' }>[];
      const shared = group.every(
        (change) => change.kind === 'moved' && change.columnId === first.columnId
      );
      return shared
        ? `moved ${cards(group.length)} to ${first.columnName}`
        : `moved ${cards(group.length)}`;
    }
    case 'column-added':
      return `added ${String(group.length)} columns`;
    case 'column-deleted':
      return `deleted ${String(group.length)} columns`;
  }
}

function sentence(changes: Change[]): string {
  const actorIds = [...new Set(changes.map((change) => change.actorId))];
  // "Changes", not "cards": a flush spanning two people can mix cards and
  // columns, and the rare case is better served by four words that are never
  // wrong than by branches nobody will hear. The tints show what moved.
  if (actorIds.length > 1) {
    return `${String(actorIds.length)} people made ${String(changes.length)} changes`;
  }

  const actor = displayName(users.displayFor(actorIds[0]!));
  const groups = CLAUSE_ORDER.map(
    (kind) => [kind, changes.filter((change) => change.kind === kind)] as const
  ).filter(([, group]) => group.length > 0);

  // A title is spoken only when the whole flush is one person, one kind, one
  // card. Quoted text in the middle of a comma list is easy to mishear as
  // another item in it.
  if (groups.length === 1 && groups[0]![1].length === 1) {
    return `${actor} ${namedClause(groups[0]![1][0]!)}`;
  }
  return `${actor} ${groups.map(([kind, group]) => countedClause(kind, group)).join(', ')}`;
}

class BoardAnnouncer {
  readonly #region = new Announcer();
  #buffer: Change[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;

  get message(): string {
    return this.#region.message;
  }

  // Called before board.applyRealtime for every board event, including each one
  // replayed out of the drag queue.
  record(event: RealtimeEvent): void {
    if (board.readonly || event.project_id !== board.currentProjectId || !hasActor(event)) {
      return;
    }
    // An event naming nobody cannot be told from an echo of this tab's own
    // mutation — the server sends a change back to the socket that made it — and
    // narrating your own edit at you is worse than saying nothing. It is also
    // what keeps this quiet against a pod that predates the field.
    const actorId = event.data.actor_user_id;
    if (actorId === null || actorId === session.user?.id) {
      return;
    }

    const { changes, markIds } = describe(event, actorId);
    const open = openTaskId();
    board.markRemotelyChanged(markIds.filter((id) => id !== open));
    if (changes.length === 0) {
      return;
    }
    this.#buffer.push(...changes);
    // Armed by the first change of a burst and never extended: a debounce would
    // starve under a teammate moving a card every second, and speech has to
    // arrive while it still describes what is on screen.
    this.#timer ??= setTimeout(() => this.#flush(), ANNOUNCE_WINDOW_MS);
  }

  reset(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#buffer = [];
    this.#region.clear();
  }

  #flush(): void {
    this.#timer = null;
    const buffered = this.#buffer;
    this.#buffer = [];
    if (buffered.length === 0) {
      return;
    }
    // Dropped rather than held. A sentence written into a region an open
    // dialog's top layer has made inert is never spoken, and one saved until the
    // dialog closes describes a board the reader has since moved on from. The
    // tints are what carry these cases, which is why they are marked above
    // regardless of whether anything is said.
    if (router.current.name !== 'project' || document.querySelector('dialog[open]') !== null) {
      return;
    }
    void this.#region.announce(sentence(buffered));
  }
}

export const boardAnnouncer = new BoardAnnouncer();
