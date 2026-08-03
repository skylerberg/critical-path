export interface WebhookEvent {
  type: string;
  project_id: string;
  data: unknown;
}

// The project-scoped, deliverable subset of the realtime catalogue. Types are
// excluded when they carry no project (user_updated, sessions_revoked), target
// an exact recipient list (project_position_updated, project_seen), describe a
// row that cannot have a registration at send time (project_created,
// project_deleted), or restate a change that already went out under its own type
// (project_changed).
export const WEBHOOK_EVENT_TYPES: ReadonlySet<string> = new Set([
  'task_created',
  'task_updated',
  'task_deleted',
  'task_archived',
  'task_restored',
  'task_relations_set',
  'column_created',
  'column_updated',
  'column_deleted',
  'label_created',
  'label_updated',
  'label_deleted',
  'image_created',
  'image_deleted',
  'comment_created',
  'comment_updated',
  'comment_deleted',
  'project_updated',
]);

export function isWebhookEvent(type: string): boolean {
  return WEBHOOK_EVENT_TYPES.has(type);
}
