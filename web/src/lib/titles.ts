// Mirrors the API's bound so a title the server would refuse cannot be typed.
export const TASK_TITLE_MAX_LENGTH = 2000;

// Surfaces built for scanning stop here; the one that exists to read a card
// renders the title whole.
export const TITLE_DISPLAY_LIMIT = 500;

export function truncateTitle(title: string, limit: number = TITLE_DISPLAY_LIMIT): string {
  if (title.length <= limit) {
    return title;
  }
  // Code points, not units: half a surrogate pair renders as a replacement character.
  const points = [...title];
  return points.length <= limit ? title : `${points.slice(0, limit).join('').trimEnd()}…`;
}
