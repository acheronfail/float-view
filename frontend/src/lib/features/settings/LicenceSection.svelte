<script lang="ts">
  import type { Snippet } from 'svelte';
  import { activateFromKeyboardOrAssistiveClick, activateFromPointer } from '$lib/ui/activation';

  let { title, children }: { title: string; children: Snippet } = $props();
  let expanded = $state(false);
  const id = $props.id();
  const toggle = () => {
    expanded = !expanded;
  };
</script>

<section class="min-w-0 rounded-lg border border-outline" aria-label={title}>
  <h2>
    <button
      type="button"
      class="flex min-h-11 w-full touch-manipulation items-center gap-3 px-3 py-3 text-left font-semibold"
      aria-expanded={expanded}
      aria-controls={id}
      onpointerdown={(event) => activateFromPointer(event, toggle)}
      onclick={(event) => activateFromKeyboardOrAssistiveClick(event, toggle)}
    >
      <span class="min-w-0 flex-1 break-words">{title}</span>
      <span aria-hidden="true" class="shrink-0">{expanded ? '−' : '+'}</span>
    </button>
  </h2>
  <div {id} hidden={!expanded} class="min-w-0 space-y-3 border-t border-outline p-3">
    {#if expanded}{@render children()}{/if}
  </div>
</section>
