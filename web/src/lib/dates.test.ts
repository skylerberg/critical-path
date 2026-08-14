import { describe, expect, it } from 'vitest';
import {
  daysUntil,
  dueStatus,
  formatDue,
  formatFullDate,
  formatTimestamp,
  isCalendarDate,
  todayISO,
  utcMs,
} from './dates';

const TODAY = '2026-08-03';

// The module formats with the host locale, so a literal 'Aug 20' would fail on an
// en-GB machine; an independent UTC formatter still catches a dropped timeZone.
function absolute(iso: string, withYear: boolean): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

describe('isCalendarDate', () => {
  it.each([undefined, null, '', '2026-8-3', '2026-08-03T00:00:00Z', 42])('rejects %p', (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });

  it('accepts a bare calendar day', () => {
    expect(isCalendarDate('2026-08-03')).toBe(true);
  });
});

describe('todayISO', () => {
  it('reads the local day, not the UTC one', () => {
    expect(todayISO(new Date(2026, 7, 3, 23, 30))).toBe('2026-08-03');
  });
});

// The runner is pinned west of Greenwich, which is the direction that catches
// todayISO. It is the wrong direction for everything built on utcMs: local
// midnight in Los Angeles is 07:00 UTC on the *same* calendar day, so a
// UTC-pinned formatter renders identically whichever way the instant was built,
// and only east of Greenwich does the day slip. So assert the instant itself.
describe('utcMs', () => {
  it('is UTC midnight on the day named, not local midnight', () => {
    expect(utcMs('2026-08-03')).toBe(Date.parse('2026-08-03T00:00:00Z'));
    expect(utcMs('2026-01-01')).toBe(Date.parse('2026-01-01T00:00:00Z'));
    // Both sides of the local DST changes, where the offset is not even constant.
    expect(utcMs('2026-03-08')).toBe(Date.parse('2026-03-08T00:00:00Z'));
    expect(utcMs('2026-11-01')).toBe(Date.parse('2026-11-01T00:00:00Z'));
  });
});

describe('daysUntil', () => {
  it('counts whole days across a DST boundary', () => {
    // Los Angeles springs forward on 2026-03-08 and back on 2026-11-01, so these
    // two spans are 23 and 25 local hours: a local-built instant divided by a
    // fixed day is 0.958 and 1.042 of a day rather than exactly one.
    expect(daysUntil('2026-11-02', '2026-11-01')).toBe(1);
    expect(daysUntil('2026-03-08', '2026-03-09')).toBe(-1);
    expect(utcMs('2026-11-02') - utcMs('2026-11-01')).toBe(86_400_000);
    expect(utcMs('2026-03-09') - utcMs('2026-03-08')).toBe(86_400_000);
    expect(daysUntil(TODAY, TODAY)).toBe(0);
  });
});

describe('dueStatus', () => {
  it.each([
    ['2026-08-01', 'overdue'],
    ['2026-08-02', 'overdue'],
    ['2026-08-03', 'soon'],
    ['2026-08-04', 'soon'],
    ['2026-08-05', 'neutral'],
    ['2026-09-05', 'neutral'],
  ])('%s is %s while the task is open', (due, expected) => {
    expect(dueStatus(due, false, TODAY)).toBe(expected);
  });

  it.each(['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'])(
    'a done task reports done regardless of %s',
    (due) => {
      expect(dueStatus(due, true, TODAY)).toBe('done');
    }
  );
});

describe('formatDue', () => {
  it('uses relative words for the neighboring days', () => {
    expect(formatDue('2026-08-02', TODAY)).toBe('Yesterday');
    expect(formatDue(TODAY, TODAY)).toBe('Today');
    expect(formatDue('2026-08-04', TODAY)).toBe('Tomorrow');
  });

  it('abbreviates a date in the current year without the year', () => {
    expect(formatDue('2026-08-20', TODAY)).toBe(absolute('2026-08-20', false));
    expect(formatDue('2026-08-20', TODAY)).not.toContain('2026');
  });

  it('includes the year once the date leaves the current one', () => {
    expect(formatDue('2027-01-04', TODAY)).toBe(absolute('2027-01-04', true));
    expect(formatDue('2027-01-04', TODAY)).toContain('2027');
  });
});

describe('formatFullDate', () => {
  it('always names the year, and never slips to the previous day', () => {
    expect(formatFullDate('2026-08-03')).toBe(absolute('2026-08-03', true));
    expect(formatFullDate('2026-01-01')).toContain('2026');
  });
});

describe('formatTimestamp', () => {
  it('names the date and the time of day', () => {
    expect(formatTimestamp('2026-08-03T19:30:00Z')).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date('2026-08-03T19:30:00Z')
      )
    );
  });

  // The suite runs in America/Los_Angeles: an instant just after UTC midnight is
  // still the previous evening locally, which a UTC-pinned formatter would hide.
  it('reads the instant in the local zone, not UTC', () => {
    expect(formatTimestamp('2026-08-04T02:00:00Z')).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(2026, 7, 3, 19, 0)
      )
    );
  });
});
