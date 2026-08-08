<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    // The button that opened the panel: it sets the horizontal offset and stays
    // "inside" for dismissal, so clicking it again toggles rather than re-opens.
    trigger: HTMLElement | undefined;
    label: string;
    // Owned by the caller, which needs it for the trigger's aria-controls.
    id?: string;
    // False when the trigger keeps the caret: a panel opened by focusing a text
    // field must leave focus where the typing is.
    autofocus?: boolean;
    onclose: (opts?: { restoreFocus?: boolean }) => void;
    children: Snippet;
  }

  let { trigger, label, id, autofocus = true, onclose, children }: Props = $props();

  let panelEl = $state<HTMLDivElement>();
  let left = $state(0);

  // The panel opens downward and never flips: it lives inside the task overlay,
  // whose overflow-y makes overflow-x compute to auto, so a panel wider than the
  // scrollport is clipped and one above its top edge is unreachable. offsetLeft,
  // clientWidth and offsetWidth all resolve against the same offsetParent, which
  // is why the clamp needs no viewport or scroll math.
  $effect(() => {
    const panel = panelEl;
    if (panel === undefined || trigger === undefined) {
      return;
    }
    const wrapper = panel.offsetParent;
    const room = wrapper instanceof HTMLElement ? wrapper.clientWidth : panel.offsetWidth;
    left = Math.max(0, Math.min(trigger.offsetLeft, room - panel.offsetWidth));
    panel.scrollIntoView({ block: 'nearest' });
  });

  // The bodies autofocus their own field through a use: action, which has already
  // run by the time effects do; this only catches a body that focuses nothing.
  $effect(() => {
    const panel = panelEl;
    if (autofocus && panel !== undefined && !panel.contains(document.activeElement)) {
      panel.focus({ preventScroll: true });
    }
  });

  function isInside(node: Node): boolean {
    return panelEl?.contains(node) === true || trigger?.contains(node) === true;
  }

  function onkeydown(event: KeyboardEvent): void {
    // A body that claims Escape for its own reset — clearing a search query —
    // calls preventDefault, so the first press clears and the second closes.
    // stopPropagation is what keeps it off the enclosing <dialog>'s close request.
    if (event.key !== 'Escape' || event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onclose({ restoreFocus: true });
  }

  // pointerdown rather than click, so a drag that starts outside does not leave
  // the panel floating. No wheel handler, unlike the card menu: this panel is
  // absolutely positioned, so it travels with its trigger instead of detaching.
  function closeOnOutside(event: Event): void {
    const target = event.target;
    if (target instanceof Node && !isInside(target)) {
      onclose();
    }
  }

  // A null relatedTarget is a click on dead space, which closeOnOutside owns;
  // acting on it here would also fire when the window itself loses focus.
  function closeOnFocusLeaving(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && !isInside(next)) {
      onclose();
    }
  }
</script>

<svelte:window onpointerdown={closeOnOutside} />

<!-- The panel is a focusable container, not a widget: role="group" is the honest
     label for a box of form controls, and Escape has to be caught above them all. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={panelEl}
  {id}
  role="group"
  aria-label={label}
  tabindex="-1"
  {onkeydown}
  onfocusout={closeOnFocusLeaving}
  style="left: {left}px"
  class="absolute top-full z-30 mt-1 max-h-[min(60svh,24rem)] w-[min(20rem,100%)] overflow-y-auto overscroll-contain rounded-md border border-edge bg-surface p-2 shadow-lg"
>
  {@render children()}
</div>
