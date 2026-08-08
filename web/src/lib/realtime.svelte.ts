import { untrack } from 'svelte';
import { board } from './board.svelte';
import { boardAnnouncer } from './board-announcer.svelte';
import { invitations } from './invitations.svelte';
import { projects } from './projects.svelte';
import { taskSeries } from './taskSeries.svelte';
import { users } from './users.svelte';
import type { RealtimeEvent, RealtimeEventType } from './realtime-types';
import { session } from './session.svelte';

type RealtimeStatus = 'online' | 'offline' | 'connecting';

const WS_OPEN = 1;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const OFFLINE_NOTICE_DELAY_MS = 3000;
// The server closes with 4401 when a token is rejected or its session revoked.
const AUTH_CLOSE_CODE = 4401;

const BOARD_EVENTS = new Set<RealtimeEventType>([
  'task_created',
  'task_updated',
  'task_deleted',
  'task_archived',
  'task_restored',
  'task_relations_set',
  'cross_project_blockers_changed',
  'column_created',
  'column_updated',
  'column_deleted',
  'column_tasks_moved',
  'column_tasks_archived',
  'column_tasks_reordered',
  'bulk_tasks_moved',
  'bulk_tasks_archived',
  'bulk_tasks_relations_set',
  'label_created',
  'label_updated',
  'label_deleted',
  'comment_created',
  'comment_updated',
  'comment_deleted',
  'checklist_item_created',
  'checklist_item_updated',
  'checklist_item_deleted',
  'attachment_created',
  'attachment_updated',
  'attachment_deleted',
]);
const SERIES_EVENTS = new Set<RealtimeEventType>([
  'series_created',
  'series_updated',
  'series_deleted',
]);
const PROJECT_EVENTS = new Set<RealtimeEventType>([
  'project_created',
  'project_updated',
  'project_deleted',
  'project_position_updated',
  'project_seen',
]);

class RealtimeClient {
  // Connection lifecycle only. UI must read `interrupted` instead: `status` is
  // 'offline' then 'connecting' for the whole of a perfectly normal handshake.
  status = $state<RealtimeStatus>('offline');
  interrupted = $state(false);

  #socket: WebSocket | null = null;
  #authed = false;
  #subscribedProjectId: string | null = null;
  #backoff = INITIAL_BACKOFF_MS;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #noticeTimer: ReturnType<typeof setTimeout> | undefined;
  #hasSyncedOnce = false;
  #stopped = true;
  #disposeEffects: (() => void) | null = null;

  // Board-structural events that land while a drag is live would corrupt the dnd
  // zones, so they wait here and flush once the drag finalizes.
  #queue: RealtimeEvent[] = [];
  #needsBoardRefetch = false;

  connect(): void {
    if (!this.#stopped) {
      return;
    }
    this.#stopped = false;
    this.#armOfflineNotice();
    this.#disposeEffects ??= $effect.root(() => {
      $effect(() => {
        const projectId = this.#subscriptionTarget;
        untrack(() => this.#syncSubscription(projectId));
      });
      $effect(() => {
        const dragging = board.dragBusy;
        if (!dragging) {
          untrack(() => this.#flushQueue());
        }
      });
    });
    this.#open();
  }

