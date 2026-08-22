import { describe, it, expect } from 'vitest';
import { formatExactTime, formatRelativeTime } from './relativeTime';

const NOW = new Date('2026-08-07T12:00:00.000Z');

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

// The suite pins TZ and nothing else, so a literal 'in 5 minutes' fails on a
// machine running under a non-English LANG — for a reason that has nothing to do
// with this module. Rebuilt through an independent formatter the way
// dates.test.ts rebuilds its dates: the count and the unit are what these cases
// are about, and picking either wrongly still fails. 'auto' matches the module,
// which is what makes yesterday read as a name rather than a count.
function rel(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(value, unit);
}

describe('formatRelativeTime', () => {
  it('calls anything inside the last minute just now', () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe('just now');
    expect(formatRelativeTime(ago(59_000), NOW)).toBe('just now');
  });

  it('steps up through the units', () => {
    expect(formatRelativeTime(ago(60_000), NOW)).toBe(rel(-1, 'minute'));
    expect(formatRelativeTime(ago(45 * 60_000), NOW)).toBe(rel(-45, 'minute'));
    expect(formatRelativeTime(ago(3 * 3_600_000), NOW)).toBe(rel(-3, 'hour'));
    expect(formatRelativeTime(ago(3 * 86_400_000), NOW)).toBe(rel(-3, 'day'));
    expect(formatRelativeTime(ago(20 * 86_400_000), NOW)).toBe(rel(-2, 'week'));
    expect(formatRelativeTime(ago(200 * 86_400_000), NOW)).toBe(rel(-6, 'month'));
    expect(formatRelativeTime(ago(800 * 86_400_000), NOW)).toBe(rel(-2, 'year'));
  });

  it('truncates rather than rounding, so 90 minutes is an hour', () => {
    expect(formatRelativeTime(ago(90 * 60_000), NOW)).toBe(rel(-1, 'hour'));
    expect(formatRelativeTime(ago(90 * 60_000), NOW)).not.toBe(rel(-2, 'hour'));
  });

  it('names the neighboring day and month instead of counting one', () => {
    expect(formatRelativeTime(ago(86_400_000), NOW)).toBe(rel(-1, 'day'));
    expect(formatRelativeTime(ago(31 * 86_400_000), NOW)).toBe(rel(-1, 'month'));
  });

  it('handles a clock that is behind the server', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() + 5 * 60_000).toISOString(), NOW)).toBe(
      rel(5, 'minute')
    );
  });

  it('renders nothing for an unparseable timestamp', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('');
    expect(formatExactTime('not-a-date')).toBe('');
  });
});

describe('formatExactTime', () => {
  it('includes both the date and the time of day', () => {
    const formatted = formatExactTime('2026-08-07T12:00:00.000Z');
    expect(formatted).not.toBe('');
    expect(formatted).toContain('2026');
    expect(formatted).toMatch(/\d:\d{2}/);
  });
});
