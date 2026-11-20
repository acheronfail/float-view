<script lang="ts">
  import './widget-title.css';
  import WidgetThemeToggle from './WidgetThemeToggle.svelte';
  import WidgetRideMarker from './WidgetRideMarker.svelte';
  import type { DashboardWidget, UnitPreference } from '$lib/backend/contract';
  import { dashboardDomain, dashboardRangeValue, dashboardDimensions } from '$lib/backend/custom-dashboard';
  import { backendState } from '$lib/backend/state.svelte';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import LiveNumber from './LiveNumber.svelte';
  import LightingDisplay from './LightingDisplay.svelte';
  import WidgetGauge from './WidgetGauge.svelte';
  import WidgetPower from './WidgetPower.svelte';
  import WidgetTemperatures from './WidgetTemperatures.svelte';
  import WidgetFootpads from './WidgetFootpads.svelte';
  import LiveChartPlot from './LiveChartPlot.svelte';
  import { lightingBox, exampleLightingBox } from './lighting';
  import { liveValue, liveValueColor, liveValueText } from './live-values';
  import { widgetTitle, readingBarGeometry } from './custom-dashboard';
  import type { LiveHistory } from './live-history';
  import type { DashboardConnection, PreviewInteractions } from './dashboard-preview';

  let {
    widget,
    connection,
    history,
    units,
    nowMs,
    preview = false,
    previewInteractions,
  }: {
    widget: DashboardWidget;
    connection: DashboardConnection;
    history: LiveHistory;
    units: UnitPreference;
    nowMs: number;
    preview?: boolean;
    previewInteractions?: PreviewInteractions;
  } = $props();
  const compactChart = $derived(
    dashboardDimensions(widget.size).rows === 1 || dashboardDimensions(widget.size).columns === 1
  );
  const compact = $derived(dashboardDimensions(widget.size).rows === 1);
  const sample = $derived(connection.latestSample);
  const lighting = $derived(
    widget.kind === 'control'
      ? preview && previewInteractions
        ? exampleLightingBox(previewInteractions.lighting[widget.control])
        : lightingBox(connection, widget.control)
      : null
  );
  const reading = $derived(
    widget.kind === 'reading'
      ? liveValue(widget.field, sample, units, connection.batteryEstimate.level, connection.bms, nowMs)
      : null
  );
  const color = $derived(
    widget.kind === 'reading' ? liveValueColor(widget.field, reading?.value ?? null, sample, units) : ''
  );
  const range = $derived(
    widget.kind === 'reading' ? (widget.range ?? dashboardDomain(widget.field)?.initial) : undefined
  );
  const displayRange = $derived(
    widget.kind === 'reading' && range
      ? {
          min: dashboardRangeValue(widget.field, range.min, units),
          max: dashboardRangeValue(widget.field, range.max, units),
        }
      : null
  );
  const fraction = $derived(
    reading?.value != null && displayRange
      ? Math.max(0, Math.min(1, (reading.value - displayRange.min) / (displayRange.max - displayRange.min)))
      : 0
  );
  const bar = $derived(displayRange ? readingBarGeometry(reading?.value ?? null, displayRange) : null);
  const gaugeText = $derived(
    widget.kind === 'reading' ? liveValueText(widget.field, reading?.value ?? null, reading?.digits ?? 0) : ''
  );
  const gaugeFontSize = $derived(
    Math.min(34, 132 / Math.max(1, 0.62 * (gaugeText.length + (reading?.unit.length ?? 0) * 0.65)))
  );
  const outsideRange = $derived(
    reading?.value != null && displayRange && (reading.value < displayRange.min || reading.value > displayRange.max)
  );
  let toggling = $state(false);
  let error = $state(false);
  async function toggle() {
    if (widget.kind !== 'control' || !lighting || lighting.disabled || toggling) return;
    if (preview) {
      previewInteractions?.toggleLighting(widget.control);
      return;
    }
    if (backendState.busy) return;
    toggling = true;
    error = !(await backendState.setRefloatControl(widget.control, !lighting.checked));
    toggling = false;
  }
</script>

