export function avatarUrl(storageKey: string | null): string | null {
  return storageKey === null ? null : `/api/avatars/${storageKey}`;
}
