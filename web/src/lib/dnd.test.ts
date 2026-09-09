import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DROP_TARGET_STYLE, flipDuration, INSET_DROP_TARGET_STYLE } from './dnd';
import { motion } from './motion.svelte';

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
  // out, and nothing else in the suite renders a drag. Anchored on the whole
  // identifier, because one of the two shapes is the other's name with a prefix.
  it('is one of the two shared objects on every zone', () => {
    const zones = zoneOptions();
    expect(zones.length).toBeGreaterThan(0);
    for (const { file, options } of zones) {
      expect(`${file}: ${options}`).toMatch(/dropTargetStyle: (?:INSET_)?DROP_TARGET_STYLE,/);
    }
  });

  // The board's task zone is the one whose box is bigger than what the ring should
  // trace: `drop-reach` in app.css carries its reach under a column's cards as a
  // transparent bottom border, and an outline traces the border box. Asked of that
  // zone by name, because the rule above is satisfied by either shape.
  it('is the inset shape on the zone that reaches past its cards', () => {
    const task = zoneOptions().find(({ options }) => options.includes("type: 'task'"));
    expect(task?.file).toBe('routes/Board.svelte');
    expect(task?.options).toContain('dropTargetStyle: INSET_DROP_TARGET_STYLE,');
  });

  // ...which holds only while the ring is drawn inside the padding box: that is the
  // box that still ends where the cards do, now that the border box reaches the
  // foot of the board.
  it('draws the inset shape inside the padding box', () => {
    expect(INSET_DROP_TARGET_STYLE.boxShadow).toMatch(/^inset /);
    expect(INSET_DROP_TARGET_STYLE).not.toHaveProperty('outline');
  });

  // The curve is the ring's, which takes it from the element: the zones are
  // transparent containers, so this is the only thing rounding either shape.
  it('rounds the highlight it draws', () => {
    for (const shape of [DROP_TARGET_STYLE, INSET_DROP_TARGET_STYLE]) {
      expect(shape.borderRadius).toMatch(/^[\d.]+(?:rem|px)$/);
    }
  });
});

describe('flip duration', () => {
  afterEach(() => {
    motion.reduced = false;
  });

  // The whole reason this is shared: a zone that hardcodes a duration animates
  // against the preference, on every machine but the one whose author had it set.
  it('is zero under reduced motion', () => {
    expect(flipDuration()).toBeGreaterThan(0);
    motion.reduced = true;
    expect(flipDuration()).toBe(0);
  });

  it('is the shared duration on every zone', () => {
    for (const { file, options } of zoneOptions()) {
      expect(`${file}: ${options}`).toContain('flipDuration(');
    }
  });
});
