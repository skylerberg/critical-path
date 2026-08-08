import type { PayloadOf, RealtimeEvent, RealtimeEventType } from './realtime-types';

// Test-only, and in src/lib beside bulkTestSetup.ts for the same reason: it is
// imported by tests across both src/lib and src/components.
//
// A test asserts about the two or three fields it is exercising, not the twenty
// a board task carries, so the payload is a Partial of the real one. The field
// *names* are still checked, which is the half that matters: a fixture naming
// `position` on a project reorder — a field the API stopped sending — is a
// compile error here, and it was a fixture exactly like that which let the web
// app read `position` from `project_position_updated` for several releases while
// its tests passed.
export function realtimeEvent<T extends RealtimeEventType>(
  type: T,
  data: Partial<PayloadOf<T>>,
  projectId: string | null = 'p1'
): RealtimeEvent {
  // Through unknown because a Partial payload is deliberately not one of the
  // union's members; the checking this exists for happens on the argument.
  return { type, project_id: projectId, data } as unknown as RealtimeEvent;
}
