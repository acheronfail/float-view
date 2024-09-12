<script lang="ts">
  import { State } from './FloatControlTypes';
  import Input from './Input.svelte';
  import { getIcon } from './MapUtils';
  import Modal from './Modal.svelte';
  import settings, { localStorageKey } from './Settings.svelte';

  $effect(() => {
    window.localStorage.setItem(localStorageKey, settings.storedSettings);
  });
</script>

<Modal bind:open={settings.open} title="Settings">
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
    <Input
      id="cell_count"
      label="Cell Count"
      type="number"
      placeholder="20"
      bind:value={settings.cellCount}
      style="width:4rem"
    />
    <Input
      id="cell_min_v"
      label="Cell Min Voltage"
      type="number"
      placeholder="3.0"
      step="0.1"
      bind:value={settings.cellMinVolt}
      style="width:4rem"
    />
    <Input
      id="cell_max_v"
      label="Cell Max Voltage"
      type="number"
      placeholder="4.2"
      step="0.1"
      bind:value={settings.cellMaxVolt}
      style="width:4rem"
    />
    <h3>Map Options</h3>
    <ul style:text-align="left">
      {#each Object.values(State) as state}
        {@const checked = !settings.hiddenFaults.includes(state)}
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
              if (settings.hiddenFaults.includes(state)) {
                settings.hiddenFaults = settings.hiddenFaults.filter((s) => s !== state);
              } else {
                settings.hiddenFaults = settings.hiddenFaults.concat(state);
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
