<script lang="ts">
  import { tick, onMount } from 'svelte';
  import { backendState } from '$lib/backend/state.svelte';
  import {
    defaultLiveWidgetSlots,
    type LiveSample,
    type LiveWidgetField,
    type LiveWidgetSlots,
  } from '$lib/backend/contract';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import LiveNumber from './LiveNumber.svelte';
  import LiveValuePicker from './LiveValuePicker.svelte';
  import { liveValueCatalog } from './live-values';
  import { holdToConfigure } from './hold-to-configure';
  import { isLighting, lightingBox, exampleLightingBox } from './lighting';
  import { createThemeToggle } from './theme-toggle.svelte';
  import ThemeToggleDisplay from './ThemeToggleDisplay.svelte';
  import LightingDisplay from './LightingDisplay.svelte';

  import { previewLocation, previewNowMs, type PreviewInteractions } from './dashboard-preview';

  const appearance = createThemeToggle();

  let {
    sample,
    slot,
    previewSlots,
    previewInteractions,
    onselect,
  }: {
    sample: LiveSample | null | undefined;
    slot: number;
    previewSlots?: LiveWidgetSlots;
    previewInteractions?: PreviewInteractions;
    onselect?: (slot: number, field: LiveWidgetField) => Promise<void>;
  } = $props();
  const preview = $derived(!!previewSlots);
  const connection = $derived(preview ? null : backendState.snapshot?.activeConnection);
  const location = $derived(
    preview ? previewLocation : connection?.state === 'ready' ? connection.latestLocation : null
  );
  const slots = $derived(previewSlots ?? connection?.liveWidgetSlots ?? defaultLiveWidgetSlots);
  const savedField = $derived(slots[slot]);
  let exampleField = $state<LiveWidgetField | null>(null);
  $effect(() => {
    void savedField;
    exampleField = null;
  });
  const field = $derived(preview ? (exampleField ?? slots[slot]) : slots[slot]);
  const alternateDistance = $derived(field === 'distanceM' ? 'odometerM' : field === 'odometerM' ? 'distanceM' : null);
  const units = $derived(backendState.settings?.unitPreference ?? 'metric');
  const lighting = $derived(
    isLighting(field)
      ? preview && previewInteractions
        ? exampleLightingBox(previewInteractions.lighting[field])
        : lightingBox(connection, field)
      : null
  );

  const estimatedLevel = $derived(preview ? sample?.batteryLevel : connection?.batteryEstimate.level);
  let nowMs = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (nowMs = Date.now()), 1_000);
    return () => clearInterval(timer);
  });
  const bms = $derived(connection?.state === 'ready' ? connection.bms : null);
  const connectionKey = $derived(
    `${preview ? 'preview' : (connection?.deviceId ?? '')}:${connection?.savedDeviceId ?? ''}:${connection?.trackingMode ?? ''}`
  );
  let pickerConnectionKey = $state<string | null>(null);
  $effect(() => {
    if (selectedSlot != null && pickerConnectionKey !== connectionKey) {
      selectedSlot = null;
      error = null;
    }
  });
  let selectedSlot = $state<number | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let trigger: HTMLButtonElement | undefined;
  let button: HTMLButtonElement;
  let toggling = $state(false);
  async function toggleLighting() {
    if (!isLighting(field) || !lighting || lighting.disabled || toggling) return;
    if (preview) {
      previewInteractions?.toggleLighting(field);
      return;
    }
    if (backendState.busy) return;
    toggling = true;
    await backendState.setRefloatControl(field, !lighting.checked);
    toggling = false;
  }
  function keyboardActivate() {
    if (field === 'themeToggle') void appearance.toggle();
    else if (lighting) void toggleLighting();
    else if (alternateDistance) void toggleDistance();
    else open(button);
  }
  async function toggleDistance() {
    if (!alternateDistance || toggling || busy) return;
    if (preview) {
      exampleField = alternateDistance;
      return;
    }
    if (backendState.busy) return;
    toggling = true;
    await backendState.updateLiveWidgetSlot(slot, alternateDistance);
    toggling = false;
  }
  function tap() {
    if (field === 'themeToggle') void appearance.toggle();
    else if (alternateDistance) void toggleDistance();
    else void toggleLighting();
  }

  function open(button: HTMLButtonElement) {
    pickerConnectionKey = connectionKey;
    trigger = button;
    error = null;
    selectedSlot = slot;
  }
  async function close(keyboard: boolean) {
    if (busy) return;
    selectedSlot = null;
    await tick();
    if (keyboard) trigger?.focus();
    else trigger?.blur();
  }
  async function select(field: LiveWidgetField, keyboard: boolean) {
    if (busy || selectedSlot == null) return;
    if (slots[selectedSlot] === field) {
      exampleField = null;
      await close(keyboard);
      return;
    }
    busy = true;
    error = null;
    const savingKey = pickerConnectionKey;
    let saved = false;
    try {
      if (preview) {
        if (!onselect) throw new Error('This preview is read-only.');
        await onselect(selectedSlot, field);
        saved = true;
      } else saved = await backendState.updateLiveWidgetSlot(selectedSlot, field);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save this reading. Try again.';
    }
    busy = false;
    if (savingKey !== connectionKey || savingKey !== pickerConnectionKey) return;
    if (saved) {
      exampleField = null;
      await close(keyboard);
    } else error ??= backendState.error ?? 'Could not save this reading. Try again.';
  }
</script>

<div class="min-w-0">
  <button
    bind:this={button}
    use:holdToConfigure={{
      key: `${slot}:${field}:${connectionKey}`,
      onhold: () => open(button),
      ontap: tap,
    }}
    type="button"
    role={lighting?.checked != null ? 'switch' : undefined}
    aria-checked={lighting?.checked ?? undefined}
    aria-pressed={field === 'themeToggle' ? appearance.theme === 'dark' : undefined}
    aria-busy={field === 'themeToggle'
      ? appearance.pending
      : lighting
        ? lighting.pending || toggling
        : alternateDistance
          ? toggling
          : undefined}
    aria-disabled={field === 'themeToggle'
      ? appearance.disabled
      : lighting
        ? lighting.disabled || toggling || (!preview && backendState.busy)
        : alternateDistance
          ? toggling || busy || (!preview && backendState.busy)
          : undefined}
    aria-label={field === 'themeToggle'
      ? 'Light / dark mode'
      : lighting
        ? liveValueCatalog[field].name
        : alternateDistance
          ? `Box ${slot + 1}: ${liveValueCatalog[field].name}`
          : `Choose value for box ${slot + 1}: ${liveValueCatalog[field].name}`}
    aria-describedby={`live-number-${slot} live-box-help-${slot}`}
    aria-keyshortcuts="Shift+Enter"
    class="live-value-button flex h-14 w-full min-w-0 touch-pan-y items-center justify-center rounded-lg border border-outline bg-surface px-1 py-1.5 text-center select-none focus-visible:outline-2 focus-visible:outline-accent"
    onclick={(event) => activateFromKeyboardOrAssistiveClick(event, keyboardActivate)}
    onkeydown={(event) => {
      if (field === 'themeToggle' && event.repeat && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        return;
      }
      if (
        (event.key === 'Enter' && event.shiftKey) ||
        event.key === 'ContextMenu' ||
        (event.key === 'F10' && event.shiftKey)
      ) {
        event.preventDefault();
        if (!event.repeat) open(button);
      }
    }}
  >
    <div class="w-full" id={`live-number-${slot}`} role="group" aria-label={liveValueCatalog[field].name}>
      {#if field === 'empty'}
        <span class="flex items-center justify-center text-xs text-muted">Hold to set</span>
      {:else if field === 'themeToggle'}
        <ThemeToggleDisplay theme={appearance.theme} pending={appearance.pending} failed={appearance.failed} />
      {:else if lighting}
        <LightingDisplay field={field === 'headlights' ? 'headlights' : 'leds'} {lighting} {toggling} />
      {:else}
        <LiveNumber {field} {sample} {units} {estimatedLevel} {bms} nowMs={preview ? previewNowMs : nowMs} {location} />
      {/if}
    </div>
  </button>
  <span id={`live-box-help-${slot}`} class="sr-only"
    >Hold to configure. Shift+Enter opens configuration.{alternateDistance
      ? ` Tap or press Enter to switch to ${liveValueCatalog[alternateDistance].name}.`
      : lighting || field === 'themeToggle'
        ? ' Tap or press Enter to toggle.'
        : ''}</span
  >
  {#if lighting || alternateDistance || field === 'themeToggle'}
    <button
      type="button"
      class="sr-only focus:not-sr-only focus:bg-surface"
      aria-label={`Configure box ${slot + 1}: ${liveValueCatalog[field].name}`}
      onpointerdown={(event) => activateFromPointer(event, () => open(button))}
      onclick={(event) => activateFromKeyboardOrAssistiveClick(event, () => open(button))}>Configure</button
    >
  {/if}
</div>
{#if selectedSlot != null}
  <LiveValuePicker
    {preview}
    {previewInteractions}
    slot={selectedSlot}
    selected={field}
    {sample}
    {units}
    {estimatedLevel}
    {bms}
    {nowMs}
    {location}
    {busy}
    {error}
    onselect={select}
    onclose={close}
  />
{/if}

<style>
  @container live-gauge (max-height: 17rem) or (max-width: 18rem) {
    .live-value-button {
      height: 2.75rem;
    }
  }
</style>
