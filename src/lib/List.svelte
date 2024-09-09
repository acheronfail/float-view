<script lang="ts" context="module">
  export type ListItem = { label: string; value: string; color?: string } | '-';

  export interface Props {
    items: ListItem[];
  }
</script>

<script lang="ts">
  let { items }: Props = $props();
</script>

<div style:display="flex" style:width="60%" style:flex-direction="column" style:font-family="monospace">
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
          {item.label}:
        </div>
        <div style:color={item.color}>
          {item.value}
        </div>
      {/if}
    </div>
  {/each}
</div>
