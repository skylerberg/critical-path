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
