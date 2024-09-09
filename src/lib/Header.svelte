<script lang="ts" context="module">
  import type { BatterySpecs } from './CommonTypes';

  export const HEADER_HEIGHT = '3rem';

  export interface Props extends BatterySpecs {
    selectedIndex: number | undefined;
    file: File | undefined;
    demo: boolean;
  }
</script>

<script lang="ts">
  import Input from './Input.svelte';

  let {
    selectedIndex,
    demo = $bindable(),
    file = $bindable(),
    cellCount = $bindable(),
    cellMaxVolt = $bindable(),
    cellMinVolt = $bindable(),
  }: Props = $props();
</script>

<header
  style:position="sticky"
  style:z-index="10000"
  style:top="0"
  style:display="flex"
  style:justify-content="space-between"
  style:align-items="center"
  style:gap="1rem"
  style:background-color="#121418"
  style:border-bottom="1px solid #333"
  style:height={HEADER_HEIGHT}
  style:padding-left="1rem"
  style:padding-right="1rem"
>
  <h1 style:flex-grow="1">
    Float View
    {#if demo}
      <span style:font-size="1rem" style:font-family="monospace">(demo ride)</span>
    {/if}
  </h1>
  {#if typeof selectedIndex === 'number'}
    <div
      style:font-family="monospace"
      style:display="flex"
      style:flex-direction="row"
      style:justify-content="space-between"
      style:width="7rem"
    >
      <span>Selected:</span>
      <span style:flex-grow="1" style:text-align="right">{selectedIndex}</span>
    </div>
  {/if}
  {#if demo}
    <button onclick={() => (demo = false)}>open a ride</button>
  {/if}
  {#if file}
    <button onclick={() => (file = undefined)}>close ride</button>
  {/if}
  <Input id="cell_count" label="Cell Count" type="number" bind:value={cellCount} style="width:4rem" />
  <Input
    id="cell_min_v"
    label="Cell Min Voltage"
    type="number"
    step="0.1"
    bind:value={cellMinVolt}
    style="width:4rem"
  />
  <Input
    id="cell_max_v"
    label="Cell Max Voltage"
    type="number"
    step="0.1"
    bind:value={cellMaxVolt}
    style="width:4rem"
  />
</header>
