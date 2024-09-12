<script lang="ts">
  import { State } from './FloatControlTypes';
  import Input from './Input.svelte';
  import { getIcon } from './MapUtils';
  import Modal from './Modal.svelte';
  import settings, { localStorageKey } from './Settings.svelte';

  $effect(() => {
    window.localStorage.setItem(localStorageKey, settings.storedSettings);
  });

  const inputClass = 'w-[70%] m-px';
</script>

<Modal bind:open={settings.open} title="Settings">
  <div class="h-full w-full flex flex-col justify-start items-center">
    <h3 class="font-bold text-lg my-2">Battery Specs</h3>
    <p>
      The following options help with calculating the voltage per cell, as well as configuring the voltage chart's axis
      limits.
    </p>
    <Input
      class={inputClass}
      id="cell_count"
      label="Cell Count"
      type="number"
      placeholder="20"
      bind:value={settings.cellCount}
      style="width:4rem"
    />
    <Input
      class={inputClass}
      id="cell_min_v"
      label="Cell Min Voltage"
      type="number"
      placeholder="3.0"
      step="0.1"
      bind:value={settings.cellMinVolt}
      style="width:4rem"
    />
    <Input
      class={inputClass}
      id="cell_max_v"
      label="Cell Max Voltage"
      type="number"
      placeholder="4.2"
      step="0.1"
      bind:value={settings.cellMaxVolt}
      style="width:4rem"
    />
    <h3 class="font-bold text-lg my-2">Map Options</h3>
    <ul class="text-left select-none">
      {#each Object.values(State) as state}
        {@const checked = !settings.hiddenFaults.includes(state)}
        {@const { icon, className } = getIcon(state)}
        {@const html = icon.createIcon().innerHTML.trim()}
        <li class="flex flex-rol justify-start items-center gap-2">
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
          <div class="w-4 h-4 fault-icon {className} {html ? 'svg' : ''}">
            {#if html}
              {@html html}
            {:else}
              &nbsp;
            {/if}
          </div>

          <label for="map_{state}">{state}</label>
        </li>
      {/each}
    </ul>
    <div class="grow flex flex-col justify-around items-center">
      <hr />
      <p>
        <strong>TIP:</strong> use the left and right arrows to step through one data point at a time!
      </p>
    </div>
  </div>
</Modal>
