// The application close codes a `/ws` socket can be closed with, as one table,
// because a close code is protocol a client must route on and nothing else in
// the realtime contract describes it: the generated event types come from the
// payload catalog, so a code added or repurposed here changed no payload and
// reached the clients as silence. `src/spec/realtime-events.ts` publishes this
// table into the realtime document, which is what turns the next such change
// into a compile error in a client rather than a socket it reconnects forever.
//
// Standard RFC 6455 codes are deliberately absent: they mean the same thing for
// every WebSocket, so a client needs no contract of ours to handle them.
//
// Its own module so the spec layer can read two integers without importing the
// ws server and the db pool that transport.ts pulls in.

export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_TOO_MANY = 4429;

export const REALTIME_CLOSE_CODES = [
  {
    code: CLOSE_UNAUTHORIZED,
    name: 'unauthorized',
    meaning:
      'The credential behind the socket is missing, invalid, or revoked; reconnecting is pointless until a fresh one is in hand.',
  },
  {
    code: CLOSE_TOO_MANY,
    name: 'too_many_connections',
    meaning:
      "The account holds too many live sockets and this was the oldest, so the credential is still good; reconnecting at once only evicts another of the account's sockets.",
  },
] as const;
