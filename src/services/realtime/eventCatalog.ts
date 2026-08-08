// Every realtime event the server publishes, each classified once. The three
// facts that used to live in separate lists — that a type exists, whether it
// reaches webhook registrations, and whether it raises the unseen-changes dot —
// are columns of one table, so a new type cannot be added without deciding all
// of them and cannot be misspelled at a publish site. README.md carries the
// payload catalogue; this file carries the classification.

// No project id, so neither of the project-scoped columns applies: publishing
// one returns before the dot and the webhook queue are ever consulted.
//
// What a project event answers with its project — who receives this — an
// account event has to answer here, because the delivery layer has no room to
// fall back to: an account entry that reaches deliverProjectScoped is dropped
// on the null project id, silently and with nothing logged. So the column is
// what stops that being a runtime accident. `namedRecipients` is the only kind
// whose audience the publish site knows, and publishAfterCommit's overloads
// require exactly that kind to carry `recipientUserIds`; the other two are
// answered by a dedicated branch and take no publish options at all.
type AccountEvent = {
  scope: 'account';
  delivery:
    | 'namedRecipients' // deliver() → the exact-recipient shortcut
    | 'projectSharers' // deliver() → deliverUserUpdated
    | 'intercepted'; // handleBusEntry closes sockets; never delivered
};

type ProjectEvent = {
  scope: 'project';
  // Reaches webhook registrations. False for a type that targets an exact
  // recipient list (project_position_updated, project_seen), describes a row
  // that cannot have a registration at send time (project_created,
  // project_deleted), restates a change that already went out under its own
  // type (project_changed), is readable only by a subset of a project's people
  // (invitations_changed), or is a batched envelope a consumer subscribed to
  // per-card changes has no schema for (every column_tasks_* and bulk_tasks_*).
  webhook: boolean;
  // Raises the unseen-changes dot. False only when the type leaves behind no
  // activity or comment row, so a board read would not report it as changed
  // either and the dot would be one no amount of looking could clear. When a
  // new type is genuinely ambiguous, pick true: a dot too many costs one
  // glance, a dot missing costs the feature.
  raisesUnseenDot: boolean;
};

const EVENTS = {
  project_created: { scope: 'project', webhook: false, raisesUnseenDot: false },
  project_updated: { scope: 'project', webhook: true, raisesUnseenDot: false },
  project_deleted: { scope: 'project', webhook: false, raisesUnseenDot: false },
  project_position_updated: { scope: 'project', webhook: false, raisesUnseenDot: false },
  project_seen: { scope: 'project', webhook: false, raisesUnseenDot: false },
  // Emitted by publishAfterCommit itself to carry the dot, so dotting on it
  // would be circular.
  project_changed: { scope: 'project', webhook: false, raisesUnseenDot: false },
  // Not board content, and the dot would be one every viewer sees for a change
  // none of them may read.
  invitations_changed: { scope: 'project', webhook: false, raisesUnseenDot: false },

  column_created: { scope: 'project', webhook: true, raisesUnseenDot: false },
  column_updated: { scope: 'project', webhook: true, raisesUnseenDot: false },
  column_deleted: { scope: 'project', webhook: true, raisesUnseenDot: true },
  column_tasks_moved: { scope: 'project', webhook: false, raisesUnseenDot: true },
  column_tasks_reordered: { scope: 'project', webhook: false, raisesUnseenDot: false },
  column_tasks_archived: { scope: 'project', webhook: false, raisesUnseenDot: false },

  task_created: { scope: 'project', webhook: true, raisesUnseenDot: true },
  task_updated: { scope: 'project', webhook: true, raisesUnseenDot: true },
  task_restored: { scope: 'project', webhook: true, raisesUnseenDot: true },
  task_relations_set: { scope: 'project', webhook: true, raisesUnseenDot: true },
  // Both take their card off the board, and its activity goes with it, so a
  // reader would find nothing to notice.
  task_deleted: { scope: 'project', webhook: true, raisesUnseenDot: false },
  task_archived: { scope: 'project', webhook: true, raisesUnseenDot: false },

  // Reaches a project the actor need not belong to, carrying a recount caused by
  // a card they cannot see. No webhook, because nothing in this project changed
  // that a registration could describe; no dot, because the change writes no
  // activity or comment row here, so a board read reports nothing and the dot
  // could never be cleared.
  cross_project_blockers_changed: { scope: 'project', webhook: false, raisesUnseenDot: false },

  bulk_tasks_moved: { scope: 'project', webhook: false, raisesUnseenDot: true },
  bulk_tasks_relations_set: { scope: 'project', webhook: false, raisesUnseenDot: true },
  bulk_tasks_archived: { scope: 'project', webhook: false, raisesUnseenDot: false },

  label_created: { scope: 'project', webhook: true, raisesUnseenDot: false },
  label_updated: { scope: 'project', webhook: true, raisesUnseenDot: false },
  label_deleted: { scope: 'project', webhook: true, raisesUnseenDot: true },

  attachment_created: { scope: 'project', webhook: true, raisesUnseenDot: false },
  attachment_updated: { scope: 'project', webhook: true, raisesUnseenDot: false },
  attachment_deleted: { scope: 'project', webhook: true, raisesUnseenDot: false },

  comment_created: { scope: 'project', webhook: true, raisesUnseenDot: true },
  comment_updated: { scope: 'project', webhook: true, raisesUnseenDot: false },
  comment_deleted: { scope: 'project', webhook: true, raisesUnseenDot: false },

  checklist_item_created: { scope: 'project', webhook: true, raisesUnseenDot: true },
  checklist_item_updated: { scope: 'project', webhook: true, raisesUnseenDot: true },
  checklist_item_deleted: { scope: 'project', webhook: true, raisesUnseenDot: true },

  // A schedule writes no activity row, so a board read reports nothing changed
  // and the dot would be one no amount of looking at the board clears.
  series_created: { scope: 'project', webhook: false, raisesUnseenDot: false },
  series_updated: { scope: 'project', webhook: false, raisesUnseenDot: false },
  series_deleted: { scope: 'project', webhook: false, raisesUnseenDot: false },

  sessions_revoked: { scope: 'account', delivery: 'intercepted' },
  user_updated: { scope: 'account', delivery: 'projectSharers' },
  // Self-only: the payload is the subject's own record, address included, so
  // every publisher has to name them.
  account_updated: { scope: 'account', delivery: 'namedRecipients' },
} as const satisfies Record<string, AccountEvent | ProjectEvent>;

