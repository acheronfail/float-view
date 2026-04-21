<script lang="ts">
  import { RowKey, type RowWithIndex } from '../lib/parse/types';

  interface OverlayItem {
    id: string;
    label: string;
    value: string;
    x: number;
    y: number;
  }

  interface Props {
    /** Video source URL (e.g. from URL.createObjectURL(file)) */
    videoUrl: string;
    /** All rows from the ride (must have time-ordered data) */
    rows: RowWithIndex[];
    /** Current row index in the full rows array (we sync from video time) */
    selectedRowIndex: number;
    /** Called when video time changes so parent can update selected index */
    setSelectedRowIndex: (index: number) => void;
    /** Time offset in seconds: rideTime = videoCurrentTime - timeOffset (video starts after ride start when > 0) */
    timeOffset?: number;
    /** Overlay items with position (x, y in 0–1) */
    overlayItems?: OverlayItem[];
    /** Background color for all overlay fields (CSS color) */
    overlayBackgroundColor?: string;
    /** Text color for all overlay fields (CSS color) */
    overlayTextColor?: string;
    /** Called when user drags a field to a new position */
    onPositionChange?: (id: string, x: number, y: number) => void;
  }

  let {
    videoUrl,
    rows,
    selectedRowIndex,
    setSelectedRowIndex,
    timeOffset = 0,
    overlayItems = [],
    overlayBackgroundColor = 'rgba(15, 23, 42, 0.85)',
    overlayTextColor = '#e2e8f0',
    onPositionChange,
  }: Props = $props();

  let videoEl = $state<HTMLVideoElement | null>(null);
  let overlayContainerEl = $state<HTMLDivElement | null>(null);
  let draggingId = $state<string | null>(null);
  let dragOffsetX = $state(0);
  let dragOffsetY = $state(0);
  let dragX = $state(0);
  let dragY = $state(0);

  /** Match the video's object-contain display area so (x,y) 0-1 match export coordinates */
  let displayRect = $state<{ left: number; top: number; width: number; height: number } | null>(null);

  function updateDisplayRect() {
    const v = videoEl;
    if (!v || v.videoWidth === 0 || v.videoHeight === 0) {
      displayRect = null;
      return;
    }
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    const ew = v.clientWidth;
    const eh = v.clientHeight;
    const scale = Math.min(ew / vw, eh / vh);
    const w = vw * scale;
    const h = vh * scale;
    const left = (ew - w) / 2;
    const top = (eh - h) / 2;
    displayRect = { left, top, width: w, height: h };
  }

  $effect(() => {
    const v = videoEl;
    if (!v) return;
    const onLoad = () => updateDisplayRect();
    v.addEventListener('loadedmetadata', onLoad);
    v.addEventListener('loadeddata', onLoad);
    v.addEventListener('resize', onLoad);
    const ro = new ResizeObserver(onLoad);
    ro.observe(v);
    updateDisplayRect();
    return () => {
      v.removeEventListener('loadedmetadata', onLoad);
      v.removeEventListener('loadeddata', onLoad);
      v.removeEventListener('resize', onLoad);
      ro.disconnect();
    };
  });

  function clamp01(n: number) {
    return Math.max(0.01, Math.min(0.99, n));
  }

  function startDrag(e: PointerEvent, item: OverlayItem) {
    if (!onPositionChange || !overlayContainerEl) return;
    const rect = overlayContainerEl.getBoundingClientRect();
    const boxX = item.x * rect.width;
    const boxY = item.y * rect.height;
    draggingId = item.id;
    dragOffsetX = e.clientX - rect.left - boxX;
    dragOffsetY = e.clientY - rect.top - boxY;
    dragX = item.x;
    dragY = item.y;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onDragMove(e: PointerEvent) {
    if (!draggingId || !overlayContainerEl) return;
    const rect = overlayContainerEl.getBoundingClientRect();
    dragX = clamp01((e.clientX - rect.left - dragOffsetX) / rect.width);
    dragY = clamp01((e.clientY - rect.top - dragOffsetY) / rect.height);
  }

  function endDrag(e: PointerEvent) {
    if (draggingId && onPositionChange) {
      onPositionChange(draggingId, dragX, dragY);
    }
    draggingId = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  /** Find row index whose time is closest to rideTime (seconds) */
  function rowIndexAtTime(rideTime: number): number {
    if (rows.length === 0) return 0;
    if (rideTime <= rows[0]![RowKey.Time]) return 0;
    if (rideTime >= rows[rows.length - 1]![RowKey.Time]) return rows.length - 1;
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      const t = rows[mid]![RowKey.Time];
      if (t <= rideTime) lo = mid;
      else hi = mid;
    }
    const tLo = rows[lo]![RowKey.Time];
    const tHi = rows[hi]![RowKey.Time];
    return rideTime - tLo <= tHi - rideTime ? lo : hi;
  }

  function onTimeUpdate() {
    const v = videoEl;
    if (!v || rows.length === 0) return;
    const rideTime = v.currentTime - timeOffset;
    if (rideTime < 0) {
      setSelectedRowIndex(0);
      return;
    }
    const idx = rowIndexAtTime(rideTime);
    if (idx !== selectedRowIndex) setSelectedRowIndex(idx);
  }

  function onSeeked() {
    onTimeUpdate();
  }

  $effect(() => {
    const v = videoEl;
    if (!v) return;
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('seeked', onSeeked);
    return () => {
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('seeked', onSeeked);
    };
  });
</script>

<div class="video-overlay-container relative w-full h-full bg-black overflow-hidden rounded-lg">
  <!-- svelte-ignore a11y_media_has_caption - user-provided ride video, no captions -->
  <video
    bind:this={videoEl}
    class="block w-full h-full object-contain"
    src={videoUrl}
    controls
    crossorigin="anonymous"
    playsinline
  ></video>
  {#if overlayItems.length > 0}
    <div
      bind:this={overlayContainerEl}
      class="video-overlay-hud absolute pointer-events-none"
      style={displayRect
        ? `left: ${displayRect.left}px; top: ${displayRect.top}px; width: ${displayRect.width}px; height: ${displayRect.height}px;`
        : 'inset: 0;'}
      aria-hidden="true"
    >
      {#each overlayItems as item}
        {@const isDragging = draggingId === item.id}
        {@const x = isDragging ? dragX : item.x}
        {@const y = isDragging ? dragY : item.y}
        <div
          class="absolute w-fit max-w-[85%] flex items-center gap-2 px-4 py-2 rounded-lg backdrop-blur border border-slate-600/50 cursor-grab active:cursor-grabbing select-none pointer-events-auto touch-none {isDragging
            ? 'ring-2 ring-cyan-400'
            : ''}"
          style="left: {x * 100}%; top: {y *
            100}%; transform: translate(0, 0); background: {overlayBackgroundColor}; color: {overlayTextColor};"
          role="button"
          tabindex="-1"
          onpointerdown={(e) => onPositionChange && startDrag(e, item)}
          onpointermove={onDragMove}
          onpointerup={endDrag}
          onpointercancel={endDrag}
          onpointerleave={(e) => e.buttons === 0 && endDrag(e)}
        >
          <span class="text-sm font-medium opacity-90">{item.label}</span>
          <span class="font-mono font-bold text-lg tabular-nums">{item.value}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>
