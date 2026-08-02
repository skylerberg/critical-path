import { board } from './board.svelte';
import { selection } from './selection.svelte';

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;
const CLICK_SWALLOW_MS = 700;

interface Press {
  taskId: string;
  x: number;
  y: number;
}

function cardElement(taskId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`);
}

/**
 * The drag library offers no way to abort a pointer drag: the window touchend it
 * listens for is the only path into its teardown, and its handler reads nothing
 * off the event. Without this the finger that opened the menu would still be
 * holding a lifted card.
 */
function releaseArmedDrag(): void {
  if (board.dragging) {
    window.dispatchEvent(new Event('touchend'));
  }
}

/**
 * The press that opened the menu still ends in a click on the card's link, which
 * would open the task behind the menu. The timeout matters because an engine
 * that synthesises no click at all must not leave the next real one armed.
 */
function swallowNextClick(): void {
  function swallow(event: MouseEvent): void {
    // Not the menu's own rows: a quick tap on one of them can beat the timeout.
    if (event.target instanceof Element && event.target.closest('[role="menu"]') !== null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    stop();
  }
  const timer = setTimeout(() => stop(), CLICK_SWALLOW_MS);
  const stop = (): void => {
    clearTimeout(timer);
    document.removeEventListener('click', swallow, true);
  };
  document.addEventListener('click', swallow, true);
}

class CardMenuController {
  taskId = $state<string | null>(null);
  x = $state(0);
  y = $state(0);
  renamingTaskId = $state<string | null>(null);

  #timer: ReturnType<typeof setTimeout> | undefined;
  #press: Press | null = null;

  // Selects too, so the keys the menu advertises act on the card it was opened on
  // the moment it closes. A rename in flight elsewhere is left alone: the focus
  // the menu takes blurs it, which saves it.
  open(taskId: string, x: number, y: number): void {
    this.cancelPress();
    selection.set(taskId);
    this.taskId = taskId;
    this.x = x;
    this.y = y;
  }

  close({ restoreFocus = false }: { restoreFocus?: boolean } = {}): void {
    const taskId = this.taskId;
    if (taskId === null) {
      return;
    }
    this.taskId = null;
    if (restoreFocus) {
      cardElement(taskId)?.focus({ preventScroll: true });
    }
  }

  rename(taskId: string): void {
    this.taskId = null;
    this.renamingTaskId = taskId;
  }

  endRename(): void {
    this.renamingTaskId = null;
  }

  reset(): void {
    this.cancelPress();
    this.taskId = null;
    this.renamingTaskId = null;
  }

  /**
   * Touch has no right-click, so a press held still opens the menu. A press that
   * turns into a drag moves, and any movement past the slop hands the gesture
   * back to the drag layer — which by then owns it, since it lifts the card well
   * before this fires.
   */
  pressStart(event: PointerEvent, taskId: string): void {
    if (event.pointerType === 'mouse' || !event.isPrimary) {
      return;
    }
    this.cancelPress();
    this.#press = { taskId, x: event.clientX, y: event.clientY };
    document.addEventListener('pointermove', this.#track, true);
    document.addEventListener('pointerup', this.#endPress, true);
    document.addEventListener('pointercancel', this.#endPress, true);
    this.#timer = setTimeout(this.#fire, LONG_PRESS_MS);
  }

  cancelPress(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#press = null;
    document.removeEventListener('pointermove', this.#track, true);
    document.removeEventListener('pointerup', this.#endPress, true);
    document.removeEventListener('pointercancel', this.#endPress, true);
  }

  // Listeners sit on the document, not the card: the drag layer reparents and
  // hides the pressed card the moment it lifts it, and a listener on the card
  // would stop hearing the very movement that has to call the press off.
  #track = (event: PointerEvent): void => {
    const press = this.#press;
    if (press === null) {
      return;
    }
    if (
      Math.abs(event.clientX - press.x) > LONG_PRESS_SLOP_PX ||
      Math.abs(event.clientY - press.y) > LONG_PRESS_SLOP_PX
    ) {
      this.cancelPress();
    }
  };

  #endPress = (): void => {
    this.cancelPress();
  };

  #fire = (): void => {
    const press = this.#press;
    this.cancelPress();
    if (press === null || !board.tasks.some((task) => task.id === press.taskId)) {
      return;
    }
    releaseArmedDrag();
    swallowNextClick();
    this.open(press.taskId, press.x, press.y);
  };
}

export const cardMenu = new CardMenuController();
