<script lang="ts">
  import { untrack } from 'svelte';
  import {
    liveWidgetFields,
    type DashboardWidget,
    type DashboardPresentation,
    type DashboardReading,
    type UnitPreference,
  } from '$lib/backend/contract';
  import {
    dashboardDomain,
    dashboardRangeValue,
    validCustomDashboard,
    dashboardDimensions,
  } from '$lib/backend/custom-dashboard';
  import FullScreenOverlay from '$lib/ui/FullScreenOverlay.svelte';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import CustomWidget from './CustomWidget.svelte';
  import { liveValueCatalog, liveValue } from './live-values';
  import { widgetPreviewSize, type DashboardGridGeometry } from './custom-dashboard';
  import type { LiveHistory } from './live-history';
  import type { DashboardConnection } from './dashboard-preview';

  let {
    widget,
    connection,
    history,
    units,
    nowMs,
    grid,
    adding = false,
    onapply,
    onclose,
  }: {
    widget: DashboardWidget;
    connection: DashboardConnection;
    history: LiveHistory;
    units: UnitPreference;
    nowMs: number;
    grid: DashboardGridGeometry;
    adding?: boolean;
    onapply: (widget: DashboardWidget) => void;
    onclose: () => void;
  } = $props();
  let working = $state<DashboardWidget>(structuredClone(untrack(() => $state.snapshot(widget))));
  const content = $derived(
    working.kind === 'reading'
      ? `reading:${working.field}`
      : working.kind === 'visual'
        ? `visual:${working.visual}`
        : working.kind === 'action'
          ? `action:${working.action}`
          : `control:${working.control}`
  );
  const domain = $derived(working.kind === 'reading' ? dashboardDomain(working.field) : null);
  const canRange = $derived(
    working.kind === 'reading' && (working.presentation === 'bar' || working.presentation === 'gauge')
  );
  const rangeUnit = $derived(working.kind === 'reading' ? liveValue(working.field, null, units).unit : '');
  let useRange = $state(untrack(() => working.kind === 'reading' && !!working.range));
  let min = $state('');
  let max = $state('');
  function resetRange() {
    if (working.kind !== 'reading') return;
    const range = working.range ?? dashboardDomain(working.field)?.initial;
    if (range) {
      min = String(dashboardRangeValue(working.field, range.min, units));
      max = String(dashboardRangeValue(working.field, range.max, units));
    }
  }
  untrack(resetRange);
  function chooseContent(value: string) {
    const [kind, selected] = value.split(':');
    const base = { id: working.id, size: working.size };
    if (kind === 'reading') working = { ...base, kind, field: selected as DashboardReading, presentation: 'number' };
    else if (kind === 'action') working = { ...base, kind, action: selected as 'rideMarker' | 'themeToggle' };
    else if (kind === 'control') working = { ...base, kind, control: selected as 'headlights' | 'leds' };
    else
      working = { ...base, kind: 'visual', visual: selected as 'battery' | 'speedGauge' | 'temperatures' | 'footpads' };
    if (adding && working.kind === 'visual' && working.visual === 'speedGauge') working.size = { columns: 3, rows: 3 };
    useRange = false;
    resetRange();
  }
  const candidate = $derived.by(() => {
    const value = { ...working };
    if (value.kind === 'reading') {
      delete value.range;
      if (canRange && useRange)
        value.range = {
          min: min.trim() ? dashboardRangeValue(value.field, Number(min), units, true) : NaN,
          max: max.trim() ? dashboardRangeValue(value.field, Number(max), units, true) : NaN,
        };
    }
    return value;
  });
  const dimensions = $derived(dashboardDimensions(working.size));
  const presentations = $derived(
    (
      [
        { value: 'number', label: 'Number' },
        { value: 'bar', label: 'Bar' },
        { value: 'gauge', label: 'Gauge' },
        { value: 'trend', label: 'Chart' },
      ] as const
    ).filter((option) => domain || option.value === 'number' || option.value === 'trend')
  );
  const hasLargePresets = $derived(
    (working.kind === 'reading' && (working.presentation === 'gauge' || working.presentation === 'trend')) ||
      (working.kind === 'visual' && working.visual === 'speedGauge')
  );
  const standardSizePresets = $derived([
    { columns: 1, rows: 1 },
    { columns: 2, rows: 1 },
    { columns: 4, rows: 1 },
    { columns: 1, rows: 2 },
    { columns: 2, rows: 2 },
    { columns: 4, rows: 2 },
    ...(hasLargePresets
      ? [
          { columns: 3, rows: 3 },
          { columns: 3, rows: 4 },
          { columns: 4, rows: 4 },
        ]
      : []),
  ]);
  const sizePresets = $derived(
    standardSizePresets.some((shape) => shape.columns === dimensions.columns && shape.rows === dimensions.rows)
      ? standardSizePresets
      : [...standardSizePresets, dimensions]
  );
  let suggestedGaugeSize = $state(false);
  function choosePresentation(presentation: DashboardPresentation) {
    if (working.kind !== 'reading') return;
    if (adding && presentation === 'gauge' && !suggestedGaugeSize) {
      working.size = { columns: 3, rows: 3 };
      suggestedGaugeSize = true;
    }
    working.presentation = presentation;
    resetRange();
  }
  const previewSize = $derived(widgetPreviewSize(working.size, grid));
  let previewAvailableWidth = $state<number | null>(null);
  const previewScale = $derived(Math.min(1, (previewAvailableWidth ?? previewSize.width) / previewSize.width));
  function measurePreview(node: HTMLElement) {
    const observer = new ResizeObserver(([entry]) => {
      previewAvailableWidth = entry.contentRect.width;
    });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
  const valid = $derived(validCustomDashboard({ version: 1, widgets: [candidate] }));
</script>

<FullScreenOverlay
  title={adding ? 'Add widget' : 'Configure widget'}
  titleId="widget-configuration-title"
  closeLabel="Cancel"
  {onclose}
>
  <div class="space-y-5 p-1">
    <label class="block text-sm font-semibold"
      >Content
      <select
        class="mt-2 min-h-11 w-full rounded-lg border border-outline bg-surface p-2"
        aria-label="Content"
        value={content}
        onchange={(e) => chooseContent(e.currentTarget.value)}
      >
        <optgroup label="Readings"
          >{#each liveWidgetFields.filter((f) => !['empty', 'headlights', 'leds'].includes(f)) as field (field)}<option
              value={`reading:${field}`}>{liveValueCatalog[field].name}</option
            >{/each}</optgroup
        >
        <optgroup label="Visualisations"
          ><option value="visual:speedGauge">Speed and load</option><option value="visual:battery">Battery</option
          ><option value="visual:temperatures">Temperatures</option><option value="visual:footpads">Footpads</option
          ></optgroup
        >
        <optgroup label="Controls"
          ><option value="control:headlights">Headlights</option><option value="control:leds">LEDs</option><option
            value="action:rideMarker">Save ride marker</option
          >
          <option value="action:themeToggle">Light / dark mode</option></optgroup
        >
      </select>
    </label>
    {#if working.kind === 'reading'}
      <fieldset aria-label="Display as">
        <legend class="mb-2 text-sm font-semibold">Display as</legend>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {#each presentations as option (option.value)}
            <button
              type="button"
              class="min-h-11 touch-pan-y rounded-lg border px-3 text-sm font-semibold"
              class:border-accent={working.presentation === option.value}
              class:bg-accent-soft={working.presentation === option.value}
              class:text-on-accent-soft={working.presentation === option.value}
              class:border-outline={working.presentation !== option.value}
              aria-pressed={working.presentation === option.value}
              onpointerdown={(e) => activateFromPointer(e, () => choosePresentation(option.value))}
              onclick={(e) => activateFromKeyboardOrAssistiveClick(e, () => choosePresentation(option.value))}
              >{option.label}</button
            >
          {/each}
        </div>
      </fieldset>
    {/if}
    <fieldset aria-label="Widget size">
      <legend class="mb-2 text-sm font-semibold">Size in cells</legend>
      <div class="grid grid-cols-3 gap-2">
        {#each sizePresets as shape (`${shape.columns}x${shape.rows}`)}
          <button
            type="button"
            class="flex min-h-11 touch-pan-y items-center justify-center gap-2 rounded-lg border p-2 text-xs"
            class:border-accent={dimensions.columns === shape.columns && dimensions.rows === shape.rows}
            class:bg-accent-soft={dimensions.columns === shape.columns && dimensions.rows === shape.rows}
            class:border-outline={dimensions.columns !== shape.columns || dimensions.rows !== shape.rows}
            aria-label={`${shape.columns} ${shape.columns === 1 ? 'column' : 'columns'} by ${shape.rows} ${shape.rows === 1 ? 'row' : 'rows'}`}
            aria-pressed={dimensions.columns === shape.columns && dimensions.rows === shape.rows}
            onpointerdown={(e) =>
              activateFromPointer(e, () => {
                working.size = { ...shape };
              })}
            onclick={(e) =>
              activateFromKeyboardOrAssistiveClick(e, () => {
                working.size = { ...shape };
              })}
          >
            <span class="grid grid-cols-4 gap-0.5" aria-hidden="true"
              >{#each Array.from({ length: 4 * Math.max(2, shape.rows) }, (_, i) => i) as cell (cell)}<span
                  class="size-1 rounded-[1px]"
                  class:bg-accent-fill={cell % 4 < shape.columns && Math.floor(cell / 4) < shape.rows}
                  class:bg-outline={cell % 4 >= shape.columns || Math.floor(cell / 4) >= shape.rows}
                ></span>{/each}</span
            >
            {shape.columns} × {shape.rows}
          </button>
        {/each}
      </div>
    </fieldset>
    {#if canRange && domain}
      {#if useRange}<p class="text-xs text-muted">
          Supported range: {working.kind === 'reading'
            ? dashboardRangeValue(working.field, domain.bounds.min, units).toFixed(1)
            : ''} to {working.kind === 'reading'
            ? dashboardRangeValue(working.field, domain.bounds.max, units).toFixed(1)
            : ''}
          {rangeUnit}.
        </p>{/if}
      <label class="flex min-h-11 items-center gap-3"
        ><input type="checkbox" bind:checked={useRange} /> Custom display range ({rangeUnit})</label
      >
      {#if useRange}<div class="grid grid-cols-2 gap-3">
          <label
            >Minimum<input
              class="mt-1 min-h-11 w-full rounded border border-outline bg-surface p-2"
              type="text"
              inputmode="decimal"
              bind:value={min}
            /></label
          >
          <label
            >Maximum<input
              class="mt-1 min-h-11 w-full rounded border border-outline bg-surface p-2"
              type="text"
              inputmode="decimal"
              bind:value={max}
            /></label
          >
        </div>{/if}
    {/if}
    {#if !valid}<p role="alert" class="text-sm text-warning">
        Enter a valid range with minimum below maximum, within the supported bounds.
      </p>{/if}
    <section aria-label="Size preview">
      <div class="rounded-xl border border-dashed border-outline bg-canvas p-3" use:measurePreview>
        <div
          class="pointer-events-none relative max-w-full overflow-hidden"
          style:width={`${previewSize.width * previewScale}px`}
          style:height={`${previewSize.height * previewScale}px`}
          inert
          aria-label="Widget preview"
        >
          <div
            class="absolute top-0 left-0 origin-top-left rounded-lg border border-outline bg-surface"
            style:width={`${previewSize.width}px`}
            style:height={`${previewSize.height}px`}
            style:transform={`scale(${previewScale})`}
            style:padding={dimensions.rows === 1 ? '0.375rem' : '0.75rem'}
          >
            <CustomWidget
              widget={{ ...(valid ? candidate : working), id: `preview-${working.id}` }}
              {connection}
              {history}
              {units}
              {nowMs}
              preview
            />
          </div>
        </div>
      </div>
    </section>
    <button
      type="button"
      class="min-h-11 w-full touch-manipulation rounded-lg bg-accent-fill px-4 font-semibold text-on-accent disabled:opacity-40"
      disabled={!valid}
      onpointerdown={(e) => activateFromPointer(e, () => onapply(candidate))}
      onclick={(e) => activateFromKeyboardOrAssistiveClick(e, () => onapply(candidate))}
      >{adding ? 'Add widget' : 'Save'}</button
    >
  </div>
</FullScreenOverlay>
