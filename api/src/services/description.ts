import type { TiptapDoc } from '../schemas/index';

// The generated Json column type has an index signature that the TiptapDoc
// interface does not satisfy, so the row stores JSON text; jsonb parses it back
// into the same document on read.
export function serializeDescription(description: TiptapDoc | null | undefined): string | null {
  return description == null ? null : JSON.stringify(description);
}
