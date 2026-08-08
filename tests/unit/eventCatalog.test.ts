import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  REALTIME_EVENT_TYPES,
  carriesActor,
  raisesUnseenDot,
  type RealtimeEventType,
} from '../../src/services/realtime/eventCatalog';

// The envelope table in README.md is the client-facing catalog, and the one
// registry the type system cannot reach. A new event type that never reaches it
// is undocumented; a row that outlives its type misleads an integrator.
function documentedEventTypes(): Set<string> {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  const types = new Set<string>();
  for (const line of readme.split('\n')) {
    const firstColumn = line.match(/^\|\s*(`[a-z_]+`(?:\s*\/\s*`[a-z_]+`)*)\s*\|/);
    if (!firstColumn) continue;
    for (const [, type] of firstColumn[1].matchAll(/`([a-z_]+)`/g)) {
      types.add(type);
    }
  }
  return types;
}

// The dot half of the catalog, pinned the way the webhook half is in
// webhooks.test.ts: changing a classification should be a decision someone makes
// here too, not a line that slips through in a larger diff.
const RAISES_DOT: RealtimeEventType[] = [
  'column_deleted',
  'column_tasks_moved',
  'task_created',
  'task_updated',
  'task_restored',
  'task_relations_set',
  'bulk_tasks_moved',
  'bulk_tasks_relations_set',
  'label_deleted',
  'comment_created',
  'checklist_item_created',
  'checklist_item_updated',
  'checklist_item_deleted',
];

// The actor half, pinned the same way. A type quietly losing its actor would
// leave a client unable to tell a teammate's change from an echo of its own,
// which is silence rather than an error and so has to fail here.
const CARRIES_ACTOR: RealtimeEventType[] = [
  'project_changed',
  'column_created',
  'column_updated',
  'column_deleted',
  'column_tasks_moved',
  'column_tasks_reordered',
  'column_tasks_archived',
  'task_created',
  'task_updated',
  'task_restored',
  'task_relations_set',
  'task_deleted',
  'task_archived',
  'bulk_tasks_moved',
  'bulk_tasks_relations_set',
  'bulk_tasks_archived',
  'label_created',
  'label_updated',
  'label_deleted',
  'attachment_created',
  'attachment_updated',
  'attachment_deleted',
  'comment_created',
  'comment_updated',
  'comment_deleted',
  'checklist_item_created',
  'checklist_item_updated',
  'checklist_item_deleted',
];

describe('realtime event catalog', () => {
  it('documents every type it publishes, and publishes every type it documents', () => {
    const documented = documentedEventTypes();
    const cataloged = new Set<string>(REALTIME_EVENT_TYPES);

    expect([...cataloged].filter((type) => !documented.has(type)).sort()).toEqual([]);
    expect([...documented].filter((type) => !cataloged.has(type)).sort()).toEqual([]);
  });

  it('raises the unseen-changes dot for exactly the types that leave a trace on the board', () => {
    const raising = REALTIME_EVENT_TYPES.filter(raisesUnseenDot).sort();
    expect(raising).toEqual([...RAISES_DOT].sort());
  });

  it('never dots an account-scoped event, which carries no project to dot', () => {
    expect(raisesUnseenDot('sessions_revoked')).toBe(false);
    expect(raisesUnseenDot('user_updated')).toBe(false);
    expect(raisesUnseenDot('account_updated')).toBe(false);
  });

  it('names an actor on exactly the board mutations a client has to attribute', () => {
    const naming = REALTIME_EVENT_TYPES.filter(carriesActor).sort();
    expect(naming).toEqual([...CARRIES_ACTOR].sort());
  });

  it('never claims an actor for an account-scoped event, which reaches only its subject', () => {
    expect(carriesActor('sessions_revoked')).toBe(false);
    expect(carriesActor('user_updated')).toBe(false);
    expect(carriesActor('account_updated')).toBe(false);
  });
});
