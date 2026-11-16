<script lang="ts">
  import type { Snippet } from 'svelte';
  import SectionTitle from '../../ui/SectionTitle.svelte';

  let {
    title,
    items,
    note,
    warningItems = [],
    accessory,
    children,
  }: {
    title: string;
    items: [string, string][];
    note?: string;
    warningItems?: string[];
    accessory?: Snippet;
    children?: Snippet;
  } = $props();
</script>

<section aria-label={title} class="flex min-w-0 flex-col gap-2">
  <SectionTitle {title} />
  <dl class="telemetry-rows grid gap-1 font-mono">
    {#each items as item, index (item[0])}
      <div
        class="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-baseline gap-x-3 rounded border px-2 py-1 {warningItems.includes(
          item[0]
        )
          ? 'border-warning bg-warning/10 text-warning'
          : 'border-outline odd:bg-surface'}"
      >
        <dt
          class="min-w-0 text-xs leading-5 [overflow-wrap:anywhere] uppercase"
          class:text-muted={!warningItems.includes(item[0])}
        >
          {item[0]}:
        </dt>
        <dd
          class="flex min-w-0 items-center justify-end gap-1 text-right text-xs leading-5 font-medium [overflow-wrap:anywhere]"
        >
          <span class="min-w-0">{item[1]}</span>
          {#if index === 0 && accessory}{@render accessory()}{/if}
        </dd>
      </div>
    {/each}
  </dl>
  {#if note}<p class="px-2 text-xs leading-5 text-muted">{note}</p>{/if}
  {#if children}{@render children()}{/if}
</section>

<style>
  .telemetry-rows {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
  }
</style>
