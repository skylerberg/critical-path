import { describe, expect, it } from 'vitest';
import {
  daysUntil,
  dueStatus,
  formatDue,
  formatFullDate,
  formatTimestamp,
  isCalendarDate,
  todayISO,
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

describe('daysUntil', () => {
  it('counts whole days across a DST boundary', () => {
    expect(daysUntil('2026-11-02', '2026-11-01')).toBe(1);
    expect(daysUntil('2026-03-08', '2026-03-09')).toBe(-1);
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
