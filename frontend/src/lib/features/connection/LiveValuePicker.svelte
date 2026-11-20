<script lang="ts">
  import { backDismissal } from '$lib/ui/back-dismissal';
  import { createMotion } from '$lib/ui/motion';
  import { onMount } from 'svelte';
  import { backendState } from '$lib/backend/state.svelte';
  import { isLighting, lightingBox, exampleLightingBox } from './lighting';
  import ToggleIndicator from '$lib/ui/ToggleIndicator.svelte';
  import {
    liveWidgetFields,
    type BmsState,
    type LiveWidgetField,
    type LiveSample,
    type UnitPreference,
  } from '$lib/backend/contract';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import { liveValue, liveValueCatalog, liveValueColor, liveValueText, liveValueStatus } from './live-values';

  import type { PreviewInteractions } from './dashboard-preview';

  const motion = createMotion();

  let {
    preview = false,
    previewInteractions,
    slot,
    selected,
    sample,
    units,
    estimatedLevel,

    bms,
    nowMs,
    busy,
    error,
    onselect,
    onclose,
  }: {
    preview?: boolean;
    previewInteractions?: PreviewInteractions;
    slot: number;
    selected: LiveWidgetField;
    sample: LiveSample | null | undefined;
    units: UnitPreference;
    estimatedLevel?: number | null;

    bms?: BmsState | null;
    nowMs?: number;
    busy: boolean;
    error: string | null;
    onselect: (field: LiveWidgetField, keyboard: boolean) => void;
    onclose: (keyboard: boolean) => void;
  } = $props();
  let query = $state('');
  const fields = $derived(
    liveWidgetFields.filter((field) => {
      const { name, label } = liveValueCatalog[field];
      const text = `${name} ${label}`.toLowerCase();
      return query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .every((word) => text.includes(word));
    })
  );
  let dialog: HTMLDialogElement;
  onMount(() => {
    dialog.showModal();
  });
</script>

<dialog
  use:backDismissal={{
    close: () => {
      if (!busy) onclose(true);
    },
  }}
  use:motion.surface={'panel'}
  bind:this={dialog}
  aria-labelledby="live-value-picker-title"
  aria-describedby="live-value-picker-description"
  aria-busy={busy}
  class="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-canvas p-0 text-foreground backdrop:bg-canvas"
  oncancel={(event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!busy) onclose(true);
  }}
>
  <div class="app-safe-area app-safe-area-without-tabs flex h-full min-h-0 flex-col">
    <header class="flex shrink-0 items-center justify-between gap-3 border-b border-outline pb-3">
      <div>
        <h2 id="live-value-picker-title" class="text-xl font-bold">Choose a value</h2>
        <p id="live-value-picker-description" class="mt-1 text-sm text-muted">
          Box {slot + 1} · Tap a reading or control to use it.
          {#if preview}<span class="block">Preview · Example values</span>{/if}
        </p>
      </div>
      <button
        type="button"
        class="min-h-11 touch-manipulation rounded-lg border border-outline px-4"
        disabled={busy}
        onpointerdown={(event) => activateFromPointer(event, () => onclose(false))}
        onclick={(event) => activateFromKeyboardOrAssistiveClick(event, () => onclose(true))}>Cancel</button
      >
    </header>
    <label class="mt-4 block shrink-0 text-sm font-semibold"
      >Find a value or control
      <input
        type="search"
        maxlength="128"
        class="mt-2 min-h-11 w-full rounded-lg border border-outline bg-surface px-3"
        aria-label="Search values"
        placeholder="Search speed, battery, voltage…"
        disabled={busy}
        bind:value={query}
      />
    </label>
    {#if error}<p role="alert" class="mt-3 text-sm text-danger">{error}</p>{/if}
    {#if busy}<p role="status" class="mt-3 text-sm text-muted">Saving…</p>{/if}
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain py-4">
      {#if !fields.length}<p role="status" class="py-6 text-center text-muted">
          No matching values. Try another value or clear the search.
        </p>{/if}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {#each fields as field (field)}
          {@const reading = liveValue(
            field,
            sample,
            units,
            estimatedLevel,

            bms,
            Math.max(nowMs ?? 0, Date.now())
          )}
          {@const lighting = isLighting(field)
            ? preview && previewInteractions
              ? exampleLightingBox(previewInteractions.lighting[field])
              : lightingBox(preview ? null : backendState.snapshot?.activeConnection, field)
            : null}
          <button
            type="button"
            aria-label={reading.name}
            aria-pressed={selected === field}
            disabled={busy}
            class="flex min-h-28 min-w-0 touch-pan-y flex-col justify-between gap-2 rounded-xl border p-3 text-left focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
            class:border-accent={selected === field}
            class:bg-accent-soft={selected === field}
            class:border-outline={selected !== field}
            class:bg-surface={selected !== field}
            onpointerdown={(event) => activateFromPointer(event, () => onselect(field, false))}
            onclick={(event) => activateFromKeyboardOrAssistiveClick(event, () => onselect(field, true))}
          >
            <span class="text-sm font-medium">{reading.name}</span>
            {#if field === 'empty'}
              <span class="text-sm text-muted">Hold to set</span>
            {:else if field === 'themeToggle'}
              <span class="i-lucide-sun-moon text-xl text-muted" aria-hidden="true"></span>
              <span class="text-sm text-muted">Toggle appearance</span>
            {:else if lighting}
              {#if lighting.checked != null}<ToggleIndicator checked={lighting.checked} />{/if}
              <span class="text-sm text-muted">{lighting.status}</span>
            {:else}
              {#if field === 'highestTempC'}<span class="text-xs text-muted">{reading.label}</span>{/if}
              <span
                class={`font-mono text-xl font-semibold break-all tabular-nums ${liveValueColor(field, reading.value, sample, units)}`}
              >
                <span class="sr-only">{liveValueStatus(field, sample)} </span>{liveValueText(
                  field,
                  reading.value,
                  reading.digits
                )}<span class="ml-1 text-xs font-normal">{reading.unit}</span>
              </span>
            {/if}
            <span class="text-xs text-muted"
              >{selected === field
                ? '✓ Selected'
                : field === 'empty' || field === 'themeToggle' || lighting
                  ? '\u00a0'
                  : reading.value == null
                    ? 'Unavailable'
                    : '\u00a0'}</span
            >
          </button>
        {/each}
      </div>
    </div>
  </div>
</dialog>
