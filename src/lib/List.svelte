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

<div style:display="flex" style:width="90%" style:flex-direction="column" style:font-family="monospace">
  {#each items as item, i (i)}
    <div
      style:display="flex"
      style:flex-direction="row"
      style:justify-content="space-between"
      style:align-items="center"
    >
      {#if typeof item === 'string'}
        <hr style:width="75%" style:border-color="#333" />
      {:else}
        <div
          title={item.htmlTitle ?? item.label}
          style:color="grey"
          style:text-overflow="ellipsis"
          style:white-space="nowrap"
          style:overflow="hidden"
        >
          {item.label}:
        </div>
        <div style:color={item.color} style:flex-grow="1" style:white-space="nowrap" style:text-align="right">
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
