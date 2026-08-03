export type RecurrencePreset =
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly_date'
  | 'monthly_weekday'
  | 'yearly';

export const RECURRENCE_PRESETS: readonly RecurrencePreset[] = [
  'daily',
  'weekdays',
  'weekly',
  'monthly_date',
  'monthly_weekday',
  'yearly',
];

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// Built from the string's own fields, never a local Date: toISOString() on one
// names the previous day for most of the evening west of Greenwich.
function utcDate(date: string): Date {
  return new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  );
}

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? 'th'
      : n % 10 === 1
        ? 'st'
        : n % 10 === 2
          ? 'nd'
          : n % 10 === 3
            ? 'rd'
            : 'th';
  return `${String(n)}${suffix}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// Option text for the recurrence menu only. A saved series displays the
// server's `summary`, which is the record; minor wording drift between the two
// is expected.
export function presetLabel(preset: RecurrencePreset, startDate: string): string {
  const start = utcDate(startDate);
  const dayOfMonth = start.getUTCDate();
  const weekday = WEEKDAY_NAMES[start.getUTCDay()];

  switch (preset) {
    case 'daily':
      return 'Every day';
    case 'weekdays':
      return 'Every weekday';
    case 'weekly':
      return `Every week on ${weekday}`;
    case 'monthly_date':
      return dayOfMonth <= 28
        ? `Monthly on the ${ordinal(dayOfMonth)}`
        : `Monthly on the ${ordinal(dayOfMonth)}, or the last day of shorter months`;
    case 'monthly_weekday': {
      const isLastWeek = dayOfMonth > daysInMonth(start.getUTCFullYear(), start.getUTCMonth()) - 7;
      return isLastWeek
        ? `Monthly on the last ${weekday}`
        : `Monthly on the ${ordinal(Math.floor((dayOfMonth - 1) / 7) + 1)} ${weekday}`;
    }
    case 'yearly':
      return start.getUTCMonth() === 1 && dayOfMonth === 29
        ? 'Every year on 29 February, or 28 February in non-leap years'
        : `Every year on ${String(dayOfMonth)} ${MONTH_NAMES[start.getUTCMonth()]}`;
  }
}
