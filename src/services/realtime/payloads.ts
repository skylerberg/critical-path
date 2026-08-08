import { type } from 'arktype';
import {
  archivedTaskSchema,
  attachmentSchema,
  boardTaskSchema,
  bulkTaskRelationsSchema,
  checklistItemSchema,
  columnSchema,
  commentSchema,
  labelSchema,
  meSchema,
  movedTaskSchema,
  projectSchema,
  taskSeriesSchema,
  userSchema,
} from '../../schemas/index';
import { isWebhookEvent } from './eventCatalog';
import type { AccountEventType, RealtimeEventType, WebhookEventType } from './eventCatalog';

// The payload shape of every realtime event, beside the classification table in
// eventCatalog.ts. Publishing is generic over the event type, so a payload that
// disagrees with its row here is a type error at the publish site rather than a
// README row that drifts. The README table and the clients' event types are both
// generated from this map (`npm run realtime:dump`).
//
// Deliberately not re-exported from src/schemas/index.ts, unlike every schema
// that describes a request or response: the OpenAPI schema-name registry hashes
// each schema in that barrel and throws on two that produce identical JSON
// Schema, which the bare `{ id }` payloads below would. /ws is not part of the
// OpenAPI spec, so these reach clients through realtime-events.json instead.

const idOnly = type({ id: 'string' });

const checklistCounts = {
  checklist_item_count: 'number',
  checklist_done_count: 'number',
} as const;

// project_created and project_updated carry the projects-list item without its
// three per-caller answers: sort_key, last_seen_at and has_unseen_changes are
// about the reader, and one broadcast payload cannot hold a different value of
// them for every recipient.
const projectListItemEvent = projectSchema.merge({
  open_task_count: 'number',
  done_task_count: 'number',
});

export const REALTIME_PAYLOAD_SCHEMAS = {
  project_created: projectListItemEvent,
  project_updated: projectListItemEvent,
  project_deleted: idOnly,
  project_position_updated: type({ id: 'string', sort_key: 'string' }),
  project_seen: idOnly,
  // Null when a schedule materialised the change with no caller behind it. The
  // dot ignores its own actor, so a client compares this against its user id.
  project_changed: type({ id: 'string', actor_user_id: 'string | null' }),
  invitations_changed: type({ project_id: 'string' }),

  column_created: columnSchema,
  column_updated: columnSchema,
  column_deleted: type({ id: 'string', moved_tasks: movedTaskSchema.array() }),
  column_tasks_moved: type({
    column_id: 'string',
    target_column_id: 'string',
    moved_tasks: movedTaskSchema.array(),
  }),
  column_tasks_reordered: type({ column_id: 'string', moved_tasks: movedTaskSchema.array() }),
  column_tasks_archived: type({ column_id: 'string', tasks: archivedTaskSchema.array() }),

  task_created: boardTaskSchema,
  task_updated: boardTaskSchema,
  task_restored: boardTaskSchema,
  task_relations_set: bulkTaskRelationsSchema,
  task_deleted: idOnly,
  task_archived: archivedTaskSchema,

  // Deliberately just the recount: this event crosses into a project whose
  // members may have no access to the blocker that moved, so it names nothing
  // about the far side.
  cross_project_blockers_changed: type({
    tasks: type({ task_id: 'string', open_cross_project_blocker_count: 'number' }).array(),
  }),

  bulk_tasks_moved: type({ moved_tasks: movedTaskSchema.array() }),
  bulk_tasks_relations_set: type({ tasks: bulkTaskRelationsSchema.array() }),
  bulk_tasks_archived: type({ tasks: archivedTaskSchema.array() }),

  label_created: labelSchema,
  label_updated: labelSchema,
  label_deleted: idOnly,

  attachment_created: attachmentSchema.merge({ attachment_count: 'number' }),
  attachment_updated: attachmentSchema,
  attachment_deleted: type({
    id: 'string',
    task_id: 'string',
    attachment_count: 'number',
    cover_image_url: 'string | null',
  }),

  comment_created: commentSchema.merge({ comment_count: 'number' }),
  comment_updated: commentSchema,
  comment_deleted: type({ id: 'string', task_id: 'string', comment_count: 'number' }),

  checklist_item_created: checklistItemSchema.merge(checklistCounts),
  checklist_item_updated: checklistItemSchema.merge(checklistCounts),
  checklist_item_deleted: type({ id: 'string', task_id: 'string' }).merge(checklistCounts),

  series_created: taskSeriesSchema,
  series_updated: taskSeriesSchema,
  series_deleted: idOnly,

  // Never delivered to a client: the transport intercepts it to close sockets.
  // It is typed here because the transport reads the payload to decide which.
  // user_id is required because it is the dispatch fallback when neither of the
  // narrower ids is present.
  sessions_revoked: type({
    user_id: 'string',
    'personal_access_token_id?': 'string',
    'session_id?': 'string',
  }),
  user_updated: userSchema,
  // The subject's own record — the same shape GET /api/auth/me answers with,
  // which is exactly why it is delivered to no socket but theirs.
  account_updated: meSchema,
  // Both directions are load-bearing: a missing key fails the mapped type
  // below, and an excess one fails this check.
} satisfies Record<RealtimeEventType, unknown>;

export type RealtimePayloads = {
  [K in RealtimeEventType]: (typeof REALTIME_PAYLOAD_SCHEMAS)[K]['infer'];
};

// One envelope per event type rather than one envelope with a widened `type` and
// an `unknown` payload, so the bus, the delivery layer, the transport and the
// out-of-band publishers all narrow to a real payload by testing `type`. The
// project id is part of the pairing: an account event carries null and a
// project event carries a string, which is the invariant publishAfterCommit's
// overloads used to be the only thing enforcing.
type EnvelopeFor<T extends RealtimeEventType> = {
  type: T;
  project_id: T extends AccountEventType ? null : string;
  data: RealtimePayloads[T];
};

export type RealtimeEnvelope = {
  [K in RealtimeEventType]: EnvelopeFor<K>;
}[RealtimeEventType];

export type WebhookEnvelope = Extract<RealtimeEnvelope, { type: WebhookEventType }>;

export function isWebhookEnvelope(entry: RealtimeEnvelope): entry is WebhookEnvelope {
  return isWebhookEvent(entry.type);
}
