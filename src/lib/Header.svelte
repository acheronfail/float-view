<script lang="ts" module>
  import type { BatterySpecs } from './CommonTypes';
  import { demoFile } from './Csv';
  import { State } from './FloatControlTypes';

  export interface Props extends BatterySpecs {
    file: File | undefined;
    hiddenFaults: State[];
  }
</script>

<script lang="ts">
  import Input from './Input.svelte';
  import { getIcon } from './MapUtils';
  import Modal from './Modal.svelte';

  let {
    file = $bindable(),
    cellCount = $bindable(),
    cellMaxVolt = $bindable(),
    cellMinVolt = $bindable(),
    hiddenFaults = $bindable(),
  }: Props = $props();

  let open = $state(false);

  const closeRide = () => {
    file = undefined;
    open = false;
  };
</script>

<div
  style:position="fixed"
  style:z-index="1"
  style:height="calc(var(--header-height) + 1000px)"
  style:top="-1000px"
  style:left="0"
  style:right="0"
  style:background-color="#121418"
>
  <!-- hack to stop mobiles with notches from showing content as they scroll -->
</div>

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
      <span style:width="1px" style:font-size="0.8rem" style:font-family="monospace" style:color="magenta">
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
    <h3>Battery Specs</h3>
    <p>
      The following options help with calculating the voltage per cell, as well as configuring the voltage chart's axis
      limits.
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
    <h3>Map Options</h3>
    <ul style:text-align="left">
      {#each Object.values(State) as state}
        {@const checked = !hiddenFaults.includes(state)}
        {@const { icon, className } = getIcon(state)}
        {@const html = icon.createIcon().innerHTML.trim()}
        <li>
          <div class="fault-icon {className} {html ? 'svg' : 'generic'}">
            {#if html}
              {@html html}
            {:else}
              &nbsp;
            {/if}
          </div>
          <input
            type="checkbox"
            id="map_{state}"
            {checked}
            onchange={() => {
              if (hiddenFaults.includes(state)) {
                hiddenFaults = hiddenFaults.filter((s) => s !== state);
              } else {
                hiddenFaults = hiddenFaults.concat(state);
              }
            }}
          />
          <label for="map_{state}">{state}</label>
        </li>
      {/each}
    </ul>
    <div
      style:flex-grow="1"
      style:display="flex"
      style:flex-direction="column"
      style:justify-content="space-around"
      style:align-items="center"
    >
      <hr />
      <p>
        <strong>TIP:</strong> use the left and right arrows to step through one data point at a time!
      </p>
    </div>
  </div>
</Modal>

<style>
  ul {
    user-select: none;
  }

  .fault-icon {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    width: 12px;
    height: 12px;
  }
  .fault-icon.generic {
    border: 1px solid black;
  }
</style>
