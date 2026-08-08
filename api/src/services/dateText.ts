import { sql, type RawBuilder } from 'kysely';

// node-pg parses a `date` into a JS Date at *local* midnight, which serializes
// back out as the previous day anywhere east of UTC. Every read of a date column
// goes through this instead. to_char rather than ::text because a non-ISO
// DateStyle changes the cast but not to_char.
export function dateText<T extends string | null = string | null>(
  column: string | RawBuilder<unknown>
): RawBuilder<T> {
  return sql<T>`to_char(${typeof column === 'string' ? sql.ref(column) : column}, 'YYYY-MM-DD')`;
}

export const dueDateText = dateText('task.due_date');

// Takes the zone as a bound value or a column reference, so the same expression
// serves a caller who knows the zone and a query that reads it per row. `at`
// exists because the calendar day is otherwise read afresh on every statement:
// a caller that has to compare two reads of it, or that means a specific day,
// has no way to say so and gets a different answer either side of midnight.
export function todayInZone(zone: string | RawBuilder<string>, at?: Date): RawBuilder<string> {
  const instant = at === undefined ? sql`now()` : sql`${at}::timestamptz`;
  return dateText<string>(sql`(${instant} at time zone ${zone})::date`);
}
