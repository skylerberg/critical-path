import rrulePkg from 'rrule';
import { AppError, errorText } from '../../utils/errors';

// rrule@2 ships CJS with no exports map, so the named ESM import resolves at
// type-check time and throws at runtime.
const { RRule, rrulestr } = rrulePkg;

export type RecurrencePreset =
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly_date'
  | 'monthly_weekday'
  | 'yearly';

const RECURRENCE_PRESETS: readonly RecurrencePreset[] = [
  'daily',
  'weekdays',
  'weekly',
  'monthly_date',
  'monthly_weekday',
  'yearly',
];

export const MAX_RRULE_LENGTH = 500;
const MAX_INTERVAL = 366;
const MAX_COUNT = 1000;
const MAX_UNTIL_YEAR = 2200;
// Bounds every search rather than leaving it to rrule's year-9999 limit, so a
// rule whose next occurrence is unreachable costs a fixed walk instead of
// millions of iterations inside the sweep.
const SEARCH_HORIZON_YEARS = 100;

const CALENDAR_FREQUENCIES = new Set([RRule.YEARLY, RRule.MONTHLY, RRule.WEEKLY, RRule.DAILY]);
const BANNED_SUBSTRINGS = ['DTSTART', 'TZID', 'RDATE', 'EXDATE', 'EXRULE'];
// One calendar day is one occurrence, so a time-of-day part adds nothing but
// iterations: BYHOUR+BYMINUTE+BYSECOND fits inside the length cap and multiplies
// every occurrence search by 86,400, inside the sweep's transaction.
const BANNED_TIME_PARTS = ['BYHOUR', 'BYMINUTE', 'BYSECOND'];
const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
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

// rrule with no tzid is "floating": it carries wall-clock fields in the UTC
// slots. Every date in this module is therefore built and read in UTC, and a
// single getFullYear() would shift every occurrence by a day west of Greenwich.
function toUtcDate(date: string): Date {
  return new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  );
}

function toDateString(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date: string, days: number): string {
  return toDateString(new Date(toUtcDate(date).getTime() + days * 86_400_000));
}