export type RealtimeEventType = keyof typeof EVENTS;

type OfScope<S extends 'account' | 'project'> = {
  [K in RealtimeEventType]: (typeof EVENTS)[K]['scope'] extends S ? K : never;
}[RealtimeEventType];

export type AccountEventType = OfScope<'account'>;
export type ProjectEventType = OfScope<'project'>;

// The account types whose audience only the publish site knows. Split out so
// publishAfterCommit can demand `recipientUserIds` from exactly these and
// refuse it from the rest, rather than accepting a publish that would reach
// nobody.
export type NamedRecipientEventType = {
  [K in AccountEventType]: (typeof EVENTS)[K] extends { delivery: 'namedRecipients' } ? K : never;
}[AccountEventType];

export type DispatchedEventType = Exclude<AccountEventType, NamedRecipientEventType>;

export type WebhookEventType = {
  [K in ProjectEventType]: (typeof EVENTS)[K] extends { webhook: true } ? K : never;
}[ProjectEventType];

export const REALTIME_EVENT_TYPES = Object.keys(EVENTS) as RealtimeEventType[];

// Takes a string rather than the union: the lookups tolerate a type outside it
// rather than throwing, because a TypeError raised from inside
// publishAfterCommit would roll back the mutation that published it.
export function isWebhookEvent(type: string): type is WebhookEventType {
  const event: (typeof EVENTS)[RealtimeEventType] | undefined = EVENTS[type as RealtimeEventType];
  return event?.scope === 'project' && event.webhook;
}

export const WEBHOOK_EVENT_TYPES: ReadonlySet<WebhookEventType> = new Set(
  REALTIME_EVENT_TYPES.filter(isWebhookEvent)
);

// Null for a type outside the catalogue, so one call answers both "is this a
// real event type" and "which scope does it belong to" — which is what
// validating an envelope that arrived from another replica needs.
export function eventScope(type: string): 'account' | 'project' | null {
  const event: (typeof EVENTS)[RealtimeEventType] | undefined = EVENTS[type as RealtimeEventType];
  return event?.scope ?? null;
}

// Takes the whole union rather than ProjectEventType so callers that have not
// yet narrowed on the project id need no cast: an account event carries no
// project and so can never raise a dot.
export function raisesUnseenDot(type: RealtimeEventType): boolean {
  const event: (typeof EVENTS)[RealtimeEventType] | undefined = EVENTS[type];
  return event?.scope === 'project' && event.raisesUnseenDot;
}
