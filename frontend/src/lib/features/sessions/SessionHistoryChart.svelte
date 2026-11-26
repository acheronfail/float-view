<script lang="ts">
  import { faultLabel, type RideFault } from '$lib/features/faults/faults';
  import '$lib/ui/telemetry-chart.css';
  import { compactElapsed, compactViewport, originalViewport, recordingTimeline } from './recording-time';
  import { MapSeriesLoader } from './map-series';
  import { chartMarkerGroups } from './marker-groups';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import type { SessionMetadata, SessionRideMarker } from '$lib/backend/contract';
  import type { SessionReviewController } from '$lib/backend/session-controller';
  import type { SessionSeriesResult } from '$lib/backend/session-data';
  import { backendState } from '$lib/backend/state.svelte';
  import { reportFrontendPerformance } from '$lib/backend/performance-log';
  import { activateFromKeyboardOrAssistiveClick, activateFromPointer } from '$lib/ui/activation';
  import { axisTicks, zeroReference, type NumericDomain } from './history-geometry';
  import { historyTrend } from './history-trend';
  import { ENERGY_COUNTERS, loadSessionEnergy } from './session-energy';
  import { sessionSeriesGroups } from './session-series-groups';
  import { chartDomain, chartExtrema, chartShowsMinimum } from './chart-extrema';
  import { buildChartTooltipEntries, formatChartElapsedTime } from './chart-tooltip';
  import { chartTouchInspection } from './chart-touch-inspection';
  import {
    formatSessionFieldValue,
    sessionChartGroups,
    sessionFieldIsChartable,
    sessionFieldUnit,
    sortSessionFields,
    type SessionChartGroup,
  } from './session-fields';
  import { firstVisibleChartField, toggleChartField } from './chart-visibility';
  import { clampViewport, panViewport, pinchViewport, type Viewport } from './viewport';
  import SectionTitle from '../../ui/SectionTitle.svelte';
  import Spinner from '../../ui/Spinner.svelte';
  import Icon from '../../ui/Icon.svelte';

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
    onselectionchange = () => {},
    onviewportchange = () => {},
    filterByMap = false,
    intervals = null,
    filterError = null,
    ondataerror = () => {},
    initialViewport = null,
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
  } = $props();
  let plot = $state<HTMLElement | null>(null);
  let width = $state(0);
  let viewport = $state<Viewport>(
    initialViewport ?? { startElapsedMs: 0, endElapsedMs: metadata.summary.totalElapsedMs }
  );
  let previewViewport = $state<Viewport | null>(null);
  let result = $state<SessionSeriesResult | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let groupResults = new SvelteMap<number, SessionSeriesResult>();
  let groupLoading = new SvelteMap<number, boolean>();
  let groupErrors = new SvelteMap<number, string>();
  let hiddenFields = new SvelteSet<string>();
  // Keep the in-flight guard outside Svelte's reactive graph. The initial
  // loading effect must not rerun just because it updates the loading map.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const inFlightGroups = new Set<number>();
  let groupNodes = new SvelteMap<number, HTMLElement>();
  let groupObserver: IntersectionObserver | null = null;
  let resizeFrame: number | null = null;
  let reviewController: SessionReviewController | null = null;
  let mapLoader: MapSeriesLoader | null = null;
  let loadGeneration = 0;
  let lastRequestKey = '';
  let lastSnapshotKey = '';
  let retryVersion = $state(0);
  let outsideFilter = $state(false);
  const chartIntervals = $derived(filterByMap ? (intervals ?? []) : undefined);
  let activeField = $state('');
  let inspectionMs = $state(0);
  let exactStatus = $state<'idle' | 'exact'>('idle');
  let inspectionFrame: number | null = null;
  let queuedInspection: number | null = null;
  let touchDevice = $state(false);
  let mouseDevice = $state(false);
  let longTaskObserver: PerformanceObserver | null = null;
  let longTaskCount = 0;
  let longTaskTotalMs = 0;
  let longTaskMaxMs = 0;

  const CHART_WIDTH = 320;
  const CHART_HEIGHT = 96;
  const Y_TICK_COUNT = 5;
  const MIN_SELECTION_PIXELS = 8;
  const INTERACTION_MODES = ['info', 'zoom', 'pan'] as const;
  const MODE_ICONS = { info: 'info', zoom: 'zoom-in', pan: 'hand' } as const;

  type InteractionMode = (typeof INTERACTION_MODES)[number];
  let interactionMode = $state<InteractionMode>('info');

  const fields = $derived(sortSessionFields(metadata.fields.filter((field) => sessionFieldIsChartable(field.name))));
  const fieldGroups = $derived(sessionSeriesGroups(fields));
  const chartGroups = $derived(sessionChartGroups(fields));
  const visibleViewport = $derived(previewViewport ?? viewport);
  const axis = $derived(recordingTimeline(visibleViewport, metadata.recordingBreaks, chartIntervals));

  const duration = $derived(Math.max(1, metadata.summary.totalElapsedMs));
  const compactDuration = $derived(Math.max(1, compactElapsed(duration, metadata.recordingBreaks)));
  const inspectionBreak = $derived.by(() => {
    const ratio = axis.ratioAt(inspectionMs);
    return ratio === null
      ? null
      : (axis.recordingSeparators.find((gap) => Math.abs(gap.ratio - ratio) * width <= 5) ?? null);
  });
  const isZoomed = $derived(viewport.endElapsedMs - viewport.startElapsedMs < duration);
  let pointers = new SvelteMap<number, { x: number; y: number }>();
  let gestureStart: {
    viewport: Viewport;
    distance: number;
    ratio: number;
    pixelWidth: number;
    clientX: number;
  } | null = null;
  let gestureMode = $state<InteractionMode | null>(null);
  let gestureStartedAt: number | null = null;
  let gesturePreviewReported = false;
  let selectionStartElapsedMs = $state<number | null>(null);
  let selectionEndElapsedMs = $state<number | null>(null);
  let panEdge = $state<'start' | 'end' | null>(null);
  const selectionRange = $derived.by(() => {
    if (selectionStartElapsedMs === null || selectionEndElapsedMs === null) return null;
    const startX = (axis.ratioAt(selectionStartElapsedMs) ?? 0) * CHART_WIDTH;
    const endX = (axis.ratioAt(selectionEndElapsedMs) ?? 0) * CHART_WIDTH;
    return {
      startX,
      endX,
      leftX: Math.min(startX, endX),
      rightX: Math.max(startX, endX),
    };
  });
  let inspectionVisible = $derived(exactStatus !== 'idle');

  $effect(() => {
    if (!following) return;
    const endElapsedMs = metadata.summary.totalElapsedMs;
    untrack(() => {
      viewport = { startElapsedMs: 0, endElapsedMs };
    });
  });
  $effect(() => {
    if (!liveVersion) return;
    untrack(() => {
      reset();
      dismissInspection();
    });
  });

  $effect(() => {
    onviewportchange(viewport);
  });

  $effect(() => {
    const requestKey = JSON.stringify([
      filterByMap,
      intervals,
      filterError,
      viewport,
      width,
      retryVersion,
      metadata.snapshot,
      backendState.settings?.historyGapThresholdSeconds,
    ]);
    if (requestKey === lastRequestKey) return;
    lastRequestKey = requestKey;
    const snapshotKey = JSON.stringify(metadata.snapshot);
    const growingSnapshot = lastSnapshotKey !== '' && lastSnapshotKey !== snapshotKey && following && !filterByMap;
    lastSnapshotKey = snapshotKey;
    untrack(() => {
      loadGeneration++;
      mapLoader?.cancel();
      reviewController?.dispose();
      reviewController = null;
      mapLoader = null;
      inFlightGroups.clear();
      groupResults.clear();
      groupLoading.clear();
      groupErrors.clear();
      if (!growingSnapshot) result = null;
      loading = false;
      error = null;
      resetGesture();
      if (filterByMap) interactionMode = 'info';
      if (filterByMap && axis.indexAt(inspectionMs) < 0) {
        outsideFilter = selectedPoint?.elapsedMs === inspectionMs;
        dismissInspection();
      }
      if (!activeField && fields.length)
        activeField = fields.find((field) => !hiddenFields.has(field.name))?.name ?? '';
      if (!width || !fieldGroups.length || (filterByMap && (!intervals?.length || filterError))) return;
      void loadSeriesGroup(0, width);
      // Existing nodes stay mounted across refreshes; re-observe them so nearby
      // lazy groups are requested against the new snapshot too.
      groupNodes.forEach((node) => {
        groupObserver?.unobserve(node);
        groupObserver?.observe(node);
      });
    });
  });

  function chartGroupRequestIndex(chartGroup: SessionChartGroup): number {
    const index = fieldGroups.findIndex((group) =>
      chartGroup.fields.some((field) => group.some((candidate) => candidate.name === field.name))
    );
    return index < 0 ? 0 : index;
  }

  function chartGroupsForRequestGroup(index: number): SessionChartGroup[] {
    return chartGroups.filter((chartGroup) => chartGroupRequestIndex(chartGroup) === index);
  }

  function chartTooltipEntries(chartGroup: SessionChartGroup, domain: NumericDomain) {
    return buildChartTooltipEntries(chartGroup, result?.columns, hiddenFields, inspectionMs, domain, {
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
      viewport: visibleViewport,
      intervals: chartIntervals,
      recordingBreaks: metadata.recordingBreaks,
    });
  }

  const chartModels = $derived.by(() => {
    const models = new SvelteMap<
      string,
      {
        domain: NumericDomain | null;
        hasColumns: boolean;
        hasFiniteValues: boolean;
        yTicks: number[];
        yTickLabels: number[];
        zero: number | null;
        paths: Map<string, string[]>;
        bands: Map<string, string[]>;
      }
    >();

    chartGroups.forEach((chartGroup) => {
      const domain = chartDomain(chartGroup, result?.columns, hiddenFields, visibleViewport, chartIntervals);
      const paths = new SvelteMap<string, string[]>();
      const bands = new SvelteMap<string, string[]>();
      if (domain) {
        chartGroup.fields.forEach((field) => {
          const column = result?.columns[field.name];
          if (column) {
            const trend = historyTrend(
              column,
              {
                width: CHART_WIDTH,
                height: CHART_HEIGHT,
                viewport: visibleViewport,
                intervals: chartIntervals,
                recordingBreaks: metadata.recordingBreaks,
                domain,
              },
              width,
              smoothCharts
            );
            paths.set(field.name, trend.paths);
            bands.set(field.name, trend.bands);
          }
        });
      }
      const yTicks = axisTicks(domain, Y_TICK_COUNT);
      models.set(chartGroup.id, {
        domain,
        hasColumns: chartGroup.fields.some((field) => Boolean(result?.columns[field.name])),
        hasFiniteValues: chartGroup.fields.some((field) =>
          result?.columns[field.name]?.values.some((value) => value !== null && Number.isFinite(value))
        ),
        yTicks,
        yTickLabels: [...yTicks].reverse(),
        zero: zeroReference(domain),
        paths,
        bands,
      });
    });
    return models;
  });

  function isFieldVisible(fieldName: string): boolean {
    return !hiddenFields.has(fieldName);
  }

  function toggleField(fieldName: string): void {
    const willHide = !hiddenFields.has(fieldName);
    const nextHidden = toggleChartField(hiddenFields, fieldName);
    hiddenFields.clear();
    nextHidden.forEach((name) => hiddenFields.add(name));

    if (willHide && activeField === fieldName) {
      dismissInspection();
      const group = chartGroups.find((candidate) => candidate.fields.some((field) => field.name === fieldName));
      activeField = group ? (firstVisibleChartField(group.fields, hiddenFields) ?? '') : '';
    } else if (!willHide && !activeField) {
      activeField = fieldName;
    }
  }

  function rebuildResult() {
    const loaded = [...groupResults.values()];
    const first = loaded[0];
    if (!first) {
      result = null;
      return;
    }
    const columns = Object.assign({}, ...loaded.map((entry) => entry.columns));
    if (columns.dutyCycle)
      columns.dutyCycle = {
        ...columns.dutyCycle,
        values: columns.dutyCycle.values.map((value: number | null) =>
          value === null ? null : Math.min(Math.abs(value), 1)
        ),
      };
    result = {
      ...first,
      fields: loaded.flatMap((entry) => entry.fields),
      columns,
    };
  }

  async function loadSeriesGroup(index: number, buckets: number) {
    const group = fieldGroups[index];
    if (
      !group?.length ||
      inFlightGroups.has(index) ||
      groupResults.has(index) ||
      (filterByMap && (!intervals?.length || filterError))
    )
      return;
    const generation = loadGeneration;
    const started = globalThis.performance?.now() ?? Date.now();
    inFlightGroups.add(index);
    groupLoading.set(index, true);
    groupErrors.delete(index);
    loading = true;
    try {
      reviewController ??= backendState.createSessionReviewController(metadata);
      mapLoader ??= new MapSeriesLoader(reviewController);
      const groupResult = group.some((field) => ENERGY_COUNTERS.some((name) => name === field.name))
        ? await loadSessionEnergy(
            reviewController,
            metadata,
            chartIntervals ?? [viewport],
            buckets,
            backendState.settings?.historyGapThresholdSeconds ?? null
          )
        : filterByMap
          ? await mapLoader.load(
              group.map((field) => field.name),
              intervals!,
              buckets,
              backendState.settings?.historyGapThresholdSeconds ?? null
            )
          : await reviewController.loadSeries(
              group.map((field) => field.name),
              Math.max(0, Math.round(viewport.startElapsedMs)),
              Math.max(0, Math.round(viewport.endElapsedMs)),
              Math.max(1, Math.min(1_024, Math.round(buckets))),
              backendState.settings?.historyGapThresholdSeconds ?? null
            );
      if (generation !== loadGeneration) return;
      groupResults.set(index, groupResult);
      rebuildResult();
      const paintStarted = globalThis.performance?.now() ?? Date.now();
      requestAnimationFrame(() => {
        const groupNode = plot?.querySelector<HTMLElement>(`[data-history-group="${index}"]`);
        reportFrontendPerformance('session-history-group', {
          group: index,
          fields: group.length,
          buckets,
          responseAndStateMs: Math.round((paintStarted - started) * 100) / 100,
          firstPaintMs: Math.round(((globalThis.performance?.now() ?? Date.now()) - started) * 100) / 100,
          observations: Object.values(groupResult.columns).reduce((sum, column) => sum + column.values.length, 0),
          svgCount: groupNode?.querySelectorAll('svg').length ?? 0,
          svgPathSegments: groupNode?.querySelectorAll('path').length ?? 0,
          cacheEntries: reviewController?.cacheStats.entries ?? 0,
          cacheBytes: reviewController?.cacheStats.bytes ?? 0,
          longTaskCount,
          longTaskTotalMs: Math.round(longTaskTotalMs * 100) / 100,
          longTaskMaxMs: Math.round(longTaskMaxMs * 100) / 100,
        });
      });
    } catch (reason) {
      if (generation !== loadGeneration) return;
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        const message = reason instanceof Error ? reason.message : String(reason);
        groupErrors.set(index, message);
        error = message;
        ondataerror(reason);
      }
    } finally {
      if (generation === loadGeneration) {
        inFlightGroups.delete(index);
        groupLoading.delete(index);
        loading = [...groupLoading.values()].some(Boolean);
      }
    }
  }

  function observeGroup(node: HTMLElement, index: number) {
    groupNodes.set(index, node);
    groupObserver?.observe(node);
    return {
      destroy() {
        groupObserver?.unobserve(node);
        groupNodes.delete(index);
      },
    };
  }

  async function prefetchGroup(index: number) {
    if (index < 0 || index >= fieldGroups.length) return;
    await loadSeriesGroup(index, Math.max(1, Math.floor(width)));
    if (groupResults.has(index)) await loadSeriesGroup(index + 1, Math.max(1, Math.floor(width)));
  }

  $effect(() => {
    const marker = selectedPoint;
    if (!marker) return;
    untrack(() => {
      outsideFilter = filterByMap && axis.indexAt(marker.elapsedMs) < 0;
      if (outsideFilter) {
        dismissInspection();
        return;
      }
      if (!filterByMap && (marker.elapsedMs < viewport.startElapsedMs || marker.elapsedMs > viewport.endElapsedMs)) {
        const width = Math.max(1, viewport.endElapsedMs - viewport.startElapsedMs);
        viewport = clampViewport(
          { startElapsedMs: marker.elapsedMs - width / 2, endElapsedMs: marker.elapsedMs + width / 2 },
          duration
        );
      }
      inspectionMs = marker.elapsedMs;
      exactStatus = 'exact';
    });
  });

  function queueInspection(elapsedMs: number) {
    oninspect();
    if (!activeField || (filterByMap && axis.indexAt(elapsedMs) < 0)) return;
    outsideFilter = false;
    const target = Math.max(0, Math.min(duration, Math.round(elapsedMs)));
    queuedInspection = target;
    if (inspectionFrame !== null) return;
    if (typeof window === 'undefined') {
      commitInspection();
      return;
    }
    inspectionFrame = window.requestAnimationFrame(() => {
      inspectionFrame = null;
      commitInspection();
    });
  }

  function commitInspection() {
    if (queuedInspection === null) return;
    const target = queuedInspection;
    queuedInspection = null;
    if (target === inspectionMs && exactStatus === 'exact') return;
    inspectionMs = target;
    onselectionchange(target);
    exactStatus = 'exact';
  }

  function elapsedAtClientX(clientX: number, bounds: DOMRect): number {
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / Math.max(1, bounds.width)));
    return axis.elapsedAt(ratio) ?? 0;
  }

  function reset() {
    if (filterByMap) return;
    previewViewport = null;
    viewport = clampViewport({ startElapsedMs: 0, endElapsedMs: duration }, duration);
  }

  function isTouchPointer(event: PointerEvent): boolean {
    return event.pointerType === 'touch';
  }

  function resetGesture() {
    pointers.clear();
    selectionStartElapsedMs = null;
    selectionEndElapsedMs = null;
    previewViewport = null;
    gestureStart = null;
    gestureMode = null;
    gestureStartedAt = null;
    gesturePreviewReported = false;
    panEdge = null;
  }

  function reportGesturePreview() {
    if (gesturePreviewReported || gestureStartedAt === null) return;
    gesturePreviewReported = true;
    reportFrontendPerformance('session-history-gesture-preview', {
      mode: gestureMode ?? interactionMode,
      previewMs: Math.round(((globalThis.performance?.now() ?? Date.now()) - gestureStartedAt) * 100) / 100,
      svgPathSegments: plot?.querySelectorAll('path').length ?? 0,
    });
  }

  function nextInteractionMode(): InteractionMode {
    const index = INTERACTION_MODES.indexOf(interactionMode);
    return INTERACTION_MODES[(index + 1) % INTERACTION_MODES.length]!;
  }

  function cycleInteractionMode() {
    if (filterByMap) return;
    oninspect();
    interactionMode = nextInteractionMode();
    resetGesture();
    dismissInspection();
  }

  function preventChartContextMenu(event: MouseEvent) {
    if (mouseDevice) event.preventDefault();
  }

  function beginGesture(event: PointerEvent) {
    if (filterByMap) {
      if (!event.isPrimary || event.button !== 0) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      queueInspection(elapsedAtClientX(event.clientX, (event.currentTarget as SVGElement).getBoundingClientRect()));
      return;
    }
    const rightMousePan = mouseDevice && event.pointerType === 'mouse' && event.button === 2;
    if (event.pointerType === 'mouse' && event.button !== 0 && !rightMousePan) return;
    if (!pointers.size && !event.isPrimary) return;
    oninspect();
    if (rightMousePan) event.preventDefault();
    (event.currentTarget as SVGElement).setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const values = [...pointers.values()];
    const touchPointer = isTouchPointer(event);
    // Mouse hover already inspects; dragging selects a zoom range independently
    // of the touch-only mode switch.
    const mode = rightMousePan ? 'pan' : event.pointerType === 'mouse' ? 'zoom' : interactionMode;
    gestureMode = mode;
    gestureStartedAt ??= globalThis.performance?.now() ?? Date.now();
    panEdge = null;
    if (rightMousePan) dismissInspection();
    if (touchPointer && mode === 'info') {
      if (values.length === 1) {
        const bounds = (event.currentTarget as SVGElement).getBoundingClientRect();
        queueInspection(elapsedAtClientX(event.clientX, bounds));
      } else {
        pointers.delete(event.pointerId);
      }
      gestureStart = null;
      selectionStartElapsedMs = null;
      selectionEndElapsedMs = null;
      return;
    }
    if (touchPointer && mode === 'pan' && values.length > 1) {
      pointers.delete(event.pointerId);
      return;
    }
    if (values.length === 1) {
      const bounds = (event.currentTarget as SVGElement).getBoundingClientRect();
      const start = elapsedAtClientX(event.clientX, bounds);
      gestureStart = {
        viewport: visibleViewport,
        distance: 0,
        ratio: 0.5,
        pixelWidth: bounds.width,
        clientX: event.clientX,
      };
      if (mode === 'zoom') {
        selectionStartElapsedMs = start;
        selectionEndElapsedMs = start;
      } else {
        selectionStartElapsedMs = null;
        selectionEndElapsedMs = null;
      }
    } else if (values.length === 2) {
      const [first, second] = values;
      const distance = Math.hypot(second!.x - first!.x, second!.y - first!.y);
      const midpoint = (first!.x + second!.x) / 2;
      const bounds = (event.currentTarget as SVGElement).getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (midpoint - bounds.left) / Math.max(1, bounds.width)));
      gestureStart = {
        viewport: visibleViewport,
        distance,
        ratio,
        pixelWidth: bounds.width,
        clientX: midpoint,
      };
      selectionStartElapsedMs = null;
      selectionEndElapsedMs = null;
    }
  }

  function moveGesture(event: PointerEvent) {
    if (filterByMap) {
      if (event.isPrimary && (pointers.has(event.pointerId) || (event.pointerType === 'mouse' && event.buttons === 0)))
        queueInspection(elapsedAtClientX(event.clientX, (event.currentTarget as SVGElement).getBoundingClientRect()));
      return;
    }
    if (
      !pointers.has(event.pointerId) &&
      (event.pointerType === 'mouse' || event.pointerType === 'pen') &&
      event.buttons === 0
    ) {
      const bounds = (event.currentTarget as SVGElement).getBoundingClientRect();
      queueInspection(elapsedAtClientX(event.clientX, bounds));
      return;
    }
    if (!pointers.has(event.pointerId)) return;
    const mode = gestureMode ?? interactionMode;
    if (isTouchPointer(event) && mode === 'info') {
      const bounds = (event.currentTarget as SVGElement).getBoundingClientRect();
      queueInspection(elapsedAtClientX(event.clientX, bounds));
      return;
    }
    if (!gestureStart) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const values = [...pointers.values()];
    if (values.length >= 2 && (!isTouchPointer(event) || mode === 'zoom')) {
      const [first, second] = values;
      previewViewport = originalViewport(
        pinchViewport(
          compactViewport(gestureStart.viewport, metadata.recordingBreaks),
          Math.max(1, gestureStart.distance),
          Math.hypot(second!.x - first!.x, second!.y - first!.y),
          gestureStart.ratio,
          compactDuration
        ),
        metadata.recordingBreaks
      );
      selectionStartElapsedMs = null;
      selectionEndElapsedMs = null;
      reportGesturePreview();
      return;
    }
    if (mode === 'pan') {
      // Use the original scale throughout the drag; the preview viewport moves
      // with the pointer and must not feed back into the next delta.
      const requestedDelta =
        ((gestureStart.clientX - values[0]!.x) / Math.max(1, gestureStart.pixelWidth)) *
        (compactElapsed(gestureStart.viewport.endElapsedMs, metadata.recordingBreaks) -
          compactElapsed(gestureStart.viewport.startElapsedMs, metadata.recordingBreaks));
      previewViewport = originalViewport(
        panViewport(compactViewport(gestureStart.viewport, metadata.recordingBreaks), requestedDelta, compactDuration),
        metadata.recordingBreaks
      );
      panEdge =
        requestedDelta < 0 && previewViewport.startElapsedMs === 0
          ? 'start'
          : requestedDelta > 0 && previewViewport.endElapsedMs === duration
            ? 'end'
            : null;
      reportGesturePreview();
      return;
    }
    if (mode === 'zoom') {
      const bounds = (event.currentTarget as SVGElement).getBoundingClientRect();
      selectionEndElapsedMs = elapsedAtClientX(values[0]!.x, bounds);
      reportGesturePreview();
    }
  }

  function endGesture(event: PointerEvent) {
    if (filterByMap) {
      pointers.delete(event.pointerId);
      return;
    }
    const mode = gestureMode ?? interactionMode;
    pointers.delete(event.pointerId);
    if (!pointers.size) {
      if (previewViewport) {
        viewport = clampViewport(previewViewport, duration);
      } else if (mode === 'zoom' && selectionStartElapsedMs !== null && selectionEndElapsedMs !== null) {
        const start = Math.min(selectionStartElapsedMs, selectionEndElapsedMs);
        const end = Math.max(selectionStartElapsedMs, selectionEndElapsedMs);
        const minimumSpan = (axis.duration / Math.max(1, gestureStart?.pixelWidth ?? width)) * MIN_SELECTION_PIXELS;
        if (
          compactElapsed(end, metadata.recordingBreaks) - compactElapsed(start, metadata.recordingBreaks) >=
          minimumSpan
        ) {
          viewport = clampViewport({ startElapsedMs: start, endElapsedMs: end }, duration);
        } else if (!isTouchPointer(event)) {
          queueInspection(selectionEndElapsedMs);
        }
      }
      resetGesture();
    }
  }

  function cancelGesture(event: PointerEvent) {
    const mode = gestureMode ?? interactionMode;
    pointers.delete(event.pointerId);
    if (!pointers.size) {
      resetGesture();
      if (isTouchPointer(event) && mode === 'info') dismissInspection();
    }
  }

  function tooltipStyle(pointX: number): string {
    const ratio = Math.max(0, Math.min(1, pointX / CHART_WIDTH));
    // Keep the crosshair and its dots clear, even when the tooltip needs to wrap.
    const side = ratio <= 0.5 ? 'left' : 'right';
    const inset = `calc(${Math.min(ratio, 1 - ratio) * 100}% + 0.75rem)`;
    return `${side}: ${inset}; max-width: calc(100% - ${inset})`;
  }

  function elapsedLabel(elapsedMs: number): string {
    const seconds = Math.floor(elapsedMs / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function recordingBreakLabel(start: number, end: number): string {
    return `Recording break · ${elapsedLabel(end - start)} missing · ${elapsedLabel(start)}–${elapsedLabel(end)}`;
  }

  function formatTooltipValue(fieldName: string, value: number): string {
    return formatSessionFieldValue(fieldName, value);
  }

  function dismissInspection() {
    queuedInspection = null;
    if (inspectionFrame !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(inspectionFrame);
      inspectionFrame = null;
    }
    exactStatus = 'idle';
  }

  onMount(() => {
    if (!plot) return;
    const touchMedia = window.matchMedia('(hover: none) and (pointer: coarse)');
    const updateTouchDevice = () => {
      touchDevice = touchMedia.matches || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    };
    const mouseMedia = window.matchMedia('(hover: hover) and (pointer: fine)');
    const updateMouseDevice = () => {
      mouseDevice = mouseMedia.matches;
    };
    updateTouchDevice();
    updateMouseDevice();
    touchMedia.addEventListener('change', updateTouchDevice);
    mouseMedia.addEventListener('change', updateMouseDevice);
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      longTaskObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (longTaskCount >= 64) return;
          longTaskCount += 1;
          longTaskTotalMs += entry.duration;
          longTaskMaxMs = Math.max(longTaskMaxMs, entry.duration);
          reportFrontendPerformance('session-history-longtask', {
            durationMs: Math.round(entry.duration * 100) / 100,
            count: longTaskCount,
          });
        });
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    }
    const observer = new ResizeObserver((entries) => {
      const next = Math.max(0, Math.floor(entries[0]?.contentRect.width ?? 0));
      if (next <= 0 || next === width) return;
      if (resizeFrame !== null && typeof window !== 'undefined') window.cancelAnimationFrame(resizeFrame);
      const commit = () => {
        resizeFrame = null;
        width = next;
      };
      resizeFrame = typeof window === 'undefined' ? null : window.requestAnimationFrame(commit);
      if (resizeFrame === null) commit();
    });
    observer.observe(plot);
    groupObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const index = Number((entry.target as HTMLElement).dataset.historyGroup);
          if (Number.isInteger(index)) prefetchGroup(index);
        });
      },
      // `plot` grows with the chart groups and is not a scroll container. If
      // used as the root, every group is intersecting as soon as the page is
      // rendered and the whole session is fetched immediately. The viewport
      // root keeps the first group eager while limiting prefetch to nearby
      // groups.
      { rootMargin: '160px' }
    );
    groupNodes.forEach((node) => groupObserver?.observe(node));
    return () => {
      touchMedia.removeEventListener('change', updateTouchDevice);
      mouseMedia.removeEventListener('change', updateMouseDevice);
      observer.disconnect();
      longTaskObserver?.disconnect();
      longTaskObserver = null;
      groupObserver?.disconnect();
      groupObserver = null;
    };
  });

  onDestroy(() => {
    if (inspectionFrame !== null && typeof window !== 'undefined') window.cancelAnimationFrame(inspectionFrame);
    if (resizeFrame !== null && typeof window !== 'undefined') window.cancelAnimationFrame(resizeFrame);
    longTaskObserver?.disconnect();
    groupObserver?.disconnect();
    loadGeneration++;
    mapLoader?.cancel();
    reviewController?.dispose();
  });
