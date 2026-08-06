export function newId(): string {
  return crypto.randomUUID();
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@test.example.com`;
}

export function rawJsonWithPosition(
  body: Record<string, unknown>,
  positionLiteral: string
): string {
  const { position: _position, ...rest } = body;
  const json = JSON.stringify(rest);
  const prefix = json === '{}' ? '{' : `${json.slice(0, -1)},`;
  return `${prefix}"position":${positionLiteral}}`;
}

// A rank for a fixture row inserted straight into the database. Ordered by the
// notional position the test means, then by insertion order so two rows that
// share one still satisfy the unique index. Never ends in the zero digit, which
// the key generator rejects as a bound.
let rankCounter = 0;

export function rankKey(position = 1000): string {
  rankCounter += 1;
  const ordinal = Math.round(position) + 1_000_000;
  return `V0${String(ordinal).padStart(9, '0')}${String(rankCounter).padStart(5, '0')}1`;
}
