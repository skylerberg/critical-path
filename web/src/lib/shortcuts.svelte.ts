import { board } from './board.svelte';
import { append } from './positions';
import { router } from './router.svelte';
import { selection } from './selection.svelte';

const CHORD_WINDOW_MS = 800;

function isEditableTarget(): boolean {
  const el = document.activeElement;
  if (el === null) {
    return false;
  }
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return (el as HTMLElement).isContentEditable;
}

class ShortcutController {
  helpOpen = $state(false);
  labelMenu = $state<string | null>(null);
  assigneeMenu = $state<string | null>(null);
  quickAddColumn = $state<string | null>(null);

  #gPending = false;
  #gTimer: ReturnType<typeof setTimeout> | undefined;

  get anyMenuOpen(): boolean {
    return this.helpOpen || this.labelMenu !== null || this.assigneeMenu !== null;
  }

  closeMenus(): void {
    this.helpOpen = false;
    this.labelMenu = null;
    this.assigneeMenu = null;
  }

  reset(): void {
    this.closeMenus();
    this.quickAddColumn = null;
    this.#gPending = false;
    clearTimeout(this.#gTimer);
  }

  handleKeydown = (event: KeyboardEvent): void => {
    // svelte-dnd-action preventDefaults its own keyboard handlers; a live drag or a
    // focused text field must own the keystroke instead of the shortcut layer.
    if (event.defaultPrevented || board.dragging || isEditableTarget()) {
      return;
    }

    if (this.anyMenuOpen) {
      if (event.key === 'Escape') {
        this.closeMenus();
        event.preventDefault();
      }
      return;
    }

    const route = router.current;
    const projectId = route.name === 'project' ? route.params.id : null;
    const overlayTaskId = route.name === 'project' ? route.params.taskId : undefined;

    if (this.#gPending) {
      this.#gPending = false;
      clearTimeout(this.#gTimer);
      if (this.#completeChord(event.key, projectId)) {
        event.preventDefault();
        return;
      }
    }

    if (overlayTaskId !== undefined) {
      this.#handleOverlayKey(event, overlayTaskId);
      return;
    }

    this.#handleBoardKey(event, projectId);
  };

  #completeChord(key: string, projectId: string | null): boolean {
    if (key === 'p') {
      router.navigate('/projects');
      return true;
    }
    if (projectId === null) {
      return false;
    }
    if (key === 'b') {
      router.navigate(`/projects/${projectId}`);
      return true;
    }
    if (key === 'g') {
      router.navigate(`/projects/${projectId}/graph`);
      return true;
    }
    return false;
  }

  #handleOverlayKey(event: KeyboardEvent, taskId: string): void {
    switch (event.key) {
      case 'l':
        this.labelMenu = taskId;
        event.preventDefault();
        break;
      case 'a':
        this.assigneeMenu = taskId;
        event.preventDefault();
        break;
      case '?':
        this.helpOpen = true;
        event.preventDefault();
        break;
      // Escape yields to the dialog's own cancel handler.
    }
  }

  #handleBoardKey(event: KeyboardEvent, projectId: string | null): void {
    const selectedId = selection.selectedTaskId;
    switch (event.key) {
      case '?':
        this.helpOpen = true;
        break;
      case 'Escape':
        if (selectedId === null) {
          return;
        }
        selection.clear();
        break;
      case 'j':
      case 'ArrowDown':
        selection.move('down');
        break;
      case 'k':
      case 'ArrowUp':
        selection.move('up');
        break;
      case 'ArrowLeft':
        selection.move('left');
        break;
      case 'ArrowRight':
        selection.move('right');
        break;
      case 'Enter':
      case 'o':
      case 'e':
        if (selectedId === null || projectId === null) {
          return;
        }
        router.navigate(`/projects/${projectId}/tasks/${selectedId}`);
        break;
      case 'n': {
        const columnId = selection.selectedColumnId ?? board.columns[0]?.id ?? null;
        if (columnId === null) {
          return;
        }
        this.quickAddColumn = columnId;
        break;
      }
      case 'l':
        if (selectedId === null) {
          return;
        }
        this.labelMenu = selectedId;
        break;
      case 'a':
        if (selectedId === null) {
          return;
        }
        this.assigneeMenu = selectedId;
        break;
      case 'd': {
        if (selectedId === null) {
          return;
        }
        const doneColumn = board.columns.find((column) => column.is_done);
        if (doneColumn === undefined) {
          return;
        }
        void board.moveTask(
          selectedId,
          doneColumn.id,
          append(board.tasksInColumn(doneColumn.id).map((task) => task.position))
        );
        break;
      }
      case 'g':
        this.#armChord();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  #armChord(): void {
    this.#gPending = true;
    clearTimeout(this.#gTimer);
    this.#gTimer = setTimeout(() => {
      this.#gPending = false;
    }, CHORD_WINDOW_MS);
  }
}

export const shortcuts = new ShortcutController();
