const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return uuidRegex.test(value);
}

export function toUuid(value: string): string {
  if (!isValidUuid(value)) {
    throw new Error(`Invalid UUID: ${value}`);
  }
  return value.toLowerCase();
}
