import { sql, type RawBuilder } from 'kysely';

// Reads a `date` column as 'YYYY-MM-DD' text. node-pg would parse it into a JS
// Date at *local* midnight, which serializes back out as the previous day
// anywhere east of UTC, so every read of a date column goes through this.
// to_char rather than ::text because a non-ISO DateStyle changes the cast but
// not to_char.
export function dateText<T extends string | null = string | null>(
  column: string | RawBuilder<unknown>
): RawBuilder<T> {
  return sql<T>`to_char(${typeof column === 'string' ? sql.ref(column) : column}, 'YYYY-MM-DD')`;
}

export const dueDateText = dateText('task.due_date');

// The calendar day in `zone`. `zone` may be a bound value or a column reference,
// so the same expression serves a caller that knows the zone and a query that
// reads it per row. Pass `at` to pin the instant: without it the day comes from
// now(), which is re-read on every statement, so two reads can land either side
// of midnight and a caller meaning one specific day has no way to say so.
export function todayInZone(zone: string | RawBuilder<string>, at?: Date): RawBuilder<string> {
  const instant = at === undefined ? sql`now()` : sql`${at}::timestamptz`;
  return dateText<string>(sql`(${instant} at time zone ${zone})::date`);
}
