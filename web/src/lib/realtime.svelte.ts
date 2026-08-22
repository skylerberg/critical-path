import { untrack } from 'svelte';
import { board } from './board.svelte';
import { boardAnnouncer } from './board-announcer.svelte';
import { connectivity } from './connectivity.svelte';
import { invitations } from './invitations.svelte';
import { projects } from './projects.svelte';
import { realtimeCoverage } from './realtime-coverage.svelte';
import { taskSeries } from './taskSeries.svelte';
import { users } from './users.svelte';
import type { RealtimeCloseCode, RealtimeEvent, RealtimeEventType } from './realtime-types';
import { outbox } from './outbox.svelte';
import { isSignedIn, session } from './session.svelte';

type RealtimeStatus = 'online' | 'offline' | 'connecting';

const WS_OPEN = 1;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const OFFLINE_NOTICE_DELAY_MS = 3000;

// What each of the API's own close codes asks this client to do, as against the
// ordinary backed-off retry every other code gets.
type CloseAction = 'revalidate' | 'yield';

// The record is the contract: a code added to the API's table widens the
// generated union and this stops compiling, and one removed leaves an excess
// key. Either way the change surfaces here rather than as a socket nobody routed.
const CLOSE_ACTIONS: Record<RealtimeCloseCode, CloseAction> = {
  4401: 'revalidate',
  4429: 'yield',
};

// `CloseEvent['code']` is a plain number, so the one site that reads it narrows
// through this predicate. Casting instead would answer for codes the record
// never listed and give up the exhaustiveness that is the point of it.
function isCloseCode(code: number): code is RealtimeCloseCode {
  return code in CLOSE_ACTIONS;
}

