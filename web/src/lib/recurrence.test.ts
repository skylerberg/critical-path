import { describe, expect, it } from 'vitest';
import { RECURRENCE_PRESETS, presetLabel } from './recurrence';

describe('presetLabel', () => {
  it('names the weekday of the start date, not the day the machine is on', () => {
    // Tests run pinned to America/Los_Angeles, so a UTC-midnight date parsed as
    // a local Date would name the day before.
    expect(presetLabel('weekly', '2026-02-02')).toBe('Every week on Monday');
    expect(presetLabel('weekly', '2026-02-03')).toBe('Every week on Tuesday');
    expect(presetLabel('weekly', '2026-02-08')).toBe('Every week on Sunday');
  });

  it('relabels as the start date moves', () => {
    expect(presetLabel('monthly_date', '2026-02-01')).toBe('Monthly on the 1st');
    expect(presetLabel('monthly_date', '2026-02-02')).toBe('Monthly on the 2nd');
    expect(presetLabel('monthly_date', '2026-02-03')).toBe('Monthly on the 3rd');
    expect(presetLabel('monthly_date', '2026-02-11')).toBe('Monthly on the 11th');
    expect(presetLabel('monthly_date', '2026-02-21')).toBe('Monthly on the 21st');
  });

  it('warns that a month-end date clamps', () => {
    expect(presetLabel('monthly_date', '2026-01-29')).toBe(
      'Monthly on the 29th, or the last day of shorter months'
    );
    expect(presetLabel('monthly_date', '2026-01-31')).toBe(
      'Monthly on the 31st, or the last day of shorter months'
    );
  });

  it('counts the weekday ordinal and recognizes the last one', () => {
    expect(presetLabel('monthly_weekday', '2026-01-06')).toBe('Monthly on the 1st Tuesday');
    expect(presetLabel('monthly_weekday', '2026-01-13')).toBe('Monthly on the 2nd Tuesday');
    expect(presetLabel('monthly_weekday', '2026-01-20')).toBe('Monthly on the 3rd Tuesday');
    expect(presetLabel('monthly_weekday', '2026-01-30')).toBe('Monthly on the last Friday');
    expect(presetLabel('monthly_weekday', '2026-01-31')).toBe('Monthly on the last Saturday');
  });

  it('spells the yearly date out and calls out 29 February', () => {
    expect(presetLabel('yearly', '2026-06-15')).toBe('Every year on 15 June');
    expect(presetLabel('yearly', '2024-02-29')).toBe(
      'Every year on 29 February, or 28 February in non-leap years'
    );
  });

  it('labels the fixed presets without reading the date', () => {
    expect(presetLabel('daily', '2026-02-02')).toBe('Every day');
    expect(presetLabel('weekdays', '2026-02-02')).toBe('Every weekday');
  });

  it('returns a non-empty label for every preset', () => {
    for (const preset of RECURRENCE_PRESETS) {
      expect(presetLabel(preset, '2026-12-31').length).toBeGreaterThan(0);
    }
  });

  // Both call sites bind this straight to a date input, which reports '' for an
  // empty value and for every keystroke of a half-typed one.
  it.each(['', '2026-', '2026-08', 'nonsense'])('quotes no day for a start date of %p', (value) => {
    const labels = RECURRENCE_PRESETS.map((preset) => presetLabel(preset, value));

    expect(labels).toEqual([
      'Every day',
      'Every weekday',
      'Every week',
      'Monthly on the same date',
      'Monthly on the same weekday',
      'Every year',
    ]);
    // 30 November 1899 is what Date.UTC makes of an empty string.
    expect(labels.join(' ')).not.toMatch(/1899|November|30th|Thursday/);
  });

  it('offers a distinct label per preset whether or not the date is there', () => {
    for (const startDate of ['', '2026-08-13']) {
      const labels = RECURRENCE_PRESETS.map((preset) => presetLabel(preset, startDate));
      expect(new Set(labels).size).toBe(RECURRENCE_PRESETS.length);
    }
  });
});
