import type { components } from '../api/realtime.generated';

// Generated from the API's realtime-events.json, so narrowing on `type` yields
// that event's payload and an apply site reads fields the server is known to
// send rather than asserting a shape it hopes for.
export type RealtimeEvent = components['schemas']['RealtimeEvent'];

export type RealtimeEventType = RealtimeEvent['type'];

export type RealtimeEventOf<T extends RealtimeEventType> = Extract<RealtimeEvent, { type: T }>;

export type PayloadOf<T extends RealtimeEventType> = RealtimeEventOf<T>['data'];

// The application close codes the API declares. `CLOSE_ACTIONS` in
// realtime.svelte.ts is keyed by this union, so a code added there stops that
// record compiling rather than reaching this client as silence.
export type RealtimeCloseCode = components['schemas']['RealtimeCloseCode'];
