export function newId(): string {
  return crypto.randomUUID();
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@test.example.com`;
}