function addYears(date: string, years: number): string {
  const parsed = toUtcDate(date);
  return toDateString(
    new Date(Date.UTC(parsed.getUTCFullYear() + years, parsed.getUTCMonth(), parsed.getUTCDate()))
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

export function canonicalize(rrule: string): string {
  return RRule.optionsToString(RRule.parseString(rrule)).replace(/^RRULE:/, '');
}

function buildRule(rrule: string, startDate: string): InstanceType<typeof RRule> {
  return new RRule({ ...RRule.parseString(rrule), dtstart: toUtcDate(startDate) });
}

export function rruleForPreset(preset: RecurrencePreset, startDate: string): string {
  const start = toUtcDate(startDate);
  const weekday = WEEKDAY_CODES[start.getUTCDay()];
  const dayOfMonth = start.getUTCDate();
  const month = start.getUTCMonth() + 1;

  switch (preset) {
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekdays':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${weekday}`;
    case 'monthly_date':
      // BYMONTHDAY=31 alone skips every month without a 31st outright; pairing
      // it with the last day and taking the first of the set clamps instead.
      return dayOfMonth <= 28
        ? `FREQ=MONTHLY;BYMONTHDAY=${String(dayOfMonth)}`
        : `FREQ=MONTHLY;BYMONTHDAY=${String(dayOfMonth)},-1;BYSETPOS=1`;
    case 'monthly_weekday': {
      const isLastWeek = dayOfMonth > daysInMonth(start.getUTCFullYear(), start.getUTCMonth()) - 7;
      const nth = isLastWeek ? -1 : Math.floor((dayOfMonth - 1) / 7) + 1;
      return `FREQ=MONTHLY;BYDAY=${String(nth)}${weekday}`;
    }
    case 'yearly':
      return month === 2 && dayOfMonth === 29
        ? 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29,-1;BYSETPOS=1'
        : `FREQ=YEARLY;BYMONTH=${String(month)};BYMONTHDAY=${String(dayOfMonth)}`;
  }
}

export function presetFor(rrule: string, startDate: string): RecurrencePreset | null {
  let canonical: string;
  try {
    canonical = canonicalize(rrule);
  } catch {
    return null;
  }
  for (const preset of RECURRENCE_PRESETS) {
    if (canonicalize(rruleForPreset(preset, startDate)) === canonical) {
      return preset;
    }
  }
  return null;
}

function reject(detail: string): never {
  throw new AppError(422, `rrule must be ${detail}`);
}

export function assertUsableRrule(rrule: string, startDate: string): string {
  if (rrule.length > MAX_RRULE_LENGTH) {
    reject(`at most ${String(MAX_RRULE_LENGTH)} characters`);
  }
  const upper = rrule.toUpperCase();
  if (/[\r\n]/.test(rrule)) {
    reject('a single line');
  }
  if (upper.startsWith('RRULE:')) {
    reject('the rule value only, without the RRULE: prefix');
  }
  for (const banned of BANNED_SUBSTRINGS) {
    if (upper.includes(banned)) {
      reject(`free of ${banned} — the start date and timezone are separate fields`);
    }
  }
  for (const banned of BANNED_TIME_PARTS) {
    if (upper.includes(banned)) {
      reject(`free of ${banned} — an occurrence is a whole calendar day`);
    }
  }

  let options;
  try {
    options = RRule.parseString(rrule);
  } catch (err) {
    reject(`parseable (${errorText(err)})`);
  }

  if (options.freq === undefined || !CALENDAR_FREQUENCIES.has(options.freq)) {
    reject('a FREQ of DAILY, WEEKLY, MONTHLY or YEARLY');
  }
  if (options.interval !== undefined) {
    if (
      !Number.isInteger(options.interval) ||
      options.interval < 1 ||
      options.interval > MAX_INTERVAL
    ) {
      reject(`an INTERVAL between 1 and ${String(MAX_INTERVAL)}`);
    }
  }
  if (options.count !== undefined && options.count !== null) {
    if (!Number.isInteger(options.count) || options.count < 1 || options.count > MAX_COUNT) {
      reject(`a COUNT between 1 and ${String(MAX_COUNT)}`);
    }
  }
  if (options.until !== undefined && options.until !== null) {
    const until = options.until;
    if (Number.isNaN(until.getTime()) || until.getUTCFullYear() >= MAX_UNTIL_YEAR) {
      reject(`an UNTIL before ${String(MAX_UNTIL_YEAR)}`);
    }
  }

  const canonical = canonicalize(rrule);
  if (firstOccurrenceOnOrAfter(canonical, startDate, startDate) === null) {
    reject('a rule that occurs at least once on or after the start date');
  }
  return canonical;
}

function toText(rrule: string, startDate: string): string | null {
  try {
    const start = toUtcDate(startDate);
    const stamp = `${toDateString(start).replace(/-/g, '')}T000000Z`;
    const parsed = rrulestr(`DTSTART:${stamp}\nRRULE:${rrule}`);
    const text = parsed.toText();
    return text.trim() === '' ? null : text;
  } catch {
    return null;
  }
}

export function summarize(rrule: string, startDate: string): string {
  const preset = presetFor(rrule, startDate);
  if (preset !== null) {
    const start = toUtcDate(startDate);
    const dayOfMonth = start.getUTCDate();
    const weekdayName = WEEKDAY_NAMES[start.getUTCDay()];
    switch (preset) {
      case 'daily':
        return 'Every day';
      case 'weekdays':
        return 'Every weekday';
      case 'weekly':
        return `Every ${weekdayName}`;
      case 'monthly_date':
        return dayOfMonth <= 28
          ? `Monthly on the ${ordinal(dayOfMonth)}`
          : `Monthly on the ${ordinal(dayOfMonth)}, or the last day of shorter months`;
      case 'monthly_weekday': {
        const isLastWeek =
          dayOfMonth > daysInMonth(start.getUTCFullYear(), start.getUTCMonth()) - 7;
        return isLastWeek
          ? `Monthly on the last ${weekdayName}`
          : `Monthly on the ${ordinal(Math.floor((dayOfMonth - 1) / 7) + 1)} ${weekdayName}`;
      }
      case 'yearly': {
        const monthName = MONTH_NAMES[start.getUTCMonth()];
        return start.getUTCMonth() === 1 && dayOfMonth === 29
          ? 'Every year on 29 February, or 28 February in non-leap years'
          : `Every year on ${String(dayOfMonth)} ${monthName}`;
      }
    }
  }
  return toText(rrule, startDate) ?? rrule;
}

export function occurrencesBetween(
  rrule: string,
  startDate: string,
  from: string,
  to: string,
  cap: number
): string[] {
  if (cap <= 0 || from > to) {
    return [];
  }
  const rule = buildRule(rrule, startDate);
  const dates: string[] = [];
  const seen = new Set<string>();
  rule.between(toUtcDate(from), toUtcDate(to), true, (occurrence) => {
    const text = toDateString(occurrence);
    if (!seen.has(text)) {
      seen.add(text);
      dates.push(text);
    }
    return dates.length < cap;
  });
  return dates;
}

function searchOne(
  rrule: string,
  startDate: string,
  from: string,
  inclusive: boolean
): string | null {
  const rule = buildRule(rrule, startDate);
  let found: string | null = null;
  rule.between(toUtcDate(from), toUtcDate(addYears(from, SEARCH_HORIZON_YEARS)), true, (day) => {
    const text = toDateString(day);
    if (inclusive ? text >= from : text > from) {
      found = text;
      return false;
    }
    return true;
  });
  return found;
}

export function nextOccurrenceAfter(
  rrule: string,
  startDate: string,
  after: string
): string | null {
  return searchOne(rrule, startDate, after, false);
}

export function firstOccurrenceOnOrAfter(
  rrule: string,
  startDate: string,
  from: string
): string | null {
  return searchOne(rrule, startDate, from, true);
}
