<script lang="ts">
  import type { RideFault } from '$lib/features/faults/faults';
  import type { SessionLocationPoint, SessionMetadata, SessionRideMarker } from '$lib/backend/contract';
  import type { Viewport } from './viewport';
  import SessionHistoryChart from './SessionHistoryChart.svelte';

  let {
    smoothCharts = true,
    following = false,
    oninspect = () => {},
    liveVersion = 0,
    markers = [],
    firmwareFaults = [],
    onfaultselect = () => {},
    selectedPoint = null,
    onmarkerselect = () => {},
    metadata,
    onselectionchange,
    onviewportchange,
    filterByMap = false,
    intervals = null,
    filterError = null,
    ondataerror,
    initialViewport = null,
    locationTrack = null,
  }: {
    smoothCharts?: boolean;
    following?: boolean;
    oninspect?: () => void;
    liveVersion?: number;
    markers?: SessionRideMarker[];
    firmwareFaults?: RideFault[];
    onfaultselect?: (elapsedMs: number) => void;
    selectedPoint?: { elapsedMs: number } | null;
    onmarkerselect?: (marker: SessionRideMarker) => void;
    metadata: SessionMetadata;
    onselectionchange?: (elapsedMs: number) => void;
    onviewportchange?: (viewport: Viewport) => void;
    filterByMap?: boolean;
    intervals?: Viewport[] | null;
    filterError?: string | null;
    ondataerror?: (reason: unknown) => void;
    initialViewport?: Viewport | null;
    locationTrack?: SessionLocationPoint[][] | null;
  } = $props();
</script>

<section aria-labelledby="history-heading">
  <SessionHistoryChart
    {smoothCharts}
    {following}
    {oninspect}
    {liveVersion}
    {markers}
    {firmwareFaults}
    {onfaultselect}
    {selectedPoint}
    {onmarkerselect}
    {metadata}
    {onselectionchange}
    {onviewportchange}
    {filterByMap}
    {intervals}
    {filterError}
    {ondataerror}
    {initialViewport}
    {locationTrack}
  />
</section>
