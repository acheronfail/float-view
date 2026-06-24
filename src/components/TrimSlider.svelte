<script lang="ts">
  import Button from './Button.svelte';
  import { formatTime } from '../lib/misc';
  import { globalState } from '../lib/global.svelte';
  import { Units, type RowWithIndex } from '../lib/parse/types';
  import { getStateColor } from './Details';

  let {
    open = $bindable(false),
    trimStart = $bindable(),
    trimEnd = $bindable(),
    rowsLength,
    rows,
    units,
  }: {
    open: boolean;
    trimStart: number;
    trimEnd: number;
    rowsLength: number;
    rows: RowWithIndex[];
    units: Units;
  } = $props();

  let container = $state<HTMLDivElement | null>(null);
  let dragging = $state<'start' | 'end' | null>(null);

  // use draft values while the modal is open
  let draftStart = $state(0);
  let draftEnd = $state(0);

  $effect(() => {
    if (open) {
      draftStart = trimStart;
      draftEnd = trimEnd;
    }
  });

  let startIndex = $derived(Math.min(draftStart, draftEnd));
  let endIndex = $derived(Math.max(draftStart, draftEnd));
  let startRow = $derived(rows[clampIndex(startIndex)]);
  let endRow = $derived(rows[clampIndex(endIndex)]);
  let distanceLabel = $derived(units === Units.Metric ? 'km' : 'mi');
  let speedLabel = $derived(units === Units.Metric ? 'km/h' : 'mph');
  let formatDistance = (distance: number) => {
    const formatted = globalState.mapSpeed(distance);
    return Number.isNaN(formatted) ? '??' : formatted.toFixed(1);
  };
  let formatSpeed = (speed: number) => {
    const formatted = globalState.mapSpeed(speed);
    return Number.isNaN(formatted) ? '??' : formatted.toFixed(1);
  };
  let formatVoltage = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '??');

  function clampIndex(i: number) {
    return Math.max(0, Math.min(rowsLength - 1, i));
  }

  function reset() {
    draftStart = 0;
    draftEnd = rowsLength ? rowsLength - 1 : 0;
  }

  function close() {
    open = false;
  }

  function posToIndex(clientX: number) {
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const t = rect.width <= 0 ? 0 : x / rect.width;
    return clampIndex(Math.round(t * (rowsLength - 1)));
  }

  function selectNearestHandle(index: number) {
    const startDist = Math.abs(index - draftStart);
    const endDist = Math.abs(index - draftEnd);
    return startDist <= endDist ? 'start' : 'end';
  }

  function onSliderPointerDown(e: PointerEvent) {
    const idx = posToIndex(e.clientX);
    const nearestHandle = selectNearestHandle(idx);
    if (nearestHandle === 'start') {
      draftStart = idx;
    } else {
      draftEnd = idx;
    }
    dragging = nearestHandle;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerDownStart(e: PointerEvent) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = 'start';
    draftStart = posToIndex(e.clientX);
  }

  function onPointerDownEnd(e: PointerEvent) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = 'end';
    draftEnd = posToIndex(e.clientX);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const idx = posToIndex(e.clientX);
    if (dragging === 'start') {
      draftStart = idx;
    } else {
      draftEnd = idx;
    }
  }

  function onPointerUp() {
    dragging = null;

    // apply draft values and perform trim on pointer up... if this is too expensive
    // for mobile devices, we could do then when the trim modal closes instead.
    trimStart = draftStart;
    trimEnd = draftEnd;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      close();
    }
  }

  $effect(() => {
    if (!open) return;
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
</script>

{#if open}
  <div
    class="fixed inset-0 z-[11000] flex items-center justify-center"
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    role="dialog"
    aria-modal="true"
    aria-labelledby="trim-slider-title"
    tabindex="-1"
  >
    <div class="absolute inset-0 bg-black/40" onclick={close} role="presentation" aria-hidden="true"></div>
    <div
      bind:this={container}
      class="relative w-[min(95%,800px)] p-4 bg-slate-900 border rounded-lg z-10 flex flex-col gap-4"
    >
      <div class="flex items-center justify-between mb-2">
        <div id="trim-slider-title" class="font-bold">Trim ride</div>
        <div class="flex items-center gap-2">
          <Button onclick={reset}>reset</Button>
          <Button onclick={close}>done</Button>
        </div>
      </div>

      <div class="grid gap-2 text-xs text-slate-300 grid-cols-[repeat(2,minmax(0,1fr))]">
        <div class="rounded border border-slate-700 p-2 bg-slate-950">
          <div class="font-mono text-sm uppercase tracking-widest text-center">Start</div>
          <div class="flex items-center gap-2">
            <div class="w-20 text-right text-[11px] uppercase tracking-widest text-slate-500">Log index</div>
            <div class="font-semibold">{startIndex + 1}</div>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-20 text-right text-[11px] uppercase tracking-widest text-slate-500">Ride Time</div>
            <div class="font-semibold">{formatTime(startRow?.time ?? 0)}</div>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-20 text-right text-[11px] uppercase tracking-widest text-slate-500">Distance</div>
            <div class="font-semibold">{formatDistance(startRow?.distance ?? 0)} {distanceLabel}</div>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-20 text-right text-[11px] uppercase tracking-widest text-slate-500">Speed</div>
            <div class="font-semibold">{formatSpeed(startRow?.speed ?? NaN)} {speedLabel}</div>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-20 text-right text-[11px] uppercase tracking-widest text-slate-500">Voltage</div>
            <div class="font-semibold">{formatVoltage(startRow?.voltage ?? NaN)} V</div>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-20 text-right text-[11px] uppercase tracking-widest text-slate-500">State</div>
            <div class="font-semibold" style={startRow?.state ? `color: ${getStateColor(startRow.state)}` : ''}>
              {(startRow?.state ?? 'unknown').toUpperCase()}
            </div>
          </div>
        </div>
        <div class="rounded border border-slate-700 p-2 bg-slate-950">
          <div class="font-mono text-sm uppercase tracking-widest text-center">End</div>
          <div class="flex items-center gap-2">
            <div class="w-20 text-right text-[11px] uppercase tracking-widest text-slate-500">Log index</div>
            <div class="font-semibold">{endIndex + 1}</div>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-20 text-right text-[11px] uppercase tracking-widest text-slate-500">Ride Time</div>
            <div class="font-semibold">{formatTime(endRow?.time ?? 0)}</div>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-20 text-right text-[11px] uppercase tracking-widest text-slate-500">Distance</div>
            <div class="font-semibold">{formatDistance(endRow?.distance ?? 0)} {distanceLabel}</div>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-20 text-right text-[11px] uppercase tracking-widest text-slate-500">Speed</div>
            <div class="font-semibold">{formatSpeed(endRow?.speed ?? NaN)} {speedLabel}</div>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-20 text-right text-[11px] uppercase tracking-widest text-slate-500">Voltage</div>
            <div class="font-semibold">{formatVoltage(endRow?.voltage ?? NaN)} V</div>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-20 text-right text-[11px] uppercase tracking-widest text-slate-500">State</div>
            <div class="font-semibold" style={endRow?.state ? `color: ${getStateColor(endRow.state)}` : ''}>
              {(endRow?.state ?? 'unknown').toUpperCase()}
            </div>
          </div>
        </div>
      </div>

      <div class="select-none">
        <div
          class="relative h-8 bg-slate-700 rounded-lg overflow-hidden"
          role="presentation"
          onpointerdown={onSliderPointerDown}
        >
          <!-- left filler -->
          <div
            class="absolute left-0 top-0 bottom-0 bg-slate-600"
            style="width: {(Math.min(draftStart, draftEnd) / Math.max(1, rowsLength - 1)) * 100}%"
          ></div>
          <!-- middle selected -->
          <div
            class="absolute top-0 bottom-0 bg-cyan-600"
            style="left: {(Math.min(draftStart, draftEnd) / Math.max(1, rowsLength - 1)) * 100}%; width: {((Math.max(
              draftStart,
              draftEnd,
            ) -
              Math.min(draftStart, draftEnd)) /
              Math.max(1, rowsLength - 1)) *
              100}%"
          ></div>
          <!-- right filler -->
          <div
            class="absolute right-0 top-0 bottom-0 bg-slate-600"
            style="width: {(1 - Math.max(draftStart, draftEnd) / Math.max(1, rowsLength - 1)) * 100}%"
          ></div>

          <!-- start handle -->
          <div
            role="slider"
            aria-label="Trim start"
            aria-valuemin="0"
            aria-valuemax={rowsLength - 1}
            aria-valuenow={startIndex}
            class="absolute top-0 bottom-0 w-4 -translate-x-1/2 bg-white/90 rounded-full shadow-lg cursor-grab"
            style="left: {(draftStart / Math.max(1, rowsLength - 1)) * 100}%"
            onpointerdown={onPointerDownStart}
            tabindex="0"
          ></div>

          <!-- end handle -->
          <div
            role="slider"
            aria-label="Trim end"
            aria-valuemin="0"
            aria-valuemax={rowsLength - 1}
            aria-valuenow={endIndex}
            class="absolute top-0 bottom-0 w-4 -translate-x-1/2 bg-white/90 rounded-full shadow-lg cursor-grab"
            style="left: {(draftEnd / Math.max(1, rowsLength - 1)) * 100}%"
            onpointerdown={onPointerDownEnd}
            tabindex="0"
          ></div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .cursor-grab:active {
    cursor: grabbing;
  }
</style>
