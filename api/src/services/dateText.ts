import { sql, type RawBuilder } from 'kysely';

// node-pg parses a `date` into a JS Date at local midnight, which serializes as
// the previous day anywhere east of UTC, so every read of a date column goes
// through this. to_char rather than ::text: a non-ISO DateStyle changes the cast
// but not to_char.
export function dateText<T extends string | null = string | null>(
  column: string | RawBuilder<unknown>
): RawBuilder<T> {
  return sql<T>`to_char(${typeof column === 'string' ? sql.ref(column) : column}, 'YYYY-MM-DD')`;
}

export const dueDateText = dateText('task.due_date');

// Takes the zone as a bound value or a column reference, so one expression serves
// a caller that knows the zone and a query that reads it per row. `at` pins the
// instant for a caller comparing two reads, or meaning a specific day: otherwise
// every read takes its own now().
export function todayInZone(zone: string | RawBuilder<string>, at?: Date): RawBuilder<string> {
  const instant = at === undefined ? sql`now()` : sql`${at}::timestamptz`;
  return dateText<string>(sql`(${instant} at time zone ${zone})::date`);
}