</script>

<div bind:this={plot} class="mt-3">
  {#if axis.recordingSeparators.length}
    <p class="text-xs text-muted">Dashed bars mark deliberate pauses.</p>
  {/if}
  {#if filterByMap}
    <p class="text-xs text-muted">
      Map controls the chart range. GPS gaps use the last known location. Chart zoom and pan are disabled.
    </p>
    {#if filterError}<p role="alert" class="text-warning">{filterError}</p>
    {:else if intervals === null}<p role="status">Loading complete track…</p>
    {:else if !intervals.length}<p role="status">
        No ride segments in this map area. Use re-center to show the full route.
      </p>{/if}
    {#if outsideFilter}<p role="status" class="text-xs text-muted">Selected point is outside the map filter.</p>{/if}
  {/if}
  {#if loading}
    <p class="mt-2 flex flex-row items-center gap-2 text-lg text-muted" role="status">
      <Spinner />
      Loading chart data…
    </p>
  {/if}

  {#if error}<p class="mt-2 text-sm text-warning" role="alert">{error}</p>
    <button
      type="button"
      class="touch-manipulation text-accent"
      onpointerdown={(event) =>
        activateFromPointer(event, () => {
          retryVersion++;
        })}
      onclick={(event) =>
        activateFromKeyboardOrAssistiveClick(event, () => {
          retryVersion++;
        })}>Retry chart data</button
    >{/if}

  <!-- Keep chart frames mounted while range queries replace their data. Removing
       them clamps the page scroll and interrupts captured touch gestures. -->
  {#if fields.length}
    <div class="mt-3 space-y-3">
      {#each fieldGroups as group, groupIndex (groupIndex)}
        <div
          use:observeGroup={groupIndex}
          data-history-group={groupIndex}
          data-history-field-count={group.length}
          class="space-y-3"
        >
          {#if groupLoading.get(groupIndex) && !groupResults.has(groupIndex)}
            <p class="text-xs text-muted" role="status">Loading group {groupIndex + 1}…</p>
          {/if}

          {#if groupErrors.get(groupIndex)}
            <p class="text-xs text-warning" role="alert">{groupErrors.get(groupIndex)}</p>
          {/if}

          {#each chartGroupsForRequestGroup(groupIndex) as chartGroup (chartGroup.id)}
            {@const chartModel = chartModels.get(chartGroup.id)}
            {@const domain = chartModel?.domain ?? { min: 0, max: 1 }}
            {@const hasColumns = chartModel?.hasColumns ?? false}
            {@const hasFiniteValues = chartModel?.hasFiniteValues ?? false}
            {@const allHidden = chartGroup.fields.every((field) => hiddenFields.has(field.name))}
            {@const yTicks = chartModel?.yTicks ?? []}
            {@const yTickLabels = chartModel?.yTickLabels ?? []}
            {@const zero = chartModel?.zero ?? null}
            {@const tooltipEntries = inspectionVisible && domain ? chartTooltipEntries(chartGroup, domain) : []}
            {@const tooltipX =
              tooltipEntries[0]?.point.x ?? (inspectionBreak ? inspectionBreak.ratio * CHART_WIDTH : null)}
            {@const extrema = chartExtrema(chartGroup, result?.columns, hiddenFields, visibleViewport, chartIntervals)}
            <div class="nonselectable-surface">
              <SectionTitle title={chartGroup.title} detail={chartGroup.unit ?? 'value'} />
              {#if chartGroup.id === 'energy'}
                <p class="mt-1 text-xs text-muted">
                  Since the first available session readings. Net consumed is consumed minus recovered energy. Totals
                  stop if a counter resets.
                </p>
              {/if}

              {#if domain}
                <div class="telemetry-chart-frame mt-2 flex items-stretch gap-2">
                  <div
                    class="flex h-full shrink-0 flex-col justify-between text-right text-[10px] leading-none text-muted"
                    aria-hidden="true"
                  >
                    {#each yTickLabels as tick (tick)}
                      <span>{formatSessionFieldValue(chartGroup.fields[0]!.name, tick)}</span>
                    {/each}
                  </div>
                  <div class="relative isolate min-w-0 flex-1">
                    {#each chartMarkerGroups(markers, visibleViewport, width, chartIntervals, metadata.recordingBreaks) as group (group.marker.sequence)}
                      {@const marker = group.marker}
                      <button
                        type="button"
                        aria-label={`Select marker at ${(marker.elapsedMs / 1000).toFixed(1)} seconds`}
                        title={`Marker · ${(marker.elapsedMs / 1000).toFixed(1)}s`}
                        class="absolute top-0 z-20 h-full w-3 -translate-x-1/2 touch-manipulation border-x border-transparent focus-visible:outline-2 focus-visible:outline-warning"
                        style:left={`${group.percent}%`}
                        onpointerdown={(event) => activateFromPointer(event, () => onmarkerselect(marker))}
                        onclick={(event) => activateFromKeyboardOrAssistiveClick(event, () => onmarkerselect(marker))}
                      >
                        {#if group.count > 1}<span
                            class="absolute top-0 left-1/2 -translate-x-1/2 rounded bg-orange-500 px-1 text-[10px] text-black"
                            >{group.count}</span
                          >{/if}
                        <span class="mx-auto block h-full w-0.5 bg-orange-500 shadow-[0_0_0_1px_#0008]"></span>
                      </button>
                    {/each}
                    {#each chartMarkerGroups( firmwareFaults.flatMap( (fault) => (fault.elapsedMs === null ? [] : [{ ...fault, elapsedMs: fault.elapsedMs }]) ), visibleViewport, width, chartIntervals, metadata.recordingBreaks ) as group (group.marker.sequence)}
                      {@const fault = group.marker}
                      <button
                        type="button"
                        aria-label={`Inspect fault: ${faultLabel(fault.reason, fault.code)}`}
                        title={`${faultLabel(fault.reason, fault.code)}${group.count > 1 ? ` · ${group.count} faults` : ''}`}
                        class="absolute top-0 z-30 h-full w-5 -translate-x-1/2 touch-manipulation focus-visible:outline-2 focus-visible:outline-danger"
                        style:left={`${group.percent}%`}
                        onpointerdown={(event) => activateFromPointer(event, () => onfaultselect(fault.elapsedMs))}
                        onclick={(event) =>
                          activateFromKeyboardOrAssistiveClick(event, () => onfaultselect(fault.elapsedMs))}
                      >
                        <span
                          class="absolute top-0 left-1/2 -translate-x-1/2 rounded bg-danger px-1 text-[10px] font-bold text-canvas"
                          >{group.count > 1 ? group.count : '!'}</span
                        >
                        <span class="mx-auto block h-full w-0.5 bg-danger"></span>
                      </button>
                    {/each}
                    <svg
                      use:chartTouchInspection={filterByMap || interactionMode === 'info'}
                      class="block h-full w-full touch-pan-y rounded bg-canvas"
                      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                      preserveAspectRatio="none"
                      role="img"
                      aria-label={`${chartGroup.title} over elapsed time`}
                      onpointerdown={(event) => {
                        beginGesture(event);
                      }}
                      onpointermove={moveGesture}
                      onpointerup={endGesture}
                      onpointercancel={cancelGesture}
                      oncontextmenu={preventChartContextMenu}
                      onpointerleave={() => {
                        dismissInspection();
                      }}
                    >
                      {#if axis.recordingSeparators.length}
                        <desc
                          >{axis.recordingSeparators
                            .map((gap) => recordingBreakLabel(gap.start, gap.end))
                            .join('; ')}</desc
                        >
                      {/if}
                      {#each yTicks as tick (tick)}
                        {@const y =
                          CHART_HEIGHT -
                          ((tick - domain.min) / Math.max(Number.EPSILON, domain.max - domain.min)) *
                            (CHART_HEIGHT - 4) -
                          2}
                        <line
                          x1="0"
                          x2={CHART_WIDTH}
                          y1={y}
                          y2={y}
                          stroke="var(--app-muted)"
                          stroke-opacity="0.35"
                          stroke-dasharray="2 2"
                          vector-effect="non-scaling-stroke"
                        />
                      {/each}
                      {#if zero !== null}
                        <line
                          x1="0"
                          x2={CHART_WIDTH}
                          y1={CHART_HEIGHT - zero * (CHART_HEIGHT - 4) - 2}
                          y2={CHART_HEIGHT - zero * (CHART_HEIGHT - 4) - 2}
                          stroke="var(--app-muted)"
                          stroke-opacity="0.35"
                          stroke-dasharray="2 2"
                          vector-effect="non-scaling-stroke"
                        />
                      {/if}
                      {#each chartGroup.fields as field (field.name)}
                        {#if isFieldVisible(field.name)}
                          {#each chartModel?.bands.get(field.name) ?? [] as band (band)}
                            <path
                              data-history-band
                              d={band}
                              fill={field.color}
                              fill-opacity={inspectionVisible ? 0.2 : 0.1}
                            />
                          {/each}
                        {/if}
                      {/each}
                      {#each chartGroup.fields as field (field.name)}
                        {@const column = result?.columns[field.name]}
                        {@const paths = chartModel?.paths.get(field.name) ?? []}
                        {#if column && isFieldVisible(field.name)}
                          {#each paths as segment (segment)}
                            <path
                              class="telemetry-chart-trace"
                              d={segment}
                              fill="none"
                              stroke={field.color}
                              stroke-linecap="round"
                              vector-effect="non-scaling-stroke"
                            />
                          {/each}
                        {/if}
                      {/each}
                      {#if filterByMap}
                        {#each axis.separators as ratio (ratio)}
                          <line
                            data-map-separator
                            x1={ratio * CHART_WIDTH}
                            x2={ratio * CHART_WIDTH}
                            y1="0"
                            y2={CHART_HEIGHT}
                            stroke="var(--app-canvas)"
                            stroke-width="4"
                            vector-effect="non-scaling-stroke"
                          />
                          <line
                            x1={ratio * CHART_WIDTH}
                            x2={ratio * CHART_WIDTH}
                            y1="0"
                            y2={CHART_HEIGHT}
                            stroke="var(--app-muted)"
                            stroke-dasharray="4 3"
                            vector-effect="non-scaling-stroke"
                          />
                        {/each}
                      {/if}
                      {#each axis.recordingSeparators as gap (gap.end)}
                        <g data-recording-break data-start-elapsed-ms={gap.start} data-end-elapsed-ms={gap.end}>
                          <title>{recordingBreakLabel(gap.start, gap.end)}</title>
                          <line
                            x1={gap.ratio * CHART_WIDTH}
                            x2={gap.ratio * CHART_WIDTH}
                            y1="0"
                            y2={CHART_HEIGHT}
                            stroke="var(--app-canvas)"
                            stroke-width="5"
                            vector-effect="non-scaling-stroke"
                          />
                          <line
                            x1={gap.ratio * CHART_WIDTH}
                            x2={gap.ratio * CHART_WIDTH}
                            y1="0"
                            y2={CHART_HEIGHT}
                            stroke="var(--app-muted)"
                            stroke-width="1.5"
                            stroke-dasharray="4 3"
                            vector-effect="non-scaling-stroke"
                          />
                        </g>
                      {/each}
                      {#if selectionRange}
                        <rect
                          x="0"
                          y="0"
                          width={selectionRange.leftX}
                          height={CHART_HEIGHT}
                          fill="var(--app-surface)"
                          fill-opacity="0.82"
                        />
                        <rect
                          x={selectionRange.rightX}
                          y="0"
                          width={CHART_WIDTH - selectionRange.rightX}
                          height={CHART_HEIGHT}
                          fill="var(--app-surface)"
                          fill-opacity="0.82"
                        />
                        <line
                          x1={selectionRange.startX}
                          x2={selectionRange.startX}
                          y1="0"
                          y2={CHART_HEIGHT}
                          stroke="var(--app-accent)"
                          stroke-width="1.5"
                        />
                        <line
                          x1={selectionRange.endX}
                          x2={selectionRange.endX}
                          y1="0"
                          y2={CHART_HEIGHT}
                          stroke="var(--app-accent)"
                          stroke-width="1.5"
                        />
                      {/if}
                    </svg>
                    <!-- Move the whole overlay with a compositor transform. Updating left
                         can leave partially repainted cursors in WebKit across data gaps.
                         Clip the full-width layer so it cannot widen the scroll area. -->
                    {#if inspectionVisible}
                      <span aria-hidden="true" class="pointer-events-none absolute inset-0 overflow-hidden">
                        <span
                          data-history-inspection
                          class="absolute inset-0 border-l border-dashed border-accent will-change-transform"
                          style:transform={`translate3d(min(${(axis.ratioAt(inspectionMs) ?? 0) * 100}%, calc(100% - 1px)), 0, 0)`}
                        ></span>
                      </span>
                    {/if}
                    <!-- Keep dots in CSS pixels: the plot SVG stretches each axis independently. -->
                    {#each tooltipEntries as entry (entry.field.name)}
                      {#if inspectionVisible}
                        <span
                          data-history-point
                          aria-hidden="true"
                          class="pointer-events-none absolute size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-canvas"
                          style={`left: ${(entry.point.x / CHART_WIDTH) * 100}%; top: ${(entry.point.y / CHART_HEIGHT) * 100}%; background: ${entry.field.color}`}
                        ></span>
                      {/if}
                    {/each}
                    {#if panEdge === 'start'}
                      <div
                        class="pointer-events-none absolute inset-y-0 left-0 z-20 w-1.5 rounded-l bg-warning shadow-[0_0_0.5rem_var(--app-warning)]"
                        aria-hidden="true"
                      ></div>
                    {:else if panEdge === 'end'}
                      <div
                        class="pointer-events-none absolute inset-y-0 right-0 z-20 w-1.5 rounded-r bg-warning shadow-[0_0_0.5rem_var(--app-warning)]"
                        aria-hidden="true"
                      ></div>
                    {/if}
                    {#if inspectionVisible && tooltipX !== null}
                      <div
                        class="pointer-events-none absolute top-1 z-30 w-max rounded border border-outline bg-surface px-2 py-1 font-mono text-[10px] leading-tight wrap-anywhere shadow"
                        style={tooltipStyle(tooltipX)}
                        role="status"
                      >
                        <p>{formatChartElapsedTime(inspectionMs)} into ride</p>
                        {#if inspectionBreak}<p>
                            {recordingBreakLabel(inspectionBreak.start, inspectionBreak.end)}
                          </p>{/if}
                        <div class="space-y-0.5">
                          {#each tooltipEntries as entry (entry.field.name)}
                            <div class="flex flex-wrap gap-x-2">
                              <span class="min-w-0 text-left" style={`color: ${entry.field.color}`}>
                                {entry.field.displayName}:
                              </span>
                              <span class="ml-auto min-w-0 text-right" style={`color: ${entry.field.color}`}>
                                {formatTooltipValue(entry.field.name, entry.point.value)}
                                {#if sessionFieldUnit(entry.field.name) && entry.field.format !== 'percent'}
                                  {sessionFieldUnit(entry.field.name)}
                                {/if}
                              </span>
                            </div>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                </div>
                <p class="mt-1 min-h-4 text-xs text-muted">
                  {#if allHidden}All lines hidden.
                  {:else if !hasColumns}Loading readings…
                  {:else if !hasFiniteValues}No readings in this range.
                  {/if}
                </p>
              {:else if hasColumns}<p class="mt-1 text-xs text-muted">No readings in this range.</p>
              {:else}<p class="mt-1 text-xs text-muted">Loading readings…</p>{/if}

              <div class="mt-1 flex justify-end gap-4 text-xs text-muted" aria-label={`${chartGroup.title} range`}>
                {#if chartShowsMinimum(chartGroup)}
                  <span
                    >Min <strong class="font-mono font-medium text-foreground"
                      >{extrema
                        ? formatTooltipValue(chartGroup.fields[0]!.name, extrema.min)
                        : '—'}{#if extrema && chartGroup.unit && chartGroup.fields[0]!.format !== 'percent'}
                        {` ${chartGroup.unit}`}{/if}</strong
                    ></span
                  >
                {/if}
                <span
                  >Max <strong class="font-mono font-medium text-foreground"
                    >{extrema
                      ? formatTooltipValue(chartGroup.fields[0]!.name, extrema.max)
                      : '—'}{#if extrema && chartGroup.unit && chartGroup.fields[0]!.format !== 'percent'}
                      {` ${chartGroup.unit}`}{/if}</strong
                  ></span
                >
              </div>

              {#if chartGroup.fields.length > 1}
                <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1" role="group" aria-label={`${chartGroup.title} series`}>
                  {#each chartGroup.fields as field (field.name)}
                    {@const visible = isFieldVisible(field.name)}
                    <button
                      type="button"
                      class={`flex touch-manipulation items-center gap-1.5 rounded px-1 py-0.5 text-xs ${
                        visible ? 'text-foreground' : 'text-muted line-through'
                      }`}
                      aria-pressed={visible}
                      aria-label={`${visible ? 'Hide' : 'Show'} ${field.displayName} line`}
                      onpointerdown={(event) => activateFromPointer(event, () => toggleField(field.name))}
                      onclick={(event) => activateFromKeyboardOrAssistiveClick(event, () => toggleField(field.name))}
                    >
                      <span
                        class="inline-block size-2.5 rounded-full"
                        style={`background-color: ${field.color}`}
                        aria-hidden="true"
                      ></span>
                      <span>{field.displayName}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {:else if !loading && !filterByMap}<p class="mt-2 text-sm text-muted">No recorded readings available.</p>{/if}
</div>

{#if touchDevice || isZoomed}
  <div
    class="fixed right-4 bottom-4 z-20 flex flex-col items-center gap-2"
    style="visibility: var(--app-floating-controls-visibility, visible)"
  >
    {#if isZoomed}
      <button
        type="button"
        class="flex size-14 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-full border border-outline bg-accent-fill text-[10px] font-bold tracking-[0.12em] text-on-accent uppercase shadow-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        aria-label="Reset chart zoom"
        disabled={filterByMap}
        title={filterByMap ? 'Map controls the chart range' : 'Reset chart zoom'}
        onpointerdown={(event) => activateFromPointer(event, reset)}
        onclick={(event) => activateFromKeyboardOrAssistiveClick(event, reset)}
      >
        <Icon name="rotate-cw" class="size-5" />
        <span aria-hidden="true">Reset</span>
      </button>
    {/if}

    {#if touchDevice}
      <button
        type="button"
        class="chart-mode flex size-14 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-full border border-current text-[10px] font-bold tracking-[0.12em] uppercase shadow-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        data-mode={interactionMode}
        aria-label={`Chart mode: ${interactionMode}. Switch to ${nextInteractionMode()} mode`}
        title={filterByMap ? 'Map controls the chart range' : `Switch to ${nextInteractionMode()} mode`}
        disabled={filterByMap}
        onpointerdown={(event) => activateFromPointer(event, cycleInteractionMode)}
        onclick={(event) => activateFromKeyboardOrAssistiveClick(event, cycleInteractionMode)}
      >
        <Icon name={MODE_ICONS[interactionMode]} class="size-5" />
        <span aria-hidden="true">{interactionMode}</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .chart-mode[data-mode='info'] {
    color: var(--app-accent);
    background: color-mix(in srgb, var(--app-accent) 8%, var(--app-surface));
  }

  .chart-mode[data-mode='zoom'] {
    color: var(--app-success);
    background: color-mix(in srgb, var(--app-success) 8%, var(--app-surface));
  }

  .chart-mode[data-mode='pan'] {
    color: var(--app-warning);
    background: color-mix(in srgb, var(--app-warning) 5%, var(--app-surface));
  }
</style>
