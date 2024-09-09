<script lang="ts" module>
  import type { BatterySpecs } from './CommonTypes';
  import { demoFile } from './Csv';

  export interface Props extends BatterySpecs {
    selectedIndex: number | undefined;
    file: File | undefined;
  }
</script>

<script lang="ts">
  import Input from './Input.svelte';
  import Modal from './Modal.svelte';

  let {
    file = $bindable(),
    cellCount = $bindable(),
    cellMaxVolt = $bindable(),
    cellMinVolt = $bindable(),
  }: Props = $props();

  let open = $state(false);

  const closeRide = () => {
    file = undefined;
    open = false;
  };

  // FIXME: mobile view
  // TODO: button for explaining keyboard shortcuts and such
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
  style:height="var(--header-height)"
  style:padding-left="1rem"
  style:padding-right="1rem"
  style:white-space="nowrap"
>
  <h1 style:flex-grow="1" style:display="flex" style:flex-direction="row" style:justify-content="start">
    Float View
    {#if file === demoFile}
      <span
        style:width="1px"
        style:font-size="0.8rem"
        style:font-family="monospace"
        style:color="magenta"
      >
        (demo)
      </span>
    {/if}
  </h1>
  {#if file}
    <button onclick={closeRide}>close ride</button>
  {/if}
  <button onclick={() => (open = true)}>configure</button>
</header>

<Modal bind:open title="Settings">
  <div
  style:height="100%"
  style:width="100%"
  style:display="flex"
  style:flex-direction="column"
  style:justify-content="start"
  style:align-items="center"
  >
    <p>
      The following options help with calculating the voltage per cell, as well as configuring the voltage chart's axis limits.
    </p>
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
    <div
      style:flex-grow="1"
      style:display="flex"
      style:flex-direction="column"
      style:justify-content="space-around"
      style:align-items="center"
    >
      <hr style:border-color="#333" />
      <p>
        <strong>TIP:</strong> use the left and right arrows to step through one data point at a time!
      </p>
  </div>
  </div>
</Modal>

<style>
  hr {
    width: 70%;
  }
</style>