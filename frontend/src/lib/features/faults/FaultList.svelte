<script lang="ts">
  import type { FirmwareFaultEntry } from '$lib/backend/contract';
  import { faultLabel, faultTime } from './faults';
  import Icon from '$lib/ui/Icon.svelte';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  let shown = $state(20);
  let {
    faults,
    onselect,
  }: {
    faults: readonly (Omit<FirmwareFaultEntry, 'reason' | 'code'> & { reason: string; code: number | null })[];
    onselect?: (elapsedMs: number) => void;
  } = $props();
</script>

<ol class="space-y-2" aria-label="Controller faults and IMU timeouts">
  {#each faults.slice(0, shown) as fault, index (index)}
    <li class="rounded-lg border border-danger/40 bg-danger/5 text-sm">
      {#snippet content()}
        <Icon name="triangle-alert" class="shrink-0 text-lg text-danger" />
        <span class="min-w-0 flex-1 font-medium">{faultLabel(fault.reason, fault.code)}</span>
        <span class="shrink-0 text-xs text-muted"
          >{faultTime(fault.elapsedMs)}{#if fault.elapsedMs === null}<span class="block"
              >Observed {faultTime(fault.observedElapsedMs)}</span
            >{/if}</span
        >
      {/snippet}
      {#if onselect && fault.elapsedMs !== null}
        <button
          type="button"
          class="flex min-h-11 w-full touch-manipulation items-center gap-2 p-3 text-left"
          onpointerdown={(event) => activateFromPointer(event, () => onselect?.(fault.elapsedMs!))}
          onclick={(event) => activateFromKeyboardOrAssistiveClick(event, () => onselect?.(fault.elapsedMs!))}
        >
          {@render content()}
        </button>
      {:else}
        <div class="flex min-h-11 items-center gap-2 p-3">{@render content()}</div>
      {/if}
    </li>
  {/each}
</ol>

{#if shown < faults.length}
  <button
    type="button"
    class="mt-2 min-h-11 touch-manipulation rounded-lg border border-outline px-3 text-sm"
    onpointerdown={(event) =>
      activateFromPointer(event, () => {
        shown += 20;
      })}
    onclick={(event) =>
      activateFromKeyboardOrAssistiveClick(event, () => {
        shown += 20;
      })}>Show more</button
  >
{/if}
