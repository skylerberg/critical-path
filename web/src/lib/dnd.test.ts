import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DROP_TARGET_STYLE } from './dnd';

const SRC = resolve(import.meta.dirname, '..');
const ZONE = /use:(?:dndzone|dragHandleZone)=\{\{/g;

function svelteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith('.svelte') ? [path] : [];
  });
}

// Brace-matched from the `{{`, so a nested object in the options — a style map, a
// handler returning one — is read as part of the zone rather than ending it.
function optionsAt(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error('unbalanced zone options');
}

function zoneOptions(): { file: string; options: string }[] {
  return svelteFiles(SRC).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(ZONE)].map((match) => ({
      file: file.slice(SRC.length + 1),
      options: optionsAt(source, match.index + match[0].length - 2),
    }));
  });
}

describe('drop target style', () => {
  // svelte-dnd-action falls back to its own red DEFAULT_DROP_TARGET_STYLE when a
  // zone names none, and a zone that spells its own out is how the four here came
  // to hold three copies of one object. Either way the new zone is the odd one
  // out, and nothing else in the suite renders a drag.
  it('is the shared object on every zone', () => {
    const zones = zoneOptions();
    expect(zones.length).toBeGreaterThan(0);
    for (const { file, options } of zones) {
      expect(`${file}: ${options}`).toContain('dropTargetStyle: DROP_TARGET_STYLE');
    }
  });

  // The curve is the outline's, which takes it from the element: the zones are
  // transparent containers, so this is the only thing rounding the highlight.
  it('rounds the highlight it draws', () => {
    expect(DROP_TARGET_STYLE.borderRadius).toMatch(/^[\d.]+(?:rem|px)$/);
  });
});
