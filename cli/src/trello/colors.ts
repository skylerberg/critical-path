// Trello's label palette. The export carries only the colour *name*
// ("green_dark"), never a value, so these come from Trello's published palette
// rather than from the file: treat a wrong-looking swatch as a one-line fix
// here, not as a lost import. An unknown name throws instead of defaulting,
// because a board silently full of grey labels reads as a successful run.
const PALETTE: Record<string, string> = {
  green_light: '#baf3db',
  green: '#4bce97',
  green_dark: '#1f845a',
  yellow_light: '#f8e6a0',
  yellow: '#f5cd47',
  yellow_dark: '#946f00',
  orange_light: '#fedec8',
  orange: '#fea362',
  orange_dark: '#c25100',
  red_light: '#ffd5d2',
  red: '#f87168',
  red_dark: '#c9372c',
  purple_light: '#dfd8fd',
  purple: '#9f8fef',
  purple_dark: '#6e5dc6',
  blue_light: '#cce0ff',
  blue: '#579dff',
  blue_dark: '#0c66e4',
  sky_light: '#c6edfb',
  sky: '#6cc3e0',
  sky_dark: '#227d9b',
  lime_light: '#d3f1a7',
  lime: '#94c748',
  lime_dark: '#5b7f24',
  pink_light: '#fdd0ec',
  pink: '#e774bb',
  pink_dark: '#ae4787',
  black_light: '#dcdfe4',
  black: '#8590a2',
  black_dark: '#626f86',
};

// A Trello label may legitimately carry no colour at all.
const COLOURLESS = '#b3bac5';

export function hexForTrelloColor(color: string | null): string {
  if (color === null) return COLOURLESS;
  const hex = PALETTE[color];
  if (hex === undefined) {
    throw new Error(`Unknown Trello label colour "${color}"; add it to scripts/trello/colors.ts`);
  }
  return hex;
}
