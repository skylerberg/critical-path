import { describe, it, expect } from 'vitest';
import { formatExactTime, formatRelativeTime } from './relativeTime';

const NOW = new Date('2026-08-07T12:00:00.000Z');

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

describe('formatRelativeTime', () => {
  it('calls anything inside the last minute just now', () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe('just now');
    expect(formatRelativeTime(ago(59_000), NOW)).toBe('just now');
  });

  it('steps up through the units', () => {
    expect(formatRelativeTime(ago(60_000), NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(ago(45 * 60_000), NOW)).toBe('45 minutes ago');
    expect(formatRelativeTime(ago(3 * 3_600_000), NOW)).toBe('3 hours ago');
    expect(formatRelativeTime(ago(3 * 86_400_000), NOW)).toBe('3 days ago');
    expect(formatRelativeTime(ago(20 * 86_400_000), NOW)).toBe('2 weeks ago');
    expect(formatRelativeTime(ago(200 * 86_400_000), NOW)).toBe('6 months ago');
    expect(formatRelativeTime(ago(800 * 86_400_000), NOW)).toBe('2 years ago');
  });

  it('truncates rather than rounding, so 90 minutes is an hour', () => {
    expect(formatRelativeTime(ago(90 * 60_000), NOW)).toBe('1 hour ago');
  });

  it('names the neighboring day and month instead of counting one', () => {
    expect(formatRelativeTime(ago(86_400_000), NOW)).toBe('yesterday');
    expect(formatRelativeTime(ago(31 * 86_400_000), NOW)).toBe('last month');
  });

  it('handles a clock that is behind the server', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() + 5 * 60_000).toISOString(), NOW)).toBe(
      'in 5 minutes'
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
