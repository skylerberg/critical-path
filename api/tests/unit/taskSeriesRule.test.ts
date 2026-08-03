import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_RRULE_LENGTH,
  addDays,
  assertUsableRrule,
  canonicalise,
  firstOccurrenceOnOrAfter,
  nextOccurrenceAfter,
  occurrencesBetween,
  presetFor,
  rruleForPreset,
  summarise,
} from '../../src/services/taskSeries/rule';
import { AppError } from '../../src/utils/errors';

// Pinned west of Greenwich: every local-vs-UTC mixup in the module is invisible
// on a UTC box, and this suite runs single-threaded so the change is contained.
const originalTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'America/Los_Angeles';
});

afterAll(() => {
  process.env.TZ = originalTz;
});

function expectRejected(rrule: string, startDate = '2026-01-01'): void {
  let thrown: unknown;
  try {
    assertUsableRrule(rrule, startDate);
  } catch (err) {
    thrown = err;
  }
  expect(thrown, `expected ${rrule} to be rejected`).toBeInstanceOf(AppError);
  expect((thrown as AppError).statusCode).toBe(422);
}

describe('assertUsableRrule', () => {
  it('returns the canonical rule for an acceptable one', () => {
    expect(assertUsableRrule('FREQ=WEEKLY;BYDAY=MO', '2026-01-05')).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(assertUsableRrule('FREQ=MONTHLY;BYDAY=2TU', '2026-01-13')).toBe(
      'FREQ=MONTHLY;BYDAY=+2TU'
    );
  });

  it('rejects an over-length rule', () => {
    expectRejected(`FREQ=DAILY;BYMONTHDAY=${'1,'.repeat(MAX_RRULE_LENGTH)}1`);
  });

  it('rejects unparseable garbage', () => {
    expectRejected('this is not a rule');
  });

  it('rejects a rule carrying its own anchor, zone or date set', () => {
    expectRejected('FREQ=DAILY;DTSTART=20260101T000000Z');
    expectRejected('FREQ=DAILY;TZID=Europe/Berlin');
    expectRejected('FREQ=DAILY;RDATE=20260101T000000Z');
    expectRejected('FREQ=DAILY;EXDATE=20260101T000000Z');
    expectRejected('FREQ=DAILY;EXRULE=FREQ=WEEKLY');
  });

  it('rejects time-of-day parts', () => {
    expectRejected('FREQ=DAILY;BYHOUR=0,1,2');
    expectRejected('FREQ=DAILY;BYMINUTE=0,30');
    expectRejected('FREQ=DAILY;BYSECOND=0,30');
  });

  it('rejects an RRULE: prefix and a multi-line rule', () => {
    expectRejected('RRULE:FREQ=DAILY');
    expectRejected('FREQ=DAILY\nFREQ=WEEKLY');
  });

  it('rejects sub-daily frequencies and a missing one', () => {
    expectRejected('FREQ=SECONDLY');
    expectRejected('FREQ=MINUTELY');
    expectRejected('FREQ=HOURLY');
    expectRejected('FREQ=BOGUS');
    expectRejected('INTERVAL=1');
  });

  it('rejects out-of-range INTERVAL, COUNT and UNTIL', () => {
    expectRejected('FREQ=DAILY;INTERVAL=400');
    expectRejected('FREQ=DAILY;INTERVAL=0');
    expectRejected('FREQ=DAILY;COUNT=100000');
    expectRejected('FREQ=DAILY;COUNT=0');
    expectRejected('FREQ=DAILY;UNTIL=99990101T000000Z');
  });

  it('rejects a rule that can never fire', () => {
    expectRejected('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30');
    expectRejected('FREQ=DAILY;UNTIL=20250101T000000Z', '2026-01-01');
  });
});

