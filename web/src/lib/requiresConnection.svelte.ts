import { connectivity } from './connectivity.svelte';

/**
 * Marks the actions the outbox deliberately does not queue.
 *
 * The queue covers the board, where working without a network is the point.
 * Everything else — changing a password, revoking a session, minting a token,
 * registering a webhook, accepting an invitation, uploading a file — either
 * needs an answer from the server to mean anything, or would sit on the device
 * holding bytes the queue was never designed to carry.
 *
 * Queuing those would be the dishonest option: it would tell someone their
 * password had changed when it had not. Saying plainly that the action needs a
 * connection is the honest one, and it is why this is a visible disabled state
 * rather than a silent failure at submit time.
 */
export function needsConnection(): boolean {
  return !connectivity.reachable;
}

export const NEEDS_CONNECTION_MESSAGE = 'Needs a connection — this one cannot wait offline.';
