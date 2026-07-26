import { board } from './board.svelte';
import type { DependencyDirection } from './dependency-types';
import { append } from './positions';
import { router } from './router.svelte';
import { selection } from './selection.svelte';
import { session } from './session.svelte';

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

// Only marked dialogs own the keymap; the task overlay is an unmarked <dialog>
// whose keys must stay live.
function modalOwnsKeymap(): boolean {
  return document.querySelector('dialog[data-modal][open]') !== null;
}

class ShortcutController {
  helpOpen = $state(false);
  labelMenu = $state<string | null>(null);
  assigneeMenu = $state<string | null>(null);
  dependencyMenu = $state<{ taskId: string; direction: DependencyDirection } | null>(null);
  quickAddColumn = $state<string | null>(null);
  filterFocusRequested = $state(false);

  #gPending = false;
  #gTimer: ReturnType<typeof setTimeout> | undefined;

  get anyMenuOpen(): boolean {
    return (
      this.helpOpen ||
      this.labelMenu !== null ||
      this.assigneeMenu !== null ||
      this.dependencyMenu !== null
    );
  }

  closeMenus(): void {
    this.helpOpen = false;
    this.labelMenu = null;
    this.assigneeMenu = null;
    this.dependencyMenu = null;
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

    if (modalOwnsKeymap()) {
      return;
    }

    const route = router.current;
    const projectId = route.name === 'project' ? route.params.id : null;
    const view = route.name === 'project' ? route.params.view : null;
    const overlayTaskId = route.name === 'project' ? route.params.taskId : undefined;

    if (this.#gPending) {
      this.#gPending = false;
      clearTimeout(this.#gTimer);
      if (this.#completeChord(event.key.toLowerCase(), projectId)) {
        event.preventDefault();
        return;
      }
    }

    // Selection nav and card-scoped actions are live only on the board view with no
    // overlay: the graph has no card list, and an open task owns its own keymap.
    const selectionActive = view === 'board' && overlayTaskId === undefined;
    // The filter bar is part of the shared project header, so f reaches it from the
    // graph too — but an open task overlay owns the key.
    const filterBarActive = view !== null && overlayTaskId === undefined;
    if (selectionActive && this.#handleSelectionKey(event, projectId)) {
      return;
    }

    // The task-scoped keys target the open overlay task first, else the board
    // selection (null on the graph, so they no-op there without an overlay).
    this.#handleCommonKey(event, overlayTaskId, selectionActive, filterBarActive);
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
      router.navigate(`/projects/${projectId}${board.filterSearch}`);
      return true;
    }
    if (key === 'g') {
      router.navigate(`/projects/${projectId}/graph${board.filterSearch}`);
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
        router.navigate(`/projects/${projectId}/tasks/${selectedId}${board.filterSearch}`);
        break;
      case 'n': {
        const columnId = selection.selectedColumnId ?? board.columns[0]?.id ?? null;
        if (columnId === null) {
          return false;
        }
        this.quickAddColumn = columnId;
        break;
      }
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
    selectionActive: boolean,
    filterBarActive: boolean
  ): void {
    const target = overlayTaskId ?? (selectionActive ? selection.selectedTaskId : null);
    switch (event.key) {
      case '?':
        this.helpOpen = true;
        break;
      case 'f':
      case 'F':
        // A modified press is the browser's find-in-page, not ours.
        if (!filterBarActive || event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        this.filterFocusRequested = true;
        break;
      case 'q':
      case 'Q': {
        if (!filterBarActive || event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        const userId = session.user?.id;
        if (userId === undefined) {
          return;
        }
        board.toggleAssigneeFilter(userId);
        break;
      }
      case 'x':
      case 'X':
        if (
          !filterBarActive ||
          !board.hasActiveFilters ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey
        ) {
          return;
        }
        board.clearFilters();
        break;
      // A modified press belongs to the browser (Cmd+L, Cmd+A, Cmd+B), not to us.
      case 'l':
      case 'L':
        if (target === null || event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        this.labelMenu = target;
        break;
      case 'a':
      case 'A':
        if (target === null || event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        this.assigneeMenu = target;
        break;
      case 'b':
      case 'B':
        // CapsLock reports a plain press as 'B', so the direction comes from the
        // modifier and never the character.
        if (target === null || event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        this.dependencyMenu = { taskId: target, direction: event.shiftKey ? 'blocked' : 'blocker' };
        break;
      case 'g':
      case 'G':
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
