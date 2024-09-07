<script lang="ts" context="module">
  import type { Snippet } from 'svelte';

  export type ListItem =
  { label: Snippet | string; value: Snippet | string } | '-';

  export interface Props {
    items: ListItem[];
  }
</script>

<script lang="ts">
  let { items }: Props = $props();
</script>

<div
  style:display="flex"
  style:width="60%"
  style:flex-direction="column"
  style:font-family="monospace"
>
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
      <div style:color="grey">
        {#if typeof item.label === 'string'}
          {item.label}:
        {:else}
          {@render item.label()}
        {/if}
      </div>
      <div>
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