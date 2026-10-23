import type { TiptapDoc } from '../schemas/index';

// `TiptapDoc` has no index signature, so it will not assign to the generated
// `Json` column type; a JSON string will, and jsonb parses it back into the same
// document.
export function serializeDescription(description: TiptapDoc | null | undefined): string | null {
  return description == null ? null : JSON.stringify(description);
}
