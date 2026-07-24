import { untrack } from 'svelte';
import { board } from './board.svelte';
import { projects } from './projects.svelte';
import type { RealtimeEvent } from './realtime-types';
import { session } from './session.svelte';

export type RealtimeStatus = 'online' | 'offline' | 'connecting';

const WS_OPEN = 1;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
// The server closes with 4401 when a token is rejected or its session revoked.
const AUTH_CLOSE_CODE = 4401;

const BOARD_EVENTS = new Set([
  'task_created',
  'task_updated',
  'task_deleted',
  'task_relations_set',
  'column_created',
  'column_updated',
  'column_deleted',
  'label_created',
  'label_updated',
  'label_deleted',
  'image_created',
  'image_deleted',
]);
const PROJECT_EVENTS = new Set([
  'project_created',
  'project_updated',
  'project_deleted',
  'project_position_updated',
]);

class RealtimeClient {
  status = $state<RealtimeStatus>('offline');

  #socket: WebSocket | null = null;
  #authed = false;
  #subscribedProjectId: string | null = null;
  #backoff = INITIAL_BACKOFF_MS;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
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
    this.#disposeEffects ??= $effect.root(() => {
      $effect(() => {
        const projectId = board.currentProjectId;
        untrack(() => this.#syncSubscription(projectId));
      });
      $effect(() => {
        const dragging = board.dragging;
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
    this.#backoff = INITIAL_BACKOFF_MS;
    this.#authed = false;
    this.#subscribedProjectId = null;
    this.#hasSyncedOnce = false;
    this.#queue = [];
    this.#needsBoardRefetch = false;
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
    this.#dispatch({
      type: message.type,
      project_id: typeof message.project_id === 'string' ? message.project_id : null,
      data: message.data,
    });
  }

  #onAuthOk(): void {
    this.#authed = true;
    this.status = 'online';
    this.#backoff = INITIAL_BACKOFF_MS;
    this.#subscribedProjectId = null;
    this.#syncSubscription(board.currentProjectId);
    // The very first connect follows the initial page load, which already
    // fetched everything; only a reconnect needs to self-heal the missed gap.
    if (this.#hasSyncedOnce) {
      void projects.load();
      if (board.currentProjectId !== null) {
        if (board.dragging) {
          this.#needsBoardRefetch = true;
        } else {
          void board.refetch();
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
      if (board.dragging) {
        this.#queue.push(event);
        return;
      }
      board.applyRealtime(event);
    } else if (PROJECT_EVENTS.has(event.type)) {
      projects.applyRealtime(event);
    }
  }

  #flushQueue(): void {
    if (board.dragging) {
      return;
    }
    const queued = this.#queue;
    this.#queue = [];
    if (this.#needsBoardRefetch) {
      this.#needsBoardRefetch = false;
      void board.refetch();
      return;
    }
    for (const event of queued) {
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
