import type { PayloadOf, RealtimeEvent, RealtimeEventType } from './realtime-types';

// Test-only, and in src/lib rather than beside the tests because tests in both
// src/lib and src/components import it.
//
// The payload is a Partial so a test can name the two or three fields it is
// exercising, but the field *names* are still checked — a fixture naming one the
// API does not send is a compile error, which is the drift that used to reach
// production.
export function realtimeEvent<T extends RealtimeEventType>(
  type: T,
  data: Partial<PayloadOf<T>>,
  projectId: string | null = 'p1'
): RealtimeEvent {
  // Through unknown because a Partial payload is deliberately not one of the
  // union's members; the checking this exists for happens on the argument.
  return { type, project_id: projectId, data } as unknown as RealtimeEvent;
}
