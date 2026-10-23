import { sql, type RawBuilder } from 'kysely';

// node-pg parses a `date` into a JS Date at *local* midnight, which serializes
// back out as the previous day anywhere east of UTC, so date columns are read
// through this. to_char rather than ::text because a non-ISO DateStyle changes
// the cast but not to_char.
export function dateText<T extends string | null = string | null>(
  column: string | RawBuilder<unknown>
): RawBuilder<T> {
  return sql<T>`to_char(${typeof column === 'string' ? sql.ref(column) : column}, 'YYYY-MM-DD')`;
}

export const dueDateText = dateText('task.due_date');

// Takes the zone as a bound value or a column reference, so one expression serves
// a caller who knows the zone and a query that reads it per row. `at` pins the
// instant: without it the calendar day is read afresh on every statement, so a
// caller comparing two reads, or meaning a specific day, gets a different answer
// either side of midnight.
export function todayInZone(zone: string | RawBuilder<string>, at?: Date): RawBuilder<string> {
  const instant = at === undefined ? sql`now()` : sql`${at}::timestamptz`;
  return dateText<string>(sql`(${instant} at time zone ${zone})::date`);
}
