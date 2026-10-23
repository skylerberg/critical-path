import { sql, type RawBuilder } from 'kysely';

// node-pg turns a `date` into a JS Date at local midnight, which serializes
// back out as the previous day anywhere east of UTC. Every read of a date
// column goes through this instead. to_char, not a ::text cast, because a
// non-ISO DateStyle changes the cast but not to_char.
export function dateText<T extends string | null = string | null>(
  column: string | RawBuilder<unknown>
): RawBuilder<T> {
  return sql<T>`to_char(${typeof column === 'string' ? sql.ref(column) : column}, 'YYYY-MM-DD')`;
}

export const dueDateText = dateText('task.due_date');

// Takes the zone as a bound value or a column reference, so one expression
// serves a caller who knows the zone and a query that reads it per row. `at`
// pins the instant: without it the day comes from `now()`, which is not the
// clock the caller decided to act on and can land on the other side of
// midnight.
export function todayInZone(zone: string | RawBuilder<string>, at?: Date): RawBuilder<string> {
  const instant = at === undefined ? sql`now()` : sql`${at}::timestamptz`;
  return dateText<string>(sql`(${instant} at time zone ${zone})::date`);
}