describe('month ends', () => {
  it('clamps a monthly rule anchored on the 31st instead of skipping short months', () => {
    const rule = rruleForPreset('monthly_date', '2026-01-31');
    expect(occurrencesBetween(rule, '2026-01-31', '2026-01-01', '2026-06-30', 50)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('clamps the 29th and 30th too', () => {
    expect(
      occurrencesBetween(
        rruleForPreset('monthly_date', '2026-01-29'),
        '2026-01-29',
        '2026-01-01',
        '2026-03-31',
        50
      )
    ).toEqual(['2026-01-29', '2026-02-28', '2026-03-29']);
    expect(
      occurrencesBetween(
        rruleForPreset('monthly_date', '2026-01-30'),
        '2026-01-30',
        '2026-01-01',
        '2026-03-31',
        50
      )
    ).toEqual(['2026-01-30', '2026-02-28', '2026-03-30']);
  });

  it('leaves a mid-month anchor on the plain rule', () => {
    expect(rruleForPreset('monthly_date', '2026-01-15')).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
  });
});

describe('leap day', () => {
  it('fires every year from a 29 February anchor', () => {
    const rule = rruleForPreset('yearly', '2024-02-29');
    expect(occurrencesBetween(rule, '2024-02-29', '2024-01-01', '2028-12-31', 50)).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('uses the plain yearly rule for any other date', () => {
    expect(rruleForPreset('yearly', '2026-06-15')).toBe('FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=15');
  });
});

describe('monthly on the nth weekday', () => {
  it('anchors on the last weekday when the start is in the final week', () => {
    // 2026-01-30 is the last Friday of a January with five Fridays.
    expect(rruleForPreset('monthly_weekday', '2026-01-30')).toBe('FREQ=MONTHLY;BYDAY=-1FR');
    expect(
      occurrencesBetween('FREQ=MONTHLY;BYDAY=-1FR', '2026-01-30', '2026-01-01', '2026-06-30', 50)
    ).toEqual(['2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24', '2026-05-29', '2026-06-26']);
  });

  it('anchors on the ordinal weekday otherwise', () => {
    expect(rruleForPreset('monthly_weekday', '2026-01-13')).toBe('FREQ=MONTHLY;BYDAY=2TU');
    expect(
      occurrencesBetween(
        rruleForPreset('monthly_weekday', '2026-01-13'),
        '2026-01-13',
        '2026-01-01',
        '2026-04-30',
        50
      )
    ).toEqual(['2026-01-13', '2026-02-10', '2026-03-10', '2026-04-14']);
  });
});

describe('weekdays', () => {
  it('skips Saturday and Sunday', () => {
    const rule = rruleForPreset('weekdays', '2026-01-01');
    expect(occurrencesBetween(rule, '2026-01-01', '2026-01-01', '2026-01-12', 50)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-08',
      '2026-01-09',
      '2026-01-12',
    ]);
  });
});

describe('daylight saving', () => {
  it('keeps a weekly rule on the same weekday across both US transitions', () => {
    // 2026-03-08 is spring forward and 2026-11-01 is fall back in US zones.
    const rule = rruleForPreset('weekly', '2026-03-01');
    const spring = occurrencesBetween(rule, '2026-03-01', '2026-03-01', '2026-03-29', 50);
    expect(spring).toEqual(['2026-03-01', '2026-03-08', '2026-03-15', '2026-03-22', '2026-03-29']);
    const autumn = occurrencesBetween(rule, '2026-03-01', '2026-10-18', '2026-11-15', 50);
    expect(autumn).toEqual(['2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15']);
    for (const run of [spring, autumn]) {
      for (let i = 1; i < run.length; i++) {
        expect(addDays(run[i - 1], 7)).toBe(run[i]);
      }
    }
  });
});

describe('presetFor', () => {
  it('round-trips every preset from several start dates', () => {
    for (const startDate of [
      '2026-01-01',
      '2026-02-15',
      '2026-01-31',
      '2024-02-29',
      '2026-11-30',
    ]) {
      for (const preset of [
        'daily',
        'weekdays',
        'weekly',
        'monthly_date',
        'monthly_weekday',
        'yearly',
      ] as const) {
        const rule = canonicalise(rruleForPreset(preset, startDate));
        expect(presetFor(rule, startDate), `${preset} @ ${startDate}`).toBe(preset);
      }
    }
  });

  it('returns null for a rule outside the curated set', () => {
    expect(presetFor('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2026-01-05')).toBeNull();
  });

  it('returns null when the start date no longer matches the rule', () => {
    expect(presetFor('FREQ=WEEKLY;BYDAY=MO', '2026-01-06')).toBeNull();
  });
});

describe('summarise', () => {
  it('renders curated English for every preset', () => {
    expect(summarise(rruleForPreset('daily', '2026-01-05'), '2026-01-05')).toBe('Every day');
    expect(summarise(rruleForPreset('weekdays', '2026-01-05'), '2026-01-05')).toBe('Every weekday');
    expect(summarise(rruleForPreset('weekly', '2026-01-05'), '2026-01-05')).toBe('Every Monday');
    expect(summarise(rruleForPreset('monthly_date', '2026-01-15'), '2026-01-15')).toBe(
      'Monthly on the 15th'
    );
    expect(summarise(rruleForPreset('monthly_weekday', '2026-01-13'), '2026-01-13')).toBe(
      'Monthly on the 2nd Tuesday'
    );
    expect(summarise(rruleForPreset('monthly_weekday', '2026-01-30'), '2026-01-30')).toBe(
      'Monthly on the last Friday'
    );
    expect(summarise(rruleForPreset('yearly', '2026-06-15'), '2026-06-15')).toBe(
      'Every year on 15 June'
    );
    expect(summarise(rruleForPreset('yearly', '2024-02-29'), '2024-02-29')).toBe(
      'Every year on 29 February, or 28 February in non-leap years'
    );
  });

  it('never renders the clamped monthly rule as its raw library text', () => {
    const summary = summarise(rruleForPreset('monthly_date', '2026-01-31'), '2026-01-31');
    expect(summary).toBe('Monthly on the 31st, or the last day of shorter months');
    expect(summary).not.toContain('and last');
  });

  it('falls back to library text for a non-curated rule', () => {
    const summary = summarise('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2026-01-05');
    expect(summary).toContain('every 2 weeks');
  });

  it('never returns an empty string', () => {
    for (const rule of ['FREQ=DAILY;INTERVAL=3', 'FREQ=MONTHLY;BYMONTHDAY=5,20', 'FREQ=YEARLY']) {
      expect(summarise(rule, '2026-01-05').length).toBeGreaterThan(0);
    }
  });
});

describe('exhaustion', () => {
  it('returns null once COUNT runs out', () => {
    const rule = 'FREQ=DAILY;COUNT=3';
    expect(occurrencesBetween(rule, '2026-01-01', '2026-01-01', '2026-01-31', 50)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
    expect(nextOccurrenceAfter(rule, '2026-01-01', '2026-01-03')).toBeNull();
  });

  it('returns null once UNTIL passes', () => {
    const rule = 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20260119T000000Z';
    expect(nextOccurrenceAfter(rule, '2026-01-05', '2026-01-12')).toBe('2026-01-19');
    expect(nextOccurrenceAfter(rule, '2026-01-05', '2026-01-19')).toBeNull();
  });
});

describe('bounds', () => {
  it('honours the occurrence cap', () => {
    expect(occurrencesBetween('FREQ=DAILY', '2026-01-01', '2026-01-01', '2026-12-31', 4)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
    expect(occurrencesBetween('FREQ=DAILY', '2026-01-01', '2026-01-01', '2026-12-31', 0)).toEqual(
      []
    );
    expect(occurrencesBetween('FREQ=DAILY', '2026-01-01', '2026-01-05', '2026-01-01', 10)).toEqual(
      []
    );
  });

  it('finds the first occurrence on or after a date, and the next strictly after it', () => {
    expect(firstOccurrenceOnOrAfter('FREQ=WEEKLY;BYDAY=MO', '2026-01-05', '2026-01-05')).toBe(
      '2026-01-05'
    );
    expect(firstOccurrenceOnOrAfter('FREQ=WEEKLY;BYDAY=MO', '2026-01-05', '2026-01-06')).toBe(
      '2026-01-12'
    );
    expect(nextOccurrenceAfter('FREQ=WEEKLY;BYDAY=MO', '2026-01-05', '2026-01-05')).toBe(
      '2026-01-12'
    );
  });

  it('starts no earlier than the anchor', () => {
    expect(firstOccurrenceOnOrAfter('FREQ=DAILY', '2026-06-01', '2026-01-01')).toBe('2026-06-01');
  });
});

describe('addDays', () => {
  it('crosses month, year and leap boundaries in UTC', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-08', -1)).toBe('2026-03-07');
  });
});
