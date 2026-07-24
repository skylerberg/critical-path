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
  filterFocusRequested = $state(false);

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
    this.filterFocusRequested = false;
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
    const view = route.name === 'project' ? route.params.view : null;
    const overlayTaskId = route.name === 'project' ? route.params.taskId : undefined;

    if (this.#gPending) {
      this.#gPending = false;
      clearTimeout(this.#gTimer);
      if (this.#completeChord(event.key, projectId)) {
        event.preventDefault();
        return;
      }
    }

    // Selection nav and card-scoped actions are live only on the board view with no
    // overlay: the graph has no card list, and an open task owns its own keymap.
    const selectionActive = view === 'board' && overlayTaskId === undefined;
    if (selectionActive && this.#handleSelectionKey(event, projectId)) {
      return;
    }

    // l/a target the open overlay task first, else the board selection (null on the
    // graph, so they no-op there without an overlay).
    this.#handleCommonKey(event, overlayTaskId, selectionActive);
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

  #handleSelectionKey(event: KeyboardEvent, projectId: string | null): boolean {
    const selectedId = selection.selectedTaskId;
    switch (event.key) {
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
          return false;
        }
        router.navigate(`/projects/${projectId}/tasks/${selectedId}`);
        break;
      case 'n': {
        const columnId = selection.selectedColumnId ?? board.columns[0]?.id ?? null;
        if (columnId === null) {
          return false;
        }
        this.quickAddColumn = columnId;
        break;
      }
      case 'f':
        // A modified press is the browser's find-in-page, not ours.
        if (event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }
        this.filterFocusRequested = true;
        break;
      case 'd': {
        if (selectedId === null) {
          return false;
        }
        const doneColumn = board.columns.find((column) => column.is_done);
        if (doneColumn === undefined) {
          return false;
        }
        void board.moveTask(
          selectedId,
          doneColumn.id,
          append(board.tasksInColumn(doneColumn.id).map((task) => task.position))
        );
        break;
      }
      default:
        return false;
    }
    event.preventDefault();
    return true;
  }

  #handleCommonKey(
    event: KeyboardEvent,
    overlayTaskId: string | undefined,
    selectionActive: boolean
  ): void {
    const target = overlayTaskId ?? (selectionActive ? selection.selectedTaskId : null);
    switch (event.key) {
      case '?':
        this.helpOpen = true;
        break;
      case 'l':
        if (target === null) {
          return;
        }
        this.labelMenu = target;
        break;
      case 'a':
        if (target === null) {
          return;
        }
        this.assigneeMenu = target;
        break;
      case 'g':
        this.#armChord();
        break;
      case 'Escape':
        // In the overlay the dialog's own cancel owns Escape; on the graph there is no
        // selection to clear. Only the board view clears the selection here.
        if (!selectionActive || selection.selectedTaskId === null) {
          return;
        }
        selection.clear();
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
