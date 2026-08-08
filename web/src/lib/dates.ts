export type DueStatus = 'done' | 'overdue' | 'soon' | 'neutral';

export const SOON_DAYS = 1;

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

// Every caller gates on this first, which is what makes an API pod that predates
// the field render as "no due date" instead of throwing on `undefined`.
export function isCalendarDate(value: unknown): value is string {
  return typeof value === 'string' && CALENDAR_DATE.test(value);
}

// Built from the local fields, never toISOString(): west of Greenwich that would
// name tomorrow for most of the evening.
export function todayISO(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${String(now.getFullYear())}-${month}-${day}`;
}

function utcMs(date: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10))
  );
}

export function daysUntil(due: string, today: string): number {
  return Math.round((utcMs(due) - utcMs(today)) / MS_PER_DAY);
}

export function dueStatus(due: string, isDone: boolean, today: string): DueStatus {
  if (isDone) return 'done';
  const days = daysUntil(due, today);
  if (days < 0) return 'overdue';
  if (days <= SOON_DAYS) return 'soon';
  return 'neutral';
}

// timeZone: 'UTC' on both, because the dates they format are UTC midnight and any
// other zone renders the day before for half the world.
const dayMonth = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const dayMonthYear = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatFullDate(due: string): string {
  return dayMonthYear.format(new Date(utcMs(due)));
}

// Deliberately not UTC-pinned, unlike the formatters above: this one names an
// instant, so the reader's own zone is the right one to show it in.
const timestamp = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatTimestamp(iso: string): string {
  return timestamp.format(new Date(iso));
}

export function formatDue(due: string, today: string): string {
  const days = daysUntil(due, today);
  if (days === -1) return 'Yesterday';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return due.slice(0, 4) === today.slice(0, 4)
    ? dayMonth.format(new Date(utcMs(due)))
    : formatFullDate(due);
}
