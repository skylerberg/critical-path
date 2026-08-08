import type { Kysely } from 'kysely';
import type { DB } from '../../db/types';
import { IMAGE_KIND } from './index';

export interface CopyAttachmentsInput {
  sourceTaskIds: string[];
  taskIdMap: Map<string, string>;
  // Image ids the caller has already minted, because a copied description has
  // to name them before this runs. Any image absent from it gets a fresh id.
  imageIdMap?: Map<string, string>;
  insertChunk: number;
}

interface ObjectCopy {
  source: string;
  dest: string;
}

export interface CopiedAttachments {
  objectCopies: ObjectCopy[];
  // Source image id -> copy image id. Descriptions embed `/api/images/<id>`, so
  // the caller needs this to point a copied card's text at its own pictures.
  imageIdMap: Map<string, string>;
}

// No job is enqueued for a copy, so a source still mid-unfurl would leave its
// copy spinning at 'pending' for good; the copy settles instead.
function copiedUnfurlState(state: string | null): string | null {
  return state === 'pending' ? 'failed' : state;
}

// Links keep the metadata their unfurl already produced; the copy re-fetches
// nothing, so duplicating a card never makes an outbound request.
export async function copyTaskAttachments(
  db: Kysely<DB>,
  input: CopyAttachmentsInput
): Promise<CopiedAttachments> {
  const empty: CopiedAttachments = { objectCopies: [], imageIdMap: new Map() };
  if (input.sourceTaskIds.length === 0) {
    return empty;
  }

  const rows = await db
    .selectFrom('task_attachment')
    .select([
      'task_attachment.task_id',
      'task_attachment.kind',
      'task_attachment.title',
      'task_attachment.description',
      'task_attachment.filename',
      'task_attachment.content_type',
      'task_attachment.size_bytes',
      'task_attachment.storage_key',
      'task_attachment.url',
      'task_attachment.preview_storage_key',
      'task_attachment.favicon_storage_key',
      'task_attachment.unfurl_state',
      'task_attachment.id',
      'task_attachment.image_storage_key',
      'task_attachment.image_content_type',
      'task_attachment.is_cover',
    ])
    .where('task_attachment.task_id', 'in', input.sourceTaskIds)
    .execute();
  if (rows.length === 0) {
    return empty;
  }

  const objectCopies: ObjectCopy[] = [];
  const remapKey = (source: string | null): string | null => {
    if (source === null) return null;
    const dest = crypto.randomUUID();
    objectCopies.push({ source, dest });
    return dest;
  };

  const imageIdMap = new Map(input.imageIdMap ?? []);

  const values = rows.map((row) => {
    const isImage = row.kind === IMAGE_KIND;
    const id = (isImage ? imageIdMap.get(row.id) : undefined) ?? crypto.randomUUID();
    if (isImage) {
      imageIdMap.set(row.id, id);
    }
    return {
      id,
      task_id: input.taskIdMap.get(row.task_id) as string,
      kind: row.kind,
      title: row.title,
      description: row.description,
      filename: row.filename,
      content_type: row.content_type,
      size_bytes: row.size_bytes,
      storage_key: remapKey(row.storage_key),
      url: row.url,
      preview_storage_key: remapKey(row.preview_storage_key),
      favicon_storage_key: remapKey(row.favicon_storage_key),
      unfurl_state: copiedUnfurlState(row.unfurl_state),
      image_storage_key: remapKey(row.image_storage_key),
      image_content_type: row.image_content_type,
      is_cover: row.is_cover,
    };
  });

  for (let start = 0; start < values.length; start += input.insertChunk) {
    await db
      .insertInto('task_attachment')
      .values(values.slice(start, start + input.insertChunk))
      .execute();
  }

  return { objectCopies, imageIdMap };
}
