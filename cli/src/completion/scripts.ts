import { readFile } from 'node:fs/promises';

export const SHELLS = ['bash', 'zsh', 'fish'] as const;

export type Shell = (typeof SHELLS)[number];

export async function completionScript(shell: Shell): Promise<string> {
  return readFile(new URL(`./scripts/cpath.${shell}`, import.meta.url), 'utf8');
}
