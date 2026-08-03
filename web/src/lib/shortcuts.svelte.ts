import { board } from './board.svelte';
import { cardMenu } from './card-menu.svelte';
import { editableCardTarget } from './card-target';
import type { DependencyDirection } from './dependency-types';
import { router } from './router.svelte';
import { projectHref, taskHref } from './short-links';
import { selection } from './selection.svelte';
import { session } from './session.svelte';
import { currentProjectId } from './task-route.svelte';
import { isApplePlatform } from './userAgent';

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

// CapsLock reports a plain press as 'K', so the chord comes from the modifier and
// never the character. Ctrl+K is kill-to-end-of-line in every macOS text field, so
// there the palette answers to Cmd alone; Cmd+Shift+K is the browser's console.
function isPaletteChord(event: KeyboardEvent): boolean {
  if ((event.key !== 'k' && event.key !== 'K') || event.altKey || event.shiftKey) {
    return false;
  }
  return event.metaKey || (event.ctrlKey && !isApplePlatform(navigator.userAgent));
}

class ShortcutController {
  paletteOpen = $state(false);
  helpOpen = $state(false);
  labelMenu = $state<string | null>(null);
  assigneeMenu = $state<string | null>(null);
  dependencyMenu = $state<{ taskId: string; direction: DependencyDirection } | null>(null);
  moveMenu = $state<string | null>(null);
  // Seeds the search box of the label or move menu about to open, so a palette row
  // that named a label or a column lands on it instead of the whole list.
  menuPrefill = $state('');
  quickAddColumn = $state<string | null>(null);
  filterFocusRequested = $state(false);
  searchFocusRequested = $state(false);

  #gPending = false;
  #gTimer: ReturnType<typeof setTimeout> | undefined;

  get anyMenuOpen(): boolean {
    return (
      this.paletteOpen ||
      this.helpOpen ||
      this.labelMenu !== null ||
      this.assigneeMenu !== null ||
      this.dependencyMenu !== null ||
      this.moveMenu !== null ||
      cardMenu.taskId !== null
    );
  }

  // No focus restore: this is also what a route change calls, and pulling focus
  // back onto a card the user has navigated away from is not a courtesy. The menu
  // itself returns focus on the paths that dismiss it in place.
  closeMenus(): void {
    this.paletteOpen = false;
    this.helpOpen = false;
    this.labelMenu = null;
    this.assigneeMenu = null;
    this.dependencyMenu = null;
    this.moveMenu = null;
    this.menuPrefill = '';
    cardMenu.reset();
  }

  reset(): void {
    this.closeMenus();
    this.quickAddColumn = null;
    this.filterFocusRequested = false;
    this.searchFocusRequested = false;
    this.#gPending = false;
    clearTimeout(this.#gTimer);
  }

  handleKeydown = (event: KeyboardEvent): void => {
    // svelte-dnd-action preventDefaults its own keyboard handlers; a live drag must
    // own the keystroke instead of the shortcut layer.
    if (event.defaultPrevented || board.dragBusy) {
      return;
    }

    // Above the editable-target, menu-open and modal guards: this is the one key
    // that has to reach the user from inside a text field and over an open overlay.
    if (isPaletteChord(event)) {
      this.#togglePalette(event);
      return;
    }

    // A focused text field must own the keystroke instead of the shortcut layer.
    if (isEditableTarget()) {
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
    const projectId = currentProjectId();
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

    this.#handleCommonKey(event, selectionActive, filterBarActive);
  };

  #completeChord(key: string, projectId: string | null): boolean {
    if (key === 'p') {
      router.navigate('/');
      return true;
    }
    if (key === 'm') {
      router.navigate('/my-tasks');
      return true;
    }
    if (projectId === null) {
      return false;
    }
    if (key === 'b') {
      router.navigate(projectHref(projectId, board.project?.name ?? '') + board.filterSearch);
      return true;
    }
    if (key === 'g') {
      router.navigate(
        projectHref(projectId, board.project?.name ?? '', 'graph') + board.filterSearch
      );
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
      case 'e': {
        if (selectedId === null || projectId === null) {
          return false;
        }
        const title = board.tasks.find((t) => t.id === selectedId)?.title ?? '';
        router.navigate(taskHref(selectedId, title) + board.filterSearch);
        break;
      }
      case 'n': {
        const columnId = selection.selectedColumnId ?? board.columns[0]?.id ?? null;
        if (columnId === null || !board.canEdit) {
          return false;
        }
        this.quickAddColumn = columnId;
        break;
      }
      case 'd':
      case 'D':
        // CapsLock inverts the character, so duplicate-versus-done comes from the
        // modifier and never from the case of the key.
        if (
          selectedId === null ||
          !board.canEdit ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey
        ) {
          return false;
        }
        if (event.shiftKey) {
          // Held keys autorepeat, and unlike the other shortcuts this one mints a
          // row per event: a leaned-on key would bury the column in copies.
          if (event.repeat) {
            return false;
          }
          void board.duplicateTask(selectedId);
          break;
        }
        if (!board.markTaskDone(selectedId)) {
          return false;
        }
        break;
      default:
        return false;
    }
    event.preventDefault();
    return true;
  }

  #handleCommonKey(event: KeyboardEvent, selectionActive: boolean, filterBarActive: boolean): void {
    const editTarget = editableCardTarget();
    switch (event.key) {
      case '?':
        this.helpOpen = true;
        break;
      case '/':
        // A modified press is the browser's quick-find, not ours.
        if (event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        // Navigating to the page already on screen would throw away the query
        // it is holding, so there the key means "back to the box".
        if (router.current.name === 'search') {
          this.searchFocusRequested = true;
        } else {
          router.navigate('/search');
        }
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
      // A modified press belongs to the browser or the OS (Cmd+L, Cmd+A, Cmd+B,
      // Cmd+M minimises), not to us.
      case 'l':
      case 'L':
        if (editTarget === null || event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        this.labelMenu = editTarget;
        break;
      case 'a':
      case 'A':
        if (editTarget === null || event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        this.assigneeMenu = editTarget;
        break;
      case 'b':
      case 'B':
        // CapsLock reports a plain press as 'B', so the direction comes from the
        // modifier and never the character.
        if (editTarget === null || event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        this.dependencyMenu = {
          taskId: editTarget,
          direction: event.shiftKey ? 'blocked' : 'blocker',
        };
        break;
      case 'm':
      case 'M':
        if (editTarget === null || event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        this.moveMenu = editTarget;
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

  #togglePalette(event: KeyboardEvent): void {
    // A dialog that is not one of ours is a question waiting on an answer: leave it
    // up, and leave the browser its own key.
    if (!this.paletteOpen && modalOwnsKeymap() && !this.anyMenuOpen) {
      return;
    }
    // Claimed even on autorepeat: a held key would otherwise leak its later events
    // to whatever the browser binds the chord to.
    event.preventDefault();
    if (event.repeat) {
      return;
    }
    if (this.paletteOpen) {
      this.paletteOpen = false;
      return;
    }
    // One overlay at a time, rather than a second modal dialog stacked on ours.
    this.closeMenus();
    this.paletteOpen = true;
  }
}

export const shortcuts = new ShortcutController();