function closeAction(code: number): CloseAction | null {
  return isCloseCode(code) ? CLOSE_ACTIONS[code] : null;
}

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
  // The server closed this socket because the account holds too many, so live
  // updates are not coming back on their own schedule. Read by SyncStatus, which
  // is the only place that can say so.
  evicted = $state(false);

  #socket: WebSocket | null = null;
  #visibilityWatched = false;
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
      $effect(() => {
        const reachable = connectivity.reachable;
        untrack(() => {
          if (reachable) {
            this.#reconnectNow();
          }
        });
      });
    });
    this.#open();
  }

  disconnect(): void {
    this.#stopped = true;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#clearOfflineNotice();
    this.#unwatchVisibility();
    this.evicted = false;
    this.#backoff = INITIAL_BACKOFF_MS;
    this.#authed = false;
    this.#subscribedProjectId = null;
    this.#hasSyncedOnce = false;
    this.#queue = [];
    this.#needsBoardRefetch = false;
    realtimeCoverage.end();
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
    // Whatever the previous socket was carrying, this one has not carried yet.
    realtimeCoverage.end();
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
    // Ahead of every guard below, because the fact being recorded is that a
    // frame arrived at all — a type this client does not know still crossed the
    // network. The API heartbeats every 30s, so this answers the reachability
    // question continuously and for free, which matters because the reads that
    // would otherwise answer it are skipped exactly while this socket is up.
    connectivity.noteReached();
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
    // The payload is asserted, not validated — but it has to BE one. #dispatch
    // destructures `event.data` for several types, so a known type arriving
    // without it throws out of onmessage and takes the rest of that frame's
    // handling with it. The frames with no payload at all are the control ones
    // above, which have already returned.
    if (typeof message.data !== 'object' || message.data === null) {
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
    this.evicted = false;
    this.#clearOfflineNotice();
    this.#backoff = INITIAL_BACKOFF_MS;
    this.#subscribedProjectId = null;
    this.#syncSubscription(this.#subscriptionTarget);
    // The very first connect follows the initial page load, which already
    // fetched everything; only a reconnect needs to self-heal the missed gap.
    // An initial load that could not reach the server is the exception — it
    // fetched nothing, so it needs the same healing a reconnect does.
    const needsHeal = this.#hasSyncedOnce || session.status === 'offline';
    this.#hasSyncedOnce = true;
    if (!needsHeal) {
      return;
    }
    // Unsent changes go first: they are the one thing the server has never seen,
    // and a refetch that ran ahead of them would replace them on screen with a
    // board that predates them, only for the replay to put them back. Nothing to
    // replay is the ordinary case, and it heals immediately rather than waiting
    // a turn for an empty queue.
    if (outbox.count === 0) {
      this.#healReads();
      return;
    }
    void outbox.drain().then(() => {
      this.#healReads();
    });
  }

  #healReads(): void {
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

  #onClose(socket: WebSocket, event: CloseEvent): void {
    if (socket !== this.#socket) {
      return;
    }
    this.#socket = null;
    this.#authed = false;
    this.#subscribedProjectId = null;
    realtimeCoverage.end();
    this.status = 'offline';
    this.#armOfflineNotice();
    const action = closeAction(event.code);
    // Any close that is not the ceiling is news that the ceiling is not what is
    // stopping us any more. Left set, the flag holds this tab at the long delay
    // for the rest of the session and keeps the indicator naming a reason that
    // has passed.
    if (action !== 'yield') {
      this.evicted = false;
    }
    switch (action) {
      case 'revalidate':
        void this.#revalidateSession();
        return;
      case 'yield':
        this.#yieldSlot();
        return;
      default:
        this.#scheduleReconnect();
    }
  }

  // A 4401 can be a real revocation or a transient auth-protocol close, so let an
  // HTTP round-trip decide rather than blindly logging out: a revoked token clears
  // the session via the existing 401 path, a still-valid one just reconnects.
  //
  // refresh() rather than init() while a session is established, because init()
  // drops status back through 'unknown' and the shell renders a spinner over the
  // whole app for the duration — unmounting whatever the user had open, for a close
  // code that is usually transient. A backgrounded phone reconnecting is the common
  // way to get here, which is the worst moment to blank the screen.
  async #revalidateSession(): Promise<void> {
    if (isSignedIn(session.status)) {
      try {
        await session.refresh();
      } catch {
        // The 401 that means the token really is gone. init() owns clearing it, and
        // owns settling an unreachable server against the remembered account.
        await session.init();
      }
    } else {
      await session.init();
    }
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

  /**
   * 4429 says this socket was the oldest of more than the account is allowed, so
   * the credential is good and nothing is broken. Reconnecting on the ordinary
   * backoff would only evict another of the account's sockets, whose tab would
   * do the same — a rotating eviction loop in which every tab also re-heals its
   * reads on each re-auth. So give the slot up instead.
   *
   * A hidden tab waits to be looked at and sets no timer at all: it is the one
   * with the least claim on a scarce slot, and it reconnects the moment someone
   * returns to it. A visible one waits the longest delay this client has.
   */
  #yieldSlot(): void {
    this.evicted = true;
    if (this.#stopped) {
      return;
    }
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    if (document.visibilityState === 'hidden') {
      this.#watchVisibility();
      return;
    }
    // Assigned on the close path, because the connection this one just lost
    // reset the backoff on its way up and #scheduleReconnect would start over.
    this.#backoff = MAX_BACKOFF_MS;
    this.#scheduleReconnect();
  }

  #watchVisibility(): void {
    if (this.#visibilityWatched) {
      return;
    }
    this.#visibilityWatched = true;
    document.addEventListener('visibilitychange', this.#onVisible);
  }

  #unwatchVisibility(): void {
    if (!this.#visibilityWatched) {
      return;
    }
    this.#visibilityWatched = false;
    document.removeEventListener('visibilitychange', this.#onVisible);
  }

  // A field rather than a method so removing the listener passes the reference
  // that was added.
  #onVisible = (): void => {
    if (document.visibilityState !== 'visible') {
      return;
    }
    if (this.#stopped || this.#socket !== null) {
      return;
    }
    // Dropped only once this is actually going to open: `evicted` blocks every
    // other path back, so unwatching before a bail that leaves no socket would
    // strand the tab with no way to reconnect at all.
    this.#unwatchVisibility();
    this.#backoff = INITIAL_BACKOFF_MS;
    this.#open();
  };

  /**
   * The backoff is sized for an outage that is still going. Something reaching
   * the server is the news that it has ended, and waiting out the rest of a
   * delay that can be half a minute keeps the indicator saying "Offline" long
   * after the network came back — which on a phone is the whole of an ordinary
   * return from the background.
   *
   * A live attempt is left alone rather than replaced: `#socket` is non-null
   * from the moment one is opened until it closes, so this cannot stack a second
   * socket on top of a handshake already in progress.
   */
  #reconnectNow(): void {
    // An evicted tab is not waiting out an outage — the server is answering and
    // has asked it to stand down — so news that the network works is not news to
    // it. Without this the connectivity effect pulls it straight back into the
    // fight and the yield above never happens.
    if (this.evicted) {
      return;
    }
    if (this.#stopped || this.#socket !== null) {
      return;
    }
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#backoff = INITIAL_BACKOFF_MS;
    this.#open();
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
    // Announced only where the subscription actually moves, which the early
    // return above is what guarantees: bumping the token on every pass would
    // invalidate every reader each time the effect re-ran over an unchanged board.
    if (projectId === null) {
      realtimeCoverage.end();
    } else {
      realtimeCoverage.begin(projectId);
    }
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
      // Not queued behind a drag: a schedule is not a board row, and neither the
      // series modal nor an open card can be showing one while a drag runs.
      taskSeries.applyRealtime(event);
      board.applySeriesRealtime(event);
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
