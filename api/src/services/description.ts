import type { TiptapDoc } from '../schemas/index';

// Returns JSON text rather than an object: the generated Json column type has
// an index signature the TiptapDoc interface cannot satisfy, and jsonb parses
// the text back into the same document.
export function serializeDescription(description: TiptapDoc | null | undefined): string | null {
  return description == null ? null : JSON.stringify(description);
}
