<script lang="ts" module>
  import type { Snippet } from 'svelte';

  export type ListItem =
    | {
        label: string;
        value: string | Snippet;
        color?: string;
        htmlTitle?: string;
      }
    | '-';

  export interface Props {
    items: ListItem[];
  }
</script>

<script lang="ts">
  let { items }: Props = $props();
</script>

<div class="flex w-[90%] flex-col font-mono">
  {#each items as item, i (i)}
    <div class="flex flex-row justify-between items-center">
      {#if typeof item === 'string'}
        <hr class="mx-auto my-2 border-slate-700" />
      {:else}
        <div class="truncate text-slate-500" title={item.htmlTitle ?? item.label}>
          {item.label}:
        </div>
        <div class="grow whitespace-nowrap text-right" style:color={item.color}>
          {#if typeof item.value === 'string'}
            {item.value}
          {:else}
            {@render item.value()}
          {/if}
        </div>
      {/if}
    </div>
  {/each}
</div>
