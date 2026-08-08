// Instants, not the calendar dates in ./dates.ts: those are UTC midnight and are
// pinned to UTC on purpose, while a timestamp has to render in local time.

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const exact = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const STEPS: Array<{ ms: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { ms: 365 * MS_PER_DAY, unit: 'year' },
  { ms: 30 * MS_PER_DAY, unit: 'month' },
  { ms: 7 * MS_PER_DAY, unit: 'week' },
  { ms: MS_PER_DAY, unit: 'day' },
  { ms: MS_PER_HOUR, unit: 'hour' },
  { ms: MS_PER_MINUTE, unit: 'minute' },
];

// Truncated, never rounded: 90 minutes is an hour ago, not two. Anything under a
// minute is "just now" — the only timestamp shown this way is token use, which
// the server stamps about once a minute and no finer.
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';

  const elapsed = now.getTime() - at.getTime();
  const step = STEPS.find(({ ms }) => Math.abs(elapsed) >= ms);
  return step === undefined
    ? 'just now'
    : relative.format(-Math.trunc(elapsed / step.ms), step.unit);
}

export function formatExactTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : exact.format(at);
}
