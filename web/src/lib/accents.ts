import type { components } from '../api/api.generated';

export type ProjectAccent = NonNullable<components['schemas']['NullableProjectAccent']>;

// Record, so adding a key to the palette fails the build until it has a token.
export const ACCENTS: Record<ProjectAccent, { label: string; cssVar: string }> = {
  rose: { label: 'Rose', cssVar: '--cp-project-rose' },
  amber: { label: 'Amber', cssVar: '--cp-project-amber' },
  lime: { label: 'Lime', cssVar: '--cp-project-lime' },
  emerald: { label: 'Emerald', cssVar: '--cp-project-emerald' },
  sky: { label: 'Sky', cssVar: '--cp-project-sky' },
  violet: { label: 'Violet', cssVar: '--cp-project-violet' },
  fuchsia: { label: 'Fuchsia', cssVar: '--cp-project-fuchsia' },
  slate: { label: 'Slate', cssVar: '--cp-project-slate' },
};

export const ACCENT_KEYS = Object.keys(ACCENTS) as ProjectAccent[];

// Total on purpose. Most boards have no colour at all, a drag placeholder has no
// fields, and a newer release can serve a key this build has no token for — an
// indexed lookup produces a broken value or a throw on all three. hasOwn, not a
// truthiness check: 'toString' indexes to a function off the prototype.
export function accentVar(color: string | null | undefined): string | null {
  if (color == null || !Object.hasOwn(ACCENTS, color)) {
    return null;
  }
  return `var(${ACCENTS[color as ProjectAccent].cssVar})`;
}
