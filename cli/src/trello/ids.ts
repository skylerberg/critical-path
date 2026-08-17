import { createHash } from 'node:crypto';

// Fixed namespace for this importer. Every Critical Path id is derived from the
// Trello id it came from, which is what makes the whole import replayable: a
// create that already landed answers 409 on the id rather than making a second
// row, so a run interrupted anywhere resumes by skipping what exists.
const NAMESPACE = 'a3f1c7e2-5b64-4d0a-9c8e-1f2b3d4e5a60';

function namespaceBytes(): Buffer {
  return Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
}

function uuidV5(name: string): string {
  const hash = createHash('sha1')
    .update(namespaceBytes())
    .update(Buffer.from(name, 'utf8'))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

// Distinct prefixes per entity: Trello ids are unique across types in practice,
// but a checklist item and the card it sits on colliding would be silent.
export const taskId = (trelloCardId: string): string => uuidV5(`card:${trelloCardId}`);
export const columnId = (key: string): string => uuidV5(`list:${key}`);
export const labelId = (trelloLabelId: string): string => uuidV5(`label:${trelloLabelId}`);
export const checklistItemId = (trelloItemId: string): string =>
  uuidV5(`checkitem:${trelloItemId}`);
export const attachmentId = (trelloAttachmentId: string): string =>
  uuidV5(`attachment:${trelloAttachmentId}`);
export const commentId = (trelloActionId: string): string => uuidV5(`comment:${trelloActionId}`);
