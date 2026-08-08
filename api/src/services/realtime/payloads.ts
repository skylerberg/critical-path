import { type } from 'arktype';
import type { Type } from 'arktype';
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
import { carriesActor, isWebhookEvent } from './eventCatalog';
import type {
  AccountEventType,
  ActorEventType,
  RealtimeEventType,
  WebhookEventType,
} from './eventCatalog';

// Never re-export this module from src/schemas/index.ts: the OpenAPI schema-name
// registry hashes every schema in that barrel and throws on two that produce
// identical JSON Schema, which the bare `{ id }` payloads below would.

const idOnly = type({ id: 'string' });

const actorField = { actor_user_id: 'string | null' } as const;

type ActorField = { actor_user_id: string | null };

type PayloadRows = Record<RealtimeEventType, { infer: unknown }>;

type WithActor<T extends PayloadRows> = {
  [K in keyof T]: K extends ActorEventType ? Type<T[K]['infer'] & ActorField> : T[K];
};

// Merged from the catalogue rather than restated on each of the twenty-eight
// rows that want it: the row that says a type names its actor is then the same
// row publishAfterCommit reads to fill it in, so a type cannot get one without
// the other.
function withActor<T extends PayloadRows>(rows: T): WithActor<T> {
  return Object.fromEntries(
    Object.entries(rows).map(([eventType, schema]) => [
      eventType,
      carriesActor(eventType) ? (schema as unknown as Type<object>).merge(actorField) : schema,
    ])
  ) as WithActor<T>;
}

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

export const REALTIME_PAYLOAD_SCHEMAS = withActor({
  project_created: projectListItemEvent,
  project_updated: projectListItemEvent,
  project_deleted: idOnly,
  project_position_updated: type({ id: 'string', sort_key: 'string' }),
  project_seen: idOnly,
  // The actor comes from the catalogue like every other one; it is null when a
  // schedule materialised the change with no caller behind it. The dot ignores
  // its own actor, so a client compares it against its user id.
  project_changed: idOnly,
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
} satisfies Record<RealtimeEventType, unknown>);

export type RealtimePayloads = {
  [K in RealtimeEventType]: (typeof REALTIME_PAYLOAD_SCHEMAS)[K]['infer'];
};

// What a publish site provides. publishAfterCommit fills actor_user_id in from
// the session, so a caller that restated it would be restating something it
// cannot get wrong. publish() still takes the whole payload, which is what makes
// the two publishers outside a request name someone by hand.
export type CallerPayload<T extends RealtimeEventType> = T extends ActorEventType
  ? Omit<RealtimePayloads[T], 'actor_user_id'>
  : RealtimePayloads[T];

// The project id belongs to the pairing an event type implies: an account event
// carries null, a project event a string.
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
