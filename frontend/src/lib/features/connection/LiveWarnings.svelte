<script lang="ts">
  import { backendState } from '$lib/backend/state.svelte';
  import { refloatMenuActions } from './live';
  import { firmwareFaultWarning } from './live-status';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import Icon from '$lib/ui/Icon.svelte';
  import { warningLayer } from './warning-layer';
  import type { ActiveConnection } from '$lib/backend/contract';
  let {
    connection,
    onfaulthistory,
    onenablerefloat,
    onconfigure,
  }: {
    connection: ActiveConnection;
    onfaulthistory: () => void;
    onenablerefloat: () => void;
    onconfigure?: (trigger: HTMLButtonElement) => void;
  } = $props();
  const batteryMismatch = $derived(
    !!connection.savedDeviceId &&
      connection.deviceKind === 'board' &&
      connection.batteryEstimate.unavailableReason === 'series_mismatch'
  );
  const sample = $derived(connection.latestSample);
  const faultWarning = $derived(firmwareFaultWarning(sample));
  const enableRefloat = $derived(
    refloatMenuActions(connection).find(
      (action) => action.kind === 'control' && action.control === 'package' && action.enabled
    )
  );
  function enable() {
    if (enableRefloat && !enableRefloat.disabled && !backendState.busy) onenablerefloat();
  }
  function openFault() {
    onfaulthistory();
  }
</script>

{#if batteryMismatch || sample?.imuTimeoutActive || faultWarning || connection.refloatControls?.packageEnabled === false}
  <div use:warningLayer class="live-warning-layer absolute inset-x-2 top-0 z-30 shrink-0" aria-label="Board warnings">
    <div class="flex flex-col gap-2">
      {#if sample?.imuTimeoutActive}
        <div role="alert" class="rounded-xl border border-danger bg-surface px-3 py-2 text-danger shadow-lg">
          <span class="block text-sm font-semibold">IMU timeout</span>
          <span class="block text-xs">The board stopped receiving IMU data. Step off the board.</span>
        </div>
      {/if}
      {#if faultWarning}
        <div role="alert">
          <button
            type="button"
            class="flex w-full touch-manipulation items-center gap-2 rounded-xl border border-danger bg-surface px-3 py-2 text-left text-danger shadow-lg"
            aria-label={`Open faults and errors: ${faultWarning.title}`}
            onpointerdown={(event) => activateFromPointer(event, openFault)}
            onclick={(event) => activateFromKeyboardOrAssistiveClick(event, openFault)}
          >
            <Icon name="triangle-alert" class="shrink-0 text-xl" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold">{faultWarning.title}</span>
              <span class="mt-1 block text-xs"
                >{sample?.firmwareFault ? 'Controller fault active' : 'Fatal error latched'} · View details</span
              >
            </span>
            <Icon name="chevron-right" class="shrink-0" />
          </button>
        </div>
      {/if}
      {#if connection.refloatControls?.packageEnabled === false}
        <div
          class="flex items-center justify-between gap-2 rounded-xl border border-danger bg-surface px-3 py-2 text-danger shadow-lg"
        >
          <p role="status" class="flex items-center gap-2 text-sm font-semibold">
            <Icon name="triangle-alert" class="shrink-0 text-xl" />
            Refloat is disabled
          </p>
          <button
            type="button"
            class="min-h-11 shrink-0 touch-manipulation rounded-lg border border-danger bg-danger/10 px-3 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={!enableRefloat || enableRefloat.disabled || backendState.busy}
            aria-label="Enable Refloat"
            aria-busy={enableRefloat?.pending || undefined}
            onpointerdown={(event) => activateFromPointer(event, enable)}
            onclick={(event) => activateFromKeyboardOrAssistiveClick(event, enable)}
            >{enableRefloat?.pending ? 'Enabling…' : 'Enable'}</button
          >
        </div>
      {/if}
      {#if batteryMismatch}
        <div role="status" class="rounded-xl border border-warning bg-surface px-3 py-2 text-warning shadow-lg">
          <p class="text-sm font-semibold">Battery setup mismatch</p>
          <p class="text-xs">
            The selected battery’s series cell count does not match the controller. Battery percentage is unavailable.
          </p>
          {#if onconfigure}
            <button
              type="button"
              class="mt-2 min-h-11 touch-manipulation rounded-lg border border-warning px-3 py-2 text-sm font-semibold"
              onpointerdown={(event) => {
                const trigger = event.currentTarget;
                activateFromPointer(event, () => onconfigure?.(trigger));
              }}
              onclick={(event) => {
                const trigger = event.currentTarget;
                activateFromKeyboardOrAssistiveClick(event, () => onconfigure?.(trigger));
              }}>Review battery settings</button
            >
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
