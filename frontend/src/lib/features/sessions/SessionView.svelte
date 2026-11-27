<script lang="ts">
  import SessionConnectionContext from './SessionConnectionContext.svelte';
  import PausedRide from './PausedRide.svelte';
  import { loadFaultsAndErrors } from '$lib/features/faults/session-faults';
  import FaultList from '$lib/features/faults/FaultList.svelte';
  import type { RideFault } from '$lib/features/faults/faults';
  import { startRideRefresh } from './ride-refresh';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import type { SessionDisplayOptions, SessionRideMarker } from '$lib/backend/contract';
  import { SessionDataHttpError } from '$lib/backend/session-data-client';
  import { ApiRequestError } from '$lib/backend/client';
  import SessionMarkers from './SessionMarkers.svelte';
  import { getContext, onDestroy, onMount, tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { APP_HEADER_CONTEXT, type AppHeaderAction, type AppHeaderContext } from '$lib/app/header';
  import { backendState } from '$lib/backend/state.svelte';
  import { formatDistanceM } from '$lib/features/measurements/format';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import PruneDialog from './PruneDialog.svelte';
  import { hasCoarserPruneResolution } from './prune';
  import { sessionExportLabel } from './session-export';
  import SessionHistory from './SessionHistory.svelte';
  import SessionEvents from './SessionEvents.svelte';
  import SessionLocationMap from './SessionLocationMap.svelte';
  import { sessionStartDateLabel } from './session-label';
  import type { Viewport } from './viewport';
  import type { SessionLocationPoint } from '$lib/backend/contract';
  import { mapIntervals, type MapBounds } from './map-filter';
  let filterByMap = $state(false);
  let mapBounds = $state<MapBounds | null>(null);
  let track = $state<SessionLocationPoint[][] | null>(null);
  let trackSnapshot = $state('');
  let refreshAttempted = false;
  const snapshotKey = $derived(JSON.stringify(backendState.sessionMetadata?.snapshot));
  const spatialSelection = $derived.by(() => {
    if (!filterByMap || !mapBounds || !track || trackSnapshot !== snapshotKey) return { intervals: null, error: null };
    try {
      return {
        intervals: mapIntervals(track, mapBounds, backendState.sessionMetadata!.summary.totalElapsedMs),
        error: null,
      };
    } catch (reason) {
      return { intervals: [], error: reason instanceof Error ? reason.message : String(reason) };
    }
  });
  function setMapFilter(enabled: boolean) {
    pauseFollowing();
    filterByMap = enabled;
    refreshAttempted = false;
  }
  function refreshSpatialSnapshot(reason: unknown) {
    const conflict =
      (reason instanceof ApiRequestError && reason.code === 'conflict') ||
      (reason instanceof SessionDataHttpError && reason.status === 409);
    if (!conflict || refreshAttempted) return;
    refreshAttempted = true;
    void backendState.openSession(sessionId);
  }

  let {
    sessionId,
    boardSavedDeviceId,
    fromLive = false,
  }: { sessionId: string; boardSavedDeviceId?: string | null; fromLive?: boolean } = $props();
  const activeConnection = $derived(backendState.snapshot?.activeConnection);
  const isCurrentRide = $derived(activeConnection?.activeSession?.sessionId === sessionId);
  const pausedRide = $derived(
    backendState.snapshot?.pausedRide?.sessionId === sessionId ? backendState.snapshot.pausedRide : null
  );
  const isActive = $derived(backendState.selectedSession?.state === 'active');
  let following = $state(true);
  let wasActive = $state(false);
  $effect(() => {
    if (isActive) wasActive = true;
  });
  let liveVersion = $state(0);
  let actionError = $state<string | null>(null);
  let refreshError = $state('');
  let unavailable = $state(false);
  let refresher: ReturnType<typeof startRideRefresh> | null = null;
  function pauseFollowing() {
    following = false;
  }
  function jumpToLive() {
    following = true;
    filterByMap = false;
    selectedMarker = null;
    selectedPoint = null;
    liveVersion++;
    void refresher?.refresh();
  }
  let deleteConfirmationOpen = $state(false);
  let pruneOpen = $state(false);
  let deleting = $state(false);
  let endRideConfirmationOpen = $state(false);
  let endingRide = $state(false);
  let endRideError = $state('');
  function requestEndRide(closeMenu: () => void) {
    closeMenu();
    endRideError = '';
    endRideConfirmationOpen = true;
  }
  async function endRide() {
    if (endingRide) return;
    endingRide = true;
    endRideError = '';
    try {
      if (await backendState.endRide(sessionId)) {
        endRideConfirmationOpen = false;
        try {
          await backendState.refreshSession(sessionId, () => true);
        } catch {
          refreshError = 'The ride ended, but the session could not be refreshed. Reopen it to try again.';
        }
      } else endRideError = backendState.error ?? 'Could not end the ride. Try again.';
    } finally {
      endingRide = false;
    }
  }
  let savingDisplayOptions = $state(false);
  let smoothCharts = $state(true);
  async function toggleDisplayOption(key: keyof SessionDisplayOptions) {
    const settings = backendState.settings;
    if (!settings || savingDisplayOptions) return;
    savingDisplayOptions = true;
    try {
      await backendState.updateSessionSettings({
        sessionDisplayOptions: { ...settings.sessionDisplayOptions, [key]: !settings.sessionDisplayOptions[key] },
      });
    } finally {
      savingDisplayOptions = false;
    }
  }
  let locationMapHeight = $state(0);
  let selectedElapsedMs = $state(0);
  let markers = $state<SessionRideMarker[]>([]);
  let selectedMarker = $state<SessionRideMarker | null>(null);
  let selectedPoint = $state<{ elapsedMs: number } | null>(null);
  let firmwareFaults = $state<RideFault[]>([]);
  let firmwareFaultError = $state('');
  let faultRetry = $state(0);
  const faultBoundary = $derived(
    `${backendState.sessionMetadata?.summary.sessionId}:${backendState.sessionMetadata?.snapshot.committedEventSequence}`
  );
  let markerError = $state('');
  let markerRetry = '';
  function selectMarker(marker: SessionRideMarker) {
    pauseFollowing();
    selectedMarker = marker;
    selectedElapsedMs = marker.elapsedMs;
    selectedPoint = { elapsedMs: marker.elapsedMs };
  }
  function selectFault(elapsedMs: number) {
    pauseFollowing();
    selectedMarker = null;
    selectedElapsedMs = elapsedMs;
    selectedPoint = { elapsedMs };
  }
  $effect(() => {
    const metadata = backendState.sessionMetadata;
    if (!metadata || metadata.summary.sessionId !== sessionId) return;
    const controller = backendState.createSessionReviewController(metadata);
    let active = true;
    markerError = '';
    void (async () => {
      const loaded: SessionRideMarker[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 4 && metadata.markerCount; page++) {
        const result = await controller.loadMarkers({
          kind: 'markers',
          range: { startElapsedMs: 0, endElapsedMs: metadata.summary.totalElapsedMs },
          limit: 256,
          cursor,
        });
        if (!active) return;
        loaded.push(...result.markers);
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      if (cursor || loaded.length !== metadata.markerCount || loaded.length > 1000)
        throw new Error('Incomplete marker history');
      if (active) markers = loaded;
    })().catch((error) => {
      if (!active) return;
      if (
        error instanceof ApiRequestError &&
        ['conflict', 'invalid_request'].includes(error.code) &&
        markerRetry !== metadata.summary.sessionId
      ) {
        markerRetry = metadata.summary.sessionId;
        void backendState.openSession(metadata.summary.sessionId);
      } else markerError = 'Markers could not be loaded.';
    });
    return () => {
      active = false;
      controller.dispose();
    };
  });
  $effect(() => {
    void faultBoundary;
    void faultRetry;
    const metadata = untrack(() => backendState.sessionMetadata);
    if (!metadata || metadata.summary.sessionId !== sessionId) return;
    const controller = backendState.createSessionReviewController(metadata);
    let active = true;
    firmwareFaultError = '';
    void loadFaultsAndErrors(controller, metadata)
      .then((faults) => {
        if (active) firmwareFaults = faults;
      })
      .catch((error) => {
        if (active) {
          firmwareFaults = [];
          firmwareFaultError = error instanceof Error ? error.message : 'Fault history could not be loaded.';
        }
      });
    return () => {
      active = false;
      controller.dispose();
    };
  });
  let chartViewport = $state<Viewport | null>(null);
  const appHeader = getContext<AppHeaderContext>(APP_HEADER_CONTEXT);
  const headerOwner = '/sessions/[sessionId]';
  const units = $derived(backendState.settings?.unitPreference ?? 'metric');
  const returnHref = $derived(
    fromLive
      ? '#/live'
      : boardSavedDeviceId
        ? `#/sessions/boards/${encodeURIComponent(boardSavedDeviceId)}`
        : '#/sessions'
  );

  $effect(() => {
    const session = backendState.selectedSession;
    const canExport = !backendState.busy && session?.state !== 'active';
    const canEndRide = isActive && (isCurrentRide || !!pausedRide);
    const sessionActions = {
      group: 'Session',
      unavailableReason: backendState.busy
        ? 'Another operation is in progress. Please wait.'
        : isActive
          ? 'End the ride for more options.'
          : undefined,
    };
    appHeader.set(headerOwner, {
      title: isActive ? 'Current ride' : (sessionStartDateLabel(session?.startedAt) ?? 'Session'),
      backHref: returnHref,
      backLabel: fromLive ? 'Back to board' : boardSavedDeviceId ? 'Board sessions' : 'Sessions',
      ...(session
        ? {
            menuLabel: 'Session actions',
            menu: [
              {
                group: 'Chart display',
                label: 'Smooth charts',
                checked: smoothCharts,
                onactivate: () => {
                  smoothCharts = !smoothCharts;
                },
              },
              {
                group: 'Chart display',
                label: 'Both footpads off at speed',
                checked: backendState.settings?.sessionDisplayOptions.bothFootpadsOff ?? false,
                disabled: savingDisplayOptions,
                onactivate: () => toggleDisplayOption('bothFootpadsOff'),
              },
              {
                group: 'Chart display',
                label: 'One footpad off at speed',
                checked: backendState.settings?.sessionDisplayOptions.oneFootpadOff ?? false,
                disabled: savingDisplayOptions,
                onactivate: () => toggleDisplayOption('oneFootpadOff'),
              },
              ...(canEndRide
                ? [
                    {
                      group: 'Session',
                      label: 'End ride…',
                      disabled: backendState.busy || endingRide,
                      onactivate: requestEndRide,
                    } satisfies AppHeaderAction,
                  ]
                : []),
              {
                ...sessionActions,
                label: sessionExportLabel(backendState.platform, 'float-view-archive'),
                disabled: !canExport,
                onactivate: (closeMenu: () => void) => exportSession(closeMenu, 'float-view-archive'),
              },
              {
                ...sessionActions,
                label: sessionExportLabel(backendState.platform, 'csv'),
                disabled: !canExport,
                onactivate: (closeMenu: () => void) => exportSession(closeMenu, 'csv'),
              },
              {
                ...sessionActions,
                label: 'Prune',
                appearance: 'warning' as const,
                disabled:
                  !canExport ||
                  !hasCoarserPruneResolution(backendState.sessionMetadata?.prune.targetResolutionSeconds ?? null),
                onactivate: (closeMenu: () => void) => requestPruneSession(closeMenu),
              },
              {
                ...sessionActions,
                label: 'Delete session',
                appearance: 'destructive' as const,
                disabled: !canExport,
                onactivate: (closeMenu: () => void) => requestDeleteSession(closeMenu),
              },
            ],
          }
        : {}),
    });
  });
  onDestroy(() => appHeader.clear(headerOwner));

  $effect(() => {
    if (!backendState.sessionMetadata?.location.available && !markers.some((m) => m.location)) locationMapHeight = 0;
  });

  $effect(() => {
    if (backendState.sessionMetadata?.summary.sessionId !== sessionId) {
      chartViewport = null;
      filterByMap = false;
      mapBounds = null;
      track = null;
      trackSnapshot = '';
      refreshAttempted = false;
    }
  });

  onMount(() => {
    let active = true;
    refresher = startRideRefresh({
      shouldRefresh: () => isActive && !pausedRide && !unavailable && (following || !isCurrentRide),
      refresh: async (accept) => {
        await backendState.refreshSession(sessionId, accept);
        if (active) refreshError = '';
      },
      onerror: (reason) => {
        unavailable = reason instanceof ApiRequestError && reason.code === 'not_found';
        refreshError = unavailable
          ? 'This ride is no longer available. It may not have met the minimum distance to be saved.'
          : 'Could not refresh this ride. Showing the last loaded data; retrying automatically.';
      },
    });
    void backendState.openSession(sessionId).then((opened) => {
      if (active && !opened && backendState.sessionNotFound) void goto(returnHref, { replaceState: true });
    });
    return () => {
      active = false;
      refresher?.dispose();
      refresher = null;
      backendState.closeSession();
    };
  });

  function requestDeleteSession(closeMenu: () => void) {
    closeMenu();
    actionError = null;
    if (backendState.selectedSession) deleteConfirmationOpen = true;
  }

  function requestPruneSession(closeMenu: () => void) {
    closeMenu();
    if (backendState.selectedSession) pruneOpen = true;
  }

  async function closePruneSession() {
    pruneOpen = false;
    await tick();
    appHeader.focusMenu();
  }

  async function cancelDeleteSession() {
    deleteConfirmationOpen = false;
    await tick();
    appHeader.focusMenu();
  }

  async function exportSession(closeMenu: () => void, format: 'float-view-archive' | 'csv') {
    closeMenu();
    await backendState.exportSession(format);
  }

  async function deleteSession() {
    if (deleting) return;
    deleting = true;
    actionError = null;
    const deleted = await backendState.deleteSelectedSession();
    deleting = false;
    if (!deleted) {
      actionError = backendState.error ?? 'The session could not be deleted. Please try again.';
      return;
    }
    deleteConfirmationOpen = false;
    if (deleted) await goto(returnHref, { replaceState: true });
  }
</script>

<section
  aria-labelledby="app-title"
  class="space-y-2 py-2"
  style={`--section-header-top: calc(var(--app-header-bottom) + ${locationMapHeight}px)`}
>
  {#if backendState.selectedSession}
    {#if pausedRide}<PausedRide ride={pausedRide} />{/if}
    {#if isActive && !unavailable && !pausedRide}
      <div class="flex items-center justify-between gap-3 rounded-lg border border-outline bg-surface px-3 py-2">
        <p role="status" class="text-sm">
          {isCurrentRide
            ? activeConnection?.state === 'reconnecting'
              ? 'Reconnecting'
              : 'Recording'
            : 'Finishing ride…'}
          · {following ? 'Following live' : 'Viewing earlier data'}
        </p>
        {#if !following}
          <button
            type="button"
            class="min-h-11 touch-manipulation rounded border border-outline px-3 text-sm"
            onpointerdown={(event) => activateFromPointer(event, jumpToLive)}
            onclick={(event) => activateFromKeyboardOrAssistiveClick(event, jumpToLive)}>Jump to live</button
          >
        {/if}
      </div>
    {/if}
    {#if refreshError}<p role="alert" class="text-sm text-warning">{refreshError}</p>{/if}
    {#if backendState.sessionMetadata}
      {#if firmwareFaults.length}
        <section class="mb-3 space-y-2" aria-label="Ride faults and errors">
          <h2 class="font-semibold text-danger">Faults and errors ({firmwareFaults.length})</h2>
          <FaultList faults={firmwareFaults} onselect={selectFault} />
          <p class="text-xs text-muted">Times are approximate. Select a timed event to inspect the ride.</p>
        </section>
      {/if}
      {#if firmwareFaultError}<p role="alert" class="mb-3 text-sm text-danger">{firmwareFaultError}</p>
        <button
          type="button"
          class="mb-3 min-h-11 touch-manipulation rounded border border-outline px-3 text-sm"
          onpointerdown={(e) =>
            activateFromPointer(e, () => {
              faultRetry++;
            })}
          onclick={(e) =>
            activateFromKeyboardOrAssistiveClick(e, () => {
              faultRetry++;
            })}>Retry faults</button
        >{/if}
      <SessionMarkers {markers} selected={selectedMarker?.sequence ?? null} onselect={selectMarker} />
      {#if markerError}<p role="alert" class="text-warning">{markerError}</p>{/if}
      {#if backendState.sessionMetadata.location.available || markers.some((m) => m.location)}
        <SessionLocationMap
          metadata={backendState.sessionMetadata}
          following={following && wasActive}
          live={following && isActive}
          {selectedElapsedMs}
          {markers}
          {firmwareFaults}
          {selectedMarker}
          onmarkerselect={selectMarker}
          onfaultselect={selectFault}
          viewport={chartViewport}
          {filterByMap}
          initialBounds={mapBounds}
          oninspect={pauseFollowing}
          {liveVersion}
          onfilterchange={setMapFilter}
          onbounds={(bounds) => {
            mapBounds = bounds;
          }}
          ontrack={(segments) => {
            track = segments;
            trackSnapshot = snapshotKey;
          }}
          ontrackerror={refreshSpatialSnapshot}
          bind:height={locationMapHeight}
        />
      {:else}
        <div class="rounded-lg border border-outline bg-elevated p-3">No location data was saved for this ride.</div>
      {/if}

      <div class="mt-3">
        <SessionHistory
          {smoothCharts}
          locationTrack={track}
          metadata={backendState.sessionMetadata}
          {markers}
          {firmwareFaults}
          {selectedPoint}
          following={following && wasActive}
          oninspect={pauseFollowing}
          {liveVersion}
          {filterByMap}
          intervals={spatialSelection.intervals}
          filterError={spatialSelection.error}
          ondataerror={refreshSpatialSnapshot}
          initialViewport={chartViewport}
          onmarkerselect={selectMarker}
          onfaultselect={selectFault}
          onselectionchange={(elapsedMs) => {
            selectedElapsedMs = elapsedMs;
            if (selectedMarker?.elapsedMs !== elapsedMs) selectedMarker = null;
          }}
          onviewportchange={(viewport) => (chartViewport = viewport)}
        />
      </div>

      {#if filterByMap}<p class="mt-3 text-xs text-muted">
          Session totals and events are not filtered by the map.
        </p>{/if}
      <div class="mt-4 grid grid-cols-2 gap-3">
        <div class="rounded-lg border border-outline bg-elevated p-3">
          <p class="text-sm text-muted">Samples</p>
          <p class="text-xl">{backendState.selectedSession.sampleCount}</p>
        </div>
        <div class="rounded-lg border border-outline bg-elevated p-3">
          <p class="text-sm text-muted">Distance</p>
          <p class="text-xl">
            {formatDistanceM(backendState.selectedSession.distanceM, units)}
          </p>
        </div>
      </div>
    {/if}

    {#if backendState.sessionMetadata}<SessionConnectionContext metadata={backendState.sessionMetadata} />
      <SessionEvents metadata={backendState.sessionMetadata} viewport={chartViewport} {filterByMap} />{/if}
  {:else}
    <p class="mt-3 text-muted">Loading session…</p>
  {/if}
  {#if backendState.error}
    <p role="alert" class="mt-3 text-warning">{backendState.error}</p>
    {#if !backendState.selectedSession}<button
        type="button"
        class="mt-3 touch-manipulation rounded-lg bg-elevated px-4 py-2"
        onpointerdown={(event) =>
          activateFromPointer(event, () => {
            void backendState.openSession(sessionId);
          })}
        onclick={(event) =>
          activateFromKeyboardOrAssistiveClick(event, () => {
            void backendState.openSession(sessionId);
          })}>Retry</button
      >{/if}
  {/if}
</section>

<PruneDialog
  open={pruneOpen}
  scope="one"
  existingResolutionSeconds={backendState.sessionMetadata?.prune.targetResolutionSeconds}
  error={backendState.error}
  onpreview={(resolution) => backendState.previewSessionPrune('one', resolution, sessionId)}
  onprune={(resolution) => backendState.startSessionPrune('one', resolution, sessionId)}
  oncancel={closePruneSession}
/>

<ConfirmDialog
  open={endRideConfirmationOpen}
  titleId="session-end-ride-title"
  title="End ride?"
  description={isCurrentRide
    ? 'This will end the ride and disconnect the board. Reconnecting will start a new ride.'
    : 'This will finish this ride. Reconnecting will start a new ride.'}
  confirmLabel="End ride"
  appearance="destructive"
  busy={endingRide}
  error={endRideError}
  onconfirm={endRide}
  oncancel={async () => {
    endRideConfirmationOpen = false;
    await tick();
    appHeader.focusMenu();
  }}
/>

<ConfirmDialog
  open={deleteConfirmationOpen}
  titleId="delete-session-confirmation-title"
  title="Delete session?"
  description={`Permanently delete this ${backendState.selectedSession?.sampleCount ?? 0}-sample session? This cannot be undone.`}
  confirmLabel="Delete"
  appearance="destructive"
  busy={deleting}
  error={actionError}
  onconfirm={deleteSession}
  oncancel={cancelDeleteSession}
/>