<div
  class={`custom-widget-content [container-type:size] flex h-full min-h-0 w-full min-w-0 flex-col justify-center text-center [container-name:custom-widget] ${color}`}
  style:--reading-font-cap={widget.kind === 'reading' && widget.presentation === 'bar'
    ? 'min(4rem, 25cqh)'
    : 'min(4rem, 45cqh)'}
  class:opacity-45={connection.state !== 'ready' && !(widget.kind === 'action' && widget.action === 'themeToggle')}
>
  {#if widget.kind === 'reading'}
    {#if widget.presentation === 'trend'}
      <div class="flex shrink-0 flex-col items-center text-xs leading-4">
        <h3 class="live-widget-title min-w-0" title={widgetTitle(widget)}>{reading?.label}</h3>
        <span class="chart-reading font-mono font-semibold" class:sr-only={compact}>{gaugeText} {reading?.unit}</span>
      </div>
      <div class="relative min-h-0 flex-1">
        {#if compact}<span
            class="absolute top-0 right-0 z-20 bg-surface/90 font-mono text-[10px] leading-3 font-semibold"
            >{gaugeText} {reading?.unit}</span
          >{/if}
        <LiveChartPlot
          {history}
          fields={[widget.field]}
          {units}
          title={widgetTitle(widget)}
          rawReadings
          dashboard
          sparkline={compact}
          inheritColor
          compact={compactChart}
          digits={reading?.digits ?? 0}
          height={compactChart ? 'calc(100% - 0.75rem)' : 'calc(100% - 1.25rem)'}
        />
      </div>
    {:else if widget.presentation === 'gauge' && displayRange}
      <svg
        viewBox="0 0 200 190"
        class="reading-gauge h-full min-h-0 w-full flex-1"
        role="img"
        aria-label={`${widgetTitle(widget)} gauge: ${reading?.value == null ? 'unavailable' : `${gaugeText} ${reading?.unit}`}${outsideRange ? ', outside display range' : ''}`}
      >
        <g>
          <path
            d="M43.43 156.57 A80 80 0 1 1 156.57 156.57"
            fill="none"
            stroke="var(--color-outline)"
            stroke-width="12"
            stroke-linecap="round"
          />
          <path
            d="M43.43 156.57 A80 80 0 1 1 156.57 156.57"
            fill="none"
            stroke="currentColor"
            stroke-width="12"
            stroke-linecap="round"
            pathLength="100"
            stroke-dasharray={`${fraction * 100} 100`}
          />
        </g>
        <g stroke="currentColor" opacity=".35" aria-hidden="true">
          {#each [0, 1, 2, 3, 4] as tick (tick)}
            {@const angle = ((135 + tick * 67.5) * Math.PI) / 180}
            <line
              x1={100 + 66 * Math.cos(angle)}
              y1={100 + 66 * Math.sin(angle)}
              x2={100 + 71 * Math.cos(angle)}
              y2={100 + 71 * Math.sin(angle)}
              stroke-width="1.5"
            />
          {/each}
        </g>
        <text
          x="100"
          y="77"
          text-anchor="middle"
          class="live-widget-title fill-current"
          style:font-size={`${Math.min(10, 132 / Math.max(1, (reading?.label.length ?? 1) * 0.62))}px`}
          >{reading?.label}</text
        >
        <text
          x="100"
          y="114"
          text-anchor="middle"
          class="fill-current font-mono font-semibold tabular-nums"
          style:font-size={`${gaugeFontSize}px`}
          >{gaugeText}<tspan class="font-normal" style:font-size={`${gaugeFontSize * 0.6}px`}>
            {reading?.unit}</tspan
          ></text
        >
        {#if reading?.value == null}<text x="100" y="134" text-anchor="middle" class="fill-current text-[10px]"
            >Unavailable</text
          >{/if}
        <text x="30" y="177" text-anchor="start" class="fill-current text-[10px]">{displayRange.min.toFixed(1)}</text>
        <text x="170" y="177" text-anchor="end" class="fill-current text-[10px]">{displayRange.max.toFixed(1)}</text>
        {#if outsideRange}<text x="100" y="189" text-anchor="middle" class="fill-current text-[8px]"
            >Outside display range</text
          >{/if}
      </svg>
    {:else}
      <LiveNumber
        field={widget.field}
        {sample}
        {units}
        {nowMs}
        bms={connection.bms}
        estimatedLevel={connection.batteryEstimate.level}
        prominent={!compact}
        inheritColor
        {compact}
      />
      {#if widget.presentation === 'bar' && displayRange}
        <div
          class={`reading-bar relative overflow-hidden rounded-full bg-canvas ${compact ? 'h-1 shrink-0' : 'mt-1 h-2 shrink-0'}`}
          role="img"
          aria-label={`${widgetTitle(widget)}: ${reading?.value ?? 'unavailable'} ${reading?.unit}`}
        >
          <div
            class="h-full bg-current"
            style:margin-left={`${(bar?.left ?? 0) * 100}%`}
            style:width={`${(bar?.width ?? 0) * 100}%`}
          ></div>
          {#if bar?.zero != null}<span
              class="absolute inset-y-0 w-px -translate-x-1/2 bg-foreground/60"
              style:left={`${bar.zero * 100}%`}
              aria-hidden="true"
              data-bar-zero
            ></span>{/if}
        </div>
      {/if}
      {#if displayRange && widget.presentation === 'bar' && !compact}
        <p
          class={`mt-1 flex shrink-0 flex-wrap justify-between gap-x-1 ${compact ? 'text-[8px]' : 'text-[9px] leading-[11px]'}`}
        >
          <span>{displayRange.min.toFixed(1)}</span><span>{displayRange.max.toFixed(1)} {reading?.unit}</span>
        </p>
        {#if reading?.value != null && (reading.value < displayRange.min || reading.value > displayRange.max)}<p
            class="text-xs text-warning"
          >
            Outside display range
          </p>{/if}
      {/if}
    {/if}
    {#if reading?.value == null && widget.presentation !== 'gauge'}<p
        class={compact || widget.presentation === 'trend'
          ? 'sr-only'
          : 'mt-0.5 text-[9px] leading-[11px] [overflow-wrap:anywhere] text-muted'}
      >
        Unavailable
      </p>{/if}
  {:else if widget.kind === 'action' && widget.action === 'themeToggle'}
    <WidgetThemeToggle preview={preview && !previewInteractions} />
  {:else if widget.kind === 'action'}
    <WidgetRideMarker sessionId={connection.activeSession?.sessionId ?? null} {preview} />
  {:else if widget.kind === 'control' && lighting}
    {#if preview && !previewInteractions}<LightingDisplay
        field={widget.control}
        {lighting}
        expanded={!compact}
      />{:else}
      <button
        type="button"
        role="switch"
        aria-checked={lighting.checked ?? false}
        aria-label={widgetTitle(widget)}
        aria-disabled={lighting.disabled || toggling || (!preview && backendState.busy)}
        aria-busy={lighting.pending || toggling}
        class={`min-h-11 w-full touch-pan-y rounded-lg ${compact ? 'p-0' : 'p-2'}`}
        onpointerdown={(e) => activateFromPointer(e, toggle)}
        onclick={(e) => activateFromKeyboardOrAssistiveClick(e, toggle)}
      >
        <LightingDisplay field={widget.control} {lighting} {toggling} expanded={!compact} />
      </button>
    {/if}
    {#if error}<p role="alert" class="text-xs text-warning">Could not change lights. Try again.</p>{/if}
  {:else if widget.kind === 'visual'}
    {#if widget.visual === 'speedGauge'}<WidgetGauge
        {sample}
        {units}
        liveBox={false}
        idPrefix={`custom-${widget.id}`}
      />
    {:else if widget.visual === 'battery'}<WidgetPower
        dashboard
        expanded={!compact}
        {sample}
        estimate={connection.batteryEstimate}
        warning={connection.state === 'ready' ? connection.batteryWarning : null}
        savedBoard
        idPrefix={`custom-${widget.id}`}
      />
    {:else if widget.visual === 'temperatures'}<WidgetTemperatures
        dashboard
        expanded={!compact}
        {sample}
        bms={connection.bms}
        {nowMs}
        idPrefix={`custom-${widget.id}`}
      />
    {:else}<WidgetFootpads {sample} compact expanded={!compact} />{/if}
  {/if}
</div>
