// The stylesheet's own text, standing in for a browser. jsdom applies no
// stylesheet, and resolves no custom property declared inside a media query even
// where one is applied, so every assertion about a token's value has to read
// app.css directly. Test-only: it imports node:fs and nothing in the app graph
// reaches it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DARK_MARKER = '@media (prefers-color-scheme: dark)';
const THEME_MARKER = '@theme inline';

export const appCss = readFileSync(resolve(import.meta.dirname, '../app.css'), 'utf8');

// Brace-matched rather than regex-sliced, so a nested rule inside the block is
// returned with it instead of cutting the block short at the first '}'.
export function cssBlock(prelude: string): string {
  const start = appCss.indexOf(prelude);
  if (start < 0) {
    throw new Error(`${prelude} is missing from app.css`);
  }
  let depth = 0;
  for (let i = start; i < appCss.length; i += 1) {
    if (appCss[i] === '{') {
      depth += 1;
    } else if (appCss[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return appCss.slice(start, i + 1);
      }
    }
  }
  throw new Error(`${prelude} has no closing brace`);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

// WCAG contrast over the six-digit hex values cssTokens hands back. Here rather than
// in either test file because both the project accents and the selection colours
// hold their palettes to a ratio, and a second copy of colour maths is a second
// place for it to drift.
export function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

// Every `--cp-*` hex a theme defines. The light values are everything before the
// dark media query and the dark ones everything between it and @theme inline, so
// reordering those three sections in app.css breaks this loudly rather than
// silently returning one theme's palette for both.
export function cssTokens(theme: 'light' | 'dark'): Record<string, string> {
  const darkAt = appCss.indexOf(DARK_MARKER);
  const themeAt = appCss.indexOf(THEME_MARKER);
  if (darkAt < 1 || themeAt < darkAt) {
    throw new Error(`app.css no longer has ${DARK_MARKER} followed by ${THEME_MARKER}`);
  }
  const source = theme === 'light' ? appCss.slice(0, darkAt) : appCss.slice(darkAt, themeAt);
  const values: Record<string, string> = {};
  for (const [, name, hex] of source.matchAll(/(--cp-[a-z-]+):\s*(#[0-9a-f]{6})/g)) {
    values[name!] = hex!;
  }
  return values;
}
