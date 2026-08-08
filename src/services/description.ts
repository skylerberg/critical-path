import type { TiptapDoc } from '../schemas/index';

// The generated Json column type has an index signature the TiptapDoc interface
// cannot satisfy; jsonb parses the text back into the same document.
export function serializeDescription(description: TiptapDoc | null | undefined): string | null {
  return description == null ? null : JSON.stringify(description);
}
