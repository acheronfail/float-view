<script lang="ts">
  import Button from './Button.svelte';
  import { formatTime } from '../lib/misc';
  import { globalState } from '../lib/global.svelte';
  import { Units, type RowWithIndex } from '../lib/parse/types';

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

  let startIndex = $derived(Math.min(trimStart, trimEnd));
  let endIndex = $derived(Math.max(trimStart, trimEnd));
  let startRow = $derived(rows[clampIndex(startIndex)]);
  let endRow = $derived(rows[clampIndex(endIndex)]);
  let distanceLabel = $derived(units === Units.Metric ? 'km' : 'mi');
  let formatDistance = (distance: number) => {
    const formatted = globalState.mapSpeed(distance);
    return Number.isNaN(formatted) ? '??' : formatted.toFixed(1);
  };

  function clampIndex(i: number) {
    return Math.max(0, Math.min(rowsLength - 1, i));
  }

  function reset() {
    trimStart = 0;
    trimEnd = rowsLength ? rowsLength - 1 : 0;
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
    const startDist = Math.abs(index - trimStart);
    const endDist = Math.abs(index - trimEnd);
    return startDist <= endDist ? 'start' : 'end';
  }

  function onSliderPointerDown(e: PointerEvent) {
    const idx = posToIndex(e.clientX);
    const nearestHandle = selectNearestHandle(idx);
    if (nearestHandle === 'start') {
      trimStart = idx;
    } else {
      trimEnd = idx;
    }
    dragging = nearestHandle;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerDownStart(e: PointerEvent) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = 'start';
    trimStart = posToIndex(e.clientX);
  }

  function onPointerDownEnd(e: PointerEvent) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = 'end';
    trimEnd = posToIndex(e.clientX);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const idx = posToIndex(e.clientX);
    if (dragging === 'start') {
      trimStart = idx;
    } else {
      trimEnd = idx;
    }
  }

  function onPointerUp() {
    dragging = null;
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
          <div class="font-mono text-[11px] uppercase tracking-widest text-slate-500">Start</div>
          <div class="mt-1 font-semibold">Log index: {startIndex + 1}</div>
          <div>Time: {formatTime(startRow?.time ?? 0)}</div>
          <div>Distance: {formatDistance(startRow?.distance ?? 0)} {distanceLabel}</div>
        </div>
        <div class="rounded border border-slate-700 p-2 bg-slate-950">
          <div class="font-mono text-[11px] uppercase tracking-widest text-slate-500">End</div>
          <div class="mt-1 font-semibold">Log index: {endIndex + 1}</div>
          <div>Time: {formatTime(endRow?.time ?? 0)}</div>
          <div>Distance: {formatDistance(endRow?.distance ?? 0)} {distanceLabel}</div>
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
            style="width: {(Math.min(trimStart, trimEnd) / Math.max(1, rowsLength - 1)) * 100}%"
          ></div>
          <!-- middle selected -->
          <div
            class="absolute top-0 bottom-0 bg-cyan-600"
            style="left: {(Math.min(trimStart, trimEnd) / Math.max(1, rowsLength - 1)) * 100}%; width: {((Math.max(
              trimStart,
              trimEnd,
            ) -
              Math.min(trimStart, trimEnd)) /
              Math.max(1, rowsLength - 1)) *
              100}%"
          ></div>
          <!-- right filler -->
          <div
            class="absolute right-0 top-0 bottom-0 bg-slate-600"
            style="width: {(1 - Math.max(trimStart, trimEnd) / Math.max(1, rowsLength - 1)) * 100}%"
          ></div>

          <!-- start handle -->
          <div
            role="slider"
            aria-label="Trim start"
            aria-valuemin="0"
            aria-valuemax={rowsLength - 1}
            aria-valuenow={startIndex}
            class="absolute top-0 bottom-0 w-4 -translate-x-1/2 bg-white/90 rounded-full shadow-lg cursor-grab"
            style="left: {(trimStart / Math.max(1, rowsLength - 1)) * 100}%"
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
            style="left: {(trimEnd / Math.max(1, rowsLength - 1)) * 100}%"
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
