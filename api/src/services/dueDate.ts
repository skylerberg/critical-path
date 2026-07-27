import { sql } from 'kysely';

// node-pg parses a `date` into a JS Date at *local* midnight, which serializes
// back out as the previous day anywhere east of UTC. Every read of due_date goes
// through this instead. to_char rather than ::text because a non-ISO DateStyle
// changes the cast but not to_char.
export const dueDateText = sql<string | null>`to_char(task.due_date, 'YYYY-MM-DD')`;