  disconnect(): void {
    this.#stopped = true;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#clearOfflineNotice();
    this.#backoff = INITIAL_BACKOFF_MS;
    this.#authed = false;
    this.#subscribedProjectId = null;
    this.#hasSyncedOnce = false;
    this.#queue = [];
    this.#needsBoardRefetch = false;
    boardAnnouncer.reset();
    this.#disposeEffects?.();
    this.#disposeEffects = null;
    this.status = 'offline';
    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    }
  }

  #open(): void {
    const token = session.token;
    if (this.#stopped || token === null) {
      return;
    }
    this.status = 'connecting';
    this.#authed = false;
    this.#subscribedProjectId = null;
    const url = location.origin.replace(/^http/, 'ws') + '/ws';
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.#scheduleReconnect();
      return;
    }
    this.#socket = socket;
    socket.onopen = () => this.#send({ type: 'auth', token });
    socket.onmessage = (event: MessageEvent) => this.#onMessage(event.data);
    socket.onclose = (event: CloseEvent) => this.#onClose(socket, event);
    socket.onerror = () => {};
  }

  #onMessage(raw: unknown): void {
    if (typeof raw !== 'string') {
      return;
    }
    let message: { type?: unknown; project_id?: unknown; data?: unknown };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message.type !== 'string') {
      return;
    }
    if (message.type === 'auth_ok') {
      this.#onAuthOk();
      return;
    }
    if (message.type === 'ping') {
      this.#send({ type: 'pong' });
      return;
    }
    if (message.type === 'pong') {
      return;
    }
    // The one assertion the union rests on: a frame is untrusted and the
    // generated output is types only. An event type this client does not know
    // matches nothing in #dispatch and is ignored, as it was before.
    this.#dispatch({
      type: message.type,
      project_id: typeof message.project_id === 'string' ? message.project_id : null,
      data: message.data,
    } as unknown as RealtimeEvent);
  }

  // A read-only board is a one-shot fetch; subscribing would also be rejected
  // for a signed-in non-member.
  get #subscriptionTarget(): string | null {
    return board.readonly ? null : board.currentProjectId;
  }

  #onAuthOk(): void {
    this.#authed = true;
    this.status = 'online';
    this.#clearOfflineNotice();
    this.#backoff = INITIAL_BACKOFF_MS;
    this.#subscribedProjectId = null;
    this.#syncSubscription(this.#subscriptionTarget);
    // The very first connect follows the initial page load, which already
    // fetched everything; only a reconnect needs to self-heal the missed gap.
    if (this.#hasSyncedOnce) {
      // The refetches below replace the board wholesale rather than applying
      // events, so anything still buffered describes changes about to arrive as
      // a whole new board.
      boardAnnouncer.reset();
      // account_updated is delivered, not replayed: one published while this
      // socket was down is gone, and nothing else re-reads the account until a
      // page load. Every other store below heals the same gap the same way.
      void session.refresh().catch(() => {
        // Best-effort: a failed read leaves the account as stale as it was.
      });
      void projects.load();
      invitations.resync();
      taskSeries.resync();
      if (board.currentProjectId !== null) {
        if (board.dragBusy) {
          this.#needsBoardRefetch = true;
        } else {
          void board.resync();
        }
      }
    }
    this.#hasSyncedOnce = true;
  }

  #onClose(socket: WebSocket, event: CloseEvent): void {
    if (socket !== this.#socket) {
      return;
    }
    this.#socket = null;
    this.#authed = false;
    this.#subscribedProjectId = null;
    this.status = 'offline';
    this.#armOfflineNotice();
    if (event.code === AUTH_CLOSE_CODE) {
      void this.#revalidateSession();
      return;
    }
    this.#scheduleReconnect();
  }

  // A 4401 can be a real revocation or a transient auth-protocol close, so let an
  // HTTP round-trip decide rather than blindly logging out: a revoked token clears
  // the session via the existing 401 path, a still-valid one just reconnects.
  async #revalidateSession(): Promise<void> {
    await session.init();
    if (session.token !== null && !this.#stopped) {
      this.#scheduleReconnect();
    }
  }

  #scheduleReconnect(): void {
    if (this.#stopped) {
      return;
    }
    clearTimeout(this.#reconnectTimer);
    const delay = this.#backoff;
    this.#backoff = Math.min(this.#backoff * 2, MAX_BACKOFF_MS);
    this.#reconnectTimer = setTimeout(() => this.#open(), delay);
  }

  #armOfflineNotice(): void {
    // `connect()` reaches here from inside an effect, so the latch must be read
    // untracked; a tracked read would re-run that effect when the notice fires.
    if (this.#noticeTimer !== undefined || untrack(() => this.interrupted)) {
      return;
    }
    this.#noticeTimer = setTimeout(() => {
      this.#noticeTimer = undefined;
      this.interrupted = true;
    }, OFFLINE_NOTICE_DELAY_MS);
  }

  #clearOfflineNotice(): void {
    clearTimeout(this.#noticeTimer);
    this.#noticeTimer = undefined;
    this.interrupted = false;
  }

  #syncSubscription(projectId: string | null): void {
    if (!this.#authed || this.#socket?.readyState !== WS_OPEN) {
      return;
    }
    if (this.#subscribedProjectId === projectId) {
      return;
    }
    if (this.#subscribedProjectId !== null) {
      this.#send({ type: 'unsubscribe', project_id: this.#subscribedProjectId });
    }
    if (projectId !== null) {
      this.#send({ type: 'subscribe', project_id: projectId });
    }
    this.#subscribedProjectId = projectId;
  }

  #dispatch(event: RealtimeEvent): void {
    if (BOARD_EVENTS.has(event.type)) {
      if (event.project_id !== board.currentProjectId) {
        return;
      }
      if (board.dragBusy) {
        this.#queue.push(event);
        return;
      }
      // Before the apply, not after: the words for a deleted card or column live
      // only in the state this is about to overwrite.
      boardAnnouncer.record(event);
      board.applyRealtime(event);
    } else if (PROJECT_EVENTS.has(event.type)) {
      projects.applyRealtime(event);
      // Not queued behind a drag: this only flips whether dragging is allowed,
      // which svelte-dnd-action applies without disturbing the drag in flight,
      // and deferring it keeps a demoted member's affordances live for longer.
      if (event.type === 'project_updated') {
        board.applyRealtime(event);
      }
    } else if (event.type === 'project_changed') {
      // Delivered to the actor's own devices too, because their other tabs still
      // have to update the board — only the dot ignores its own. The open board
      // is skipped for the same reason: a dot on what you are already looking at
      // is one you cannot act on.
      //
      // The undefined check is not dead code, however required the generated
      // type says the field is. A frame is asserted rather than validated where
      // it arrives, so a pod that predates the field really does deliver none,
      // and that is the case being skipped here: a missed dot self-heals on the
      // next load, a false one on your own edit does not. A null actor is a
      // different thing and does dot — it means a schedule or a background job
      // made the change, which is nobody's own edit.
      const { actor_user_id: actor } = event.data;
      if (
        event.project_id !== null &&
        event.project_id !== board.currentProjectId &&
        actor !== undefined &&
        actor !== session.user?.id
      ) {
        projects.markChanged(event.project_id);
      }
    } else if (SERIES_EVENTS.has(event.type)) {
      // Not queued behind a drag: a schedule is not a board row, and the panel
      // that shows it is a modal that cannot be open while one is under way.
      taskSeries.applyRealtime(event);
    } else if (event.type === 'invitations_changed') {
      invitations.applyRealtime(event);
    } else if (event.type === 'user_updated') {
      const updated = users.applyRealtime(event.data);
      if (updated !== null && session.user?.id === updated.id) {
        session.user = { ...session.user, ...updated };
      }
    } else if (event.type === 'account_updated') {
      // Account-scoped and delivered only to this account's own sockets, which
      // is why it may carry the whole /api/auth/me shape — the address and
      // whether it is verified included, neither of which user_updated may
      // hold. Assigned whole rather than merged: the payload is that record.
      // The id is still checked, because applying someone else's would change
      // who this tab thinks it is.
      if (session.user?.id === event.data.id) {
        session.user = event.data;
      }
    }
  }

  #flushQueue(): void {
    if (board.dragBusy) {
      return;
    }
    const queued = this.#queue;
    this.#queue = [];
    if (this.#needsBoardRefetch) {
      this.#needsBoardRefetch = false;
      // This branch discards the whole queued batch, archive events included, so
      // it has to reload the archive as well as the board.
      boardAnnouncer.reset();
      void board.resync();
      return;
    }
    for (const event of queued) {
      // Per event inside the loop, so each snapshot is taken against the board
      // that event is about to change rather than the one the drag ended on.
      boardAnnouncer.record(event);
      board.applyRealtime(event);
    }
  }

  #send(message: unknown): void {
    if (this.#socket?.readyState === WS_OPEN) {
      this.#socket.send(JSON.stringify(message));
    }
  }
}

export const realtime = new RealtimeClient();
