/**
 * The one place the keys a card action is bound to are written down, so a hint
 * can never claim a key the keymap does not bind: the colocated test presses
 * every entry through the keymap itself. An empty list is an action the keyboard
 * does not reach at all.
 */
export type CardActionId =
  | 'open'
  | 'openDetail'
  | 'rename'
  | 'labels'
  | 'assignees'
  | 'blockers'
  | 'blocking'
  | 'move'
  | 'done'
  | 'duplicate'
  | 'archive'
  | 'openNewTab'
  | 'copyLink';

export const CARD_ACTION_KEYS: Record<CardActionId, string[]> = {
  open: ['Enter', 'o'],
  openDetail: ['e'],
  rename: [],
  labels: ['l'],
  assignees: ['a'],
  blockers: ['b'],
  blocking: ['Shift+B'],
  move: ['m'],
  done: ['d'],
  duplicate: ['Shift+D'],
  archive: [],
  openNewTab: [],
  copyLink: [],
};

export function keyEventInit(hint: string): { key: string; shiftKey: boolean } {
  const shiftKey = hint.startsWith('Shift+');
  return { key: shiftKey ? hint.slice('Shift+'.length) : hint, shiftKey };
}
