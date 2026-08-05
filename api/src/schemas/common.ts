import { type } from 'arktype';
import { isValidUuid, toUuid } from '../types/uuid';

// ctx.error's string form is the *expected* clause, which arktype already
// prefixes with "must be" — spelling it out again reads as "must be must be".
export const uuid = type('string')
  .configure({ format: 'uuid' })
  .pipe((s, ctx) => {
    if (!isValidUuid(s)) {
      return ctx.error('a valid UUID');
    }
    return toUuid(s);
  });

// Postgres refuses a NUL inside a text bind parameter, so a control character
// that survives validation turns a bad request into a 500. Tab, newline and
// carriage return stay legal: multi-line freeform text uses them.
function hasControlCharacter(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true;
  }
  return false;
}

export const email = type('string').pipe((s, ctx) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(s) || hasControlCharacter(s)) {
    return ctx.error('a valid email address');
  }
  return s;
});

export const finiteNumber = type('number')
  .narrow((n, ctx) => Number.isFinite(n) || ctx.mustBe('a finite number'))
  .configure({ description: 'a finite number' });

export const stringWithLength = (min: number, max: number) =>
  type('string').pipe((s, ctx) => {
    const trimmed = s.trim();
    if (trimmed.length < min) {
      return ctx.error(`at least ${min} characters`);
    }
    if (trimmed.length > max) {
      return ctx.error(`at most ${max} characters`);
    }
    if (hasControlCharacter(trimmed)) {
      return ctx.error('free of control characters');
    }
    return trimmed;
  });

// Normalizes empty/whitespace-only input to null so an empty string is never
// persisted for optional freeform text.
export const optionalText = (max: number) =>
  type('string | null').pipe((s, ctx) => {
    if (s == null) return null;
    const trimmed = s.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > max) {
      return ctx.error(`at most ${max} characters`);
    }
    if (hasControlCharacter(trimmed)) {
      return ctx.error('free of control characters');
    }
    return trimmed;
  });

export const isoDateString = type('string').pipe((s, ctx) => {
  const date = new Date(s);
  if (isNaN(date.getTime())) {
    return ctx.error('a valid ISO date string');
  }
  return s;
});

// Separate from isoDateString, which accepts anything `new Date()` parses: a
// calendar day must reject a timestamp rather than silently truncate one.
export const calendarDate = type('string').pipe((s, ctx) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return ctx.error('a date like YYYY-MM-DD');
  }
  const parsed = new Date(`${s}T00:00:00Z`);
  // Year 0 exists in JS and round-trips cleanly, but Postgres has no year 0, so
  // letting it through turns a 422 into a driver error at insert time.
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== s ||
    parsed.getUTCFullYear() === 0
  ) {
    return ctx.error('a valid calendar date');
  }
  return s;
});

export const hexColor = type('string').pipe((s, ctx) => {
  if (!/^#[0-9a-f]{6}$/i.test(s)) {
    return ctx.error('a hex color like #rrggbb');
  }
  return s.toLowerCase();
});

export const boundedUuidArray = (max: number) =>
  uuid.array().pipe((arr, ctx) => {
    if (arr.length > max) {
      return ctx.error(`at most ${max} items`);
    }
    return arr;
  });

export const idSchema = type({
  id: uuid,
});

// One schema for both duplicate endpoints: two distinct schema objects with the
// same shape collide in the OpenAPI schema-name registry.
export const duplicateSchema = type({
  id: uuid,
  position: finiteNumber,
});

// Shared for the same reason: identical shapes become one component either way,
// so the one they share needs a name that fits them all.
export const namedRefSchema = type({
  id: 'string',
  name: 'string',
});

// Shared by every `?project_id=` list query, for the same reason.
export const projectIdQuerySchema = type({
  project_id: uuid,
});
