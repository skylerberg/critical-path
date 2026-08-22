// How often the realtime server pings an open socket. Its own module for the
// same reason closeCodes.ts is one: `src/spec/realtime-events.ts` publishes it
// and must be able to read it without importing the ws server and the db pool
// that transport.ts pulls in.
//
// It is protocol, not an implementation detail. A client that gives up on
// silence sizes its timeout against this number, so raising it here without the
// clients knowing turns every healthy socket into a timeout — a reconnect loop
// that looks exactly like a flaky network and that nothing in CI would notice.
// The document publishes it as a literal type, which is what makes a client's
// own copy of the number fail to compile instead.
export const HEARTBEAT_INTERVAL_MS = 30_000;
