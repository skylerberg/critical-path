<script lang="ts">
  import { cardSaveMessage, type CardSaveState } from '../lib/card-save-state';

  interface Props {
    state: CardSaveState;
    // Handed in by the card, which points its Close button at this with
    // aria-describedby. Not a live region: the description already has one two
    // sections up, and a second one saying the same thing would announce every
    // keystroke's worth of state twice. Reaching the Close button reads it out
    // instead, which is the moment the answer is being asked for.
    id: string;
  }

  let { state, id }: Props = $props();

  const dot = $derived(
    state === 'error'
      ? 'bg-danger'
      : state === 'unsent'
        ? 'bg-warning'
        : state === 'saving'
          ? 'bg-accent'
          : 'bg-success'
  );
</script>

<p
  {id}
  data-testid="card-save-status"
  data-state={state}
  class="flex items-center gap-1.5 text-xs {state === 'error' ? 'text-danger' : 'text-muted'}"
>
  <span
    class="size-1.5 shrink-0 rounded-full {dot} {state === 'saving' ? 'animate-pulse' : ''}"
    aria-hidden="true"
  ></span>
  {cardSaveMessage(state)}
</p>
