<script lang="ts">
  import { createMotion } from '$lib/ui/motion';
  import { getContext, onDestroy, onMount, tick } from 'svelte';
  import { UI_RESTORATION, type UiRestoration, uiDiagnostic } from '$lib/app/ui-restoration.svelte';
  import type { LiveViewMode, UiSurface } from '$lib/backend/contract';
  import { goto } from '$app/navigation';
  import { connectionReturnHref } from '$lib/app/connection-navigation';
  import { APP_HEADER_CONTEXT, type AppHeaderContext } from '$lib/app/header';
  import { backendState } from '$lib/backend/state.svelte';
  import type { RefloatControl } from '$lib/backend/contract';
  import BoardEditor from '$lib/features/boards/BoardEditor.svelte';
  import RefloatCompatibilityDialog from '$lib/features/connection/RefloatCompatibilityDialog.svelte';
  import ControllerSelection from '$lib/features/connection/ControllerSelection.svelte';
  import DetailedView from '$lib/features/connection/DetailedView.svelte';
  import FlywheelModeOverlay from '$lib/features/connection/FlywheelModeOverlay.svelte';
  import RefloatConfigurationEditor from '$lib/features/connection/RefloatConfigurationEditor.svelte';
  import SpeedCalibration from '$lib/features/connection/SpeedCalibration.svelte';
  import RefloatTunes from '$lib/features/connection/RefloatTunes.svelte';
  import { RefloatConfigurationController } from '$lib/features/connection/refloat-configuration.svelte';
  import { liveCharging } from '$lib/features/connection/charging';
  import { liveStatus } from '$lib/features/connection/live-status';
  import { lightingMenuActions } from '$lib/features/connection/lighting';
  import FaultHistory from '$lib/features/connection/FaultHistory.svelte';
  import LiveCharts from '$lib/features/connection/LiveCharts.svelte';
  import { hasFaultHistory } from '$lib/features/connection/live-status';
  import CustomView from '$lib/features/connection/CustomView.svelte';
  import LiveWarnings from '$lib/features/connection/LiveWarnings.svelte';
  import { createLiveHistory } from '$lib/features/connection/live-history.svelte';
  import LiveView from '$lib/features/connection/LiveView.svelte';
  import BmsView from '$lib/features/connection/BmsView.svelte';
  import { bmsMenuVisible } from '$lib/features/connection/bms';
  import {
    controllerShutdownConfirmation,
    controllerShutdownDisabled,
    flywheelDisableUnavailable,
    flywheelOverlayVisible,
    refloatControlConfirmation,
    refloatMenuActions,
    shouldConfirmDisconnect,
    type RefloatControlConfirmation,
  } from '$lib/features/connection/live';
  import FullScreenOverlay from '$lib/ui/FullScreenOverlay.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import RideLocationControl from '$lib/features/connection/RideLocationControl.svelte';

  const motion = createMotion();

  const viewOptions = [
    { type: 'normal', displayName: 'Live View' },
    { type: 'detailed', displayName: 'Detailed View' },
    { type: 'custom', displayName: 'Custom View' },
  ] as const;
  type View = LiveViewMode;

  const restoration = getContext<UiRestoration>(UI_RESTORATION);
  let presentationReady = $state(false);
  let view = $state<View>('normal');
  let viewReady = $state(false);
  let viewPending = $state(false);
  let viewError = $state<string | null>(null);
  let viewGeneration = 0;
  let checkpointView: { identity: string; mode: View } | undefined;
  let customView = $state<CustomView>();
  const history = createLiveHistory();
  let speedCalibrationOpen = $state(false);
  $effect(() => {
    if (speedCalibrationOpen && !connection) speedCalibrationOpen = false;
  });
  let configuration = $state<{ savedDeviceId: string; batteryOnly: boolean; trigger?: HTMLButtonElement } | null>(null);
  let liveChartsOpen = $state(false);
  let faultHistoryOpen = $state(false);
  let bmsTrigger: HTMLButtonElement | undefined;
  let bmsOpen = $state(false);
  let locationOpen = $state(false);
  let refloatConfigurationOpen = $state(false);
  let refloatTunesOpen = $state(false);
  let disconnectConfirmationOpen = $state(false);
  let connectionIssueConfirmationOpen = $state(false);
  let firmwareUnsupportedConfirmationOpen = $state(false);
  let confirmationError = $state<string | null>(null);
  let flywheelError = $state<string | null>(null);
  let disconnecting = $state(false);
  let shutdownConfirmationOpen = $state(false);
  let refloatConfirmation = $state<RefloatControlConfirmation | null>(null);
  let editor = $state<BoardEditor>();
  const appHeader = getContext<AppHeaderContext>(APP_HEADER_CONTEXT);
  const headerOwner = '/live';
  const connection = $derived(backendState.snapshot?.activeConnection);
  const savedViewTarget = $derived(connection?.trackingMode === 'saved' ? connection.savedDeviceId : null);
  const viewIdentity = $derived(connection ? `${connection.deviceId}:${savedViewTarget ?? 'guest'}` : null);
  $effect(() => {
    if (!presentationReady) return;
    const identity = viewIdentity;
    const target = savedViewTarget;
    const generation = ++viewGeneration;
    viewPending = false;
    viewError = null;
    view = 'normal';
    viewReady = !target;
    if (checkpointView?.identity === identity) {
      view = checkpointView.mode;
      checkpointView = undefined;
      viewReady = true;
    } else if (target) {
      void backendState
        .readBoardProfile(target)
        .then((profile) => {
          if (generation !== viewGeneration) return;
          view = profile.values.lastLiveView ?? 'normal';
        })
        .catch(() => {
          if (generation === viewGeneration)
            viewError = 'Could not restore this board’s view. Select a view to try again.';
        })
        .finally(() => {
          if (generation === viewGeneration) viewReady = true;
        });
    }
    return () => {
      viewGeneration++;
    };
  });

  async function selectView(next: View) {
    if (!viewReady || viewPending || (view === next && !viewError)) return;
    const generation = viewGeneration;
    const target = savedViewTarget;
    viewPending = true;
    try {
      if (customView && !(await customView.requestLeave())) return;
      if (generation !== viewGeneration) return;
      if (target) await backendState.saveLastLiveView(target, next);
      if (generation !== viewGeneration) return;
      view = next;
      viewError = null;
    } catch {
      if (generation === viewGeneration)
        viewError = 'Could not save this board’s view. Select the view again to retry.';
    } finally {
      if (generation === viewGeneration) viewPending = false;
    }
  }
  const refloatDeviceId = $derived(connection?.deviceId ?? '');
  const refloatConfiguration = $derived(new RefloatConfigurationController(backendState, refloatDeviceId));
  onMount(() => {
    const checkpoint = restoration.take('live');
    if (checkpoint?.live && checkpoint.live.deviceId === connection?.deviceId) {
      view =
        checkpoint.live.mode === 'custom' &&
        (!connection?.savedDeviceId ||
          connection.trackingMode !== 'saved' ||
          checkpoint.live.savedDeviceId !== connection.savedDeviceId)
          ? 'normal'
          : checkpoint.live.mode;
      checkpointView = { identity: viewIdentity!, mode: view };
      const surface = checkpoint.surface;
      const blocked =
        flywheelOverlayVisible(connection) ||
        connection?.state === 'selecting_controller' ||
        !!connection?.connectionIssue ||
        connection?.firmware?.supported === false;
      if (surface && !blocked) {
        switch (surface.kind) {
          case 'faultHistory':
            faultHistoryOpen = true;
            break;
          case 'liveCharts':
            liveChartsOpen = true;
            break;
          case 'bmsDetails':
            bmsOpen = !!connection && bmsMenuVisible(connection.bms);
            break;
          case 'refloatConfiguration':
            refloatConfigurationOpen = connection?.refloatConfiguration?.availability === 'ready';
            break;
          case 'refloatTunes':
            refloatTunesOpen =
              connection?.refloatConfiguration?.availability === 'ready' &&
              !!connection.refloatConfiguration.packageVersion &&
              !!connection.refloatConfiguration.schemaFingerprint;
            break;
          case 'boardConfiguration':
            if (
              surface.savedDeviceId === connection?.savedDeviceId &&
              backendState.savedDevices.some((d) => d.savedDeviceId === surface.savedDeviceId)
            )
              configuration = { savedDeviceId: surface.savedDeviceId, batteryOnly: surface.batteryOnly };
            break;
        }
      } else if (surface) uiDiagnostic('surface_unavailable', 'live', surface.kind);
    }
    presentationReady = true;
  });
  $effect(() => {
    if (!presentationReady || !viewReady) return;
    let surface: UiSurface | null = configuration
      ? {
          kind: 'boardConfiguration',
          savedDeviceId: configuration.savedDeviceId,
          batteryOnly: configuration.batteryOnly,
        }
      : faultHistoryOpen
        ? { kind: 'faultHistory' }
        : liveChartsOpen
          ? { kind: 'liveCharts' }
          : bmsOpen
            ? { kind: 'bmsDetails' }
            : refloatConfigurationOpen
              ? { kind: 'refloatConfiguration' }
              : refloatTunesOpen
                ? { kind: 'refloatTunes' }
                : null;
    if (flywheelOverlayVisible(connection)) surface = null;
    restoration.present(
      '#/live',
      connection
        ? {
            deviceId: connection.deviceId,
            mode: view,
            ...(view === 'custom' && connection.savedDeviceId ? { savedDeviceId: connection.savedDeviceId } : {}),
          }
        : null,
      surface
    );
  });
  const sample = $derived(connection?.latestSample);
  const live = $derived(connection?.state === 'ready');
  const savedDevice = $derived(
    backendState.savedDevices.find((device) => device.savedDeviceId === connection?.savedDeviceId)
  );

  const refloatCompatibility = $derived(
    connection?.connectionIssue?.code === 'unsupported_refloat'
      ? connection.connectionIssue.refloatCompatibility
      : undefined
  );
  const connectionIssueKey = $derived(
    connection?.connectionIssue
      ? `${connection.deviceId}:${connection.connectionIssue.code}:${refloatCompatibility?.reportedVersion ?? ''}`
      : null
  );
  const unsupportedFirmwareKey = $derived(
    connection?.firmware?.supported === false
      ? `${connection.deviceId}:${connection.firmware.vescVersion}:${connection.firmware.packageVersion}`
      : null
  );

  let lastConnectionIssueKey = $state<string | null>(null);
  let lastUnsupportedFirmwareKey = $state<string | null>(null);

  $effect(() => {
    const issueKey = connectionIssueKey;
    if (!issueKey) {
      connectionIssueConfirmationOpen = false;
      lastConnectionIssueKey = null;
    } else if (issueKey !== lastConnectionIssueKey) {
      confirmationError = null;
      connectionIssueConfirmationOpen = true;
      lastConnectionIssueKey = issueKey;
    }
  });

  $effect(() => {
    refloatConfiguration.reconcile(connection?.refloatConfiguration ?? null);
  });

  $effect(() => {
    const firmwareKey = unsupportedFirmwareKey;
    if (!firmwareKey) {
      firmwareUnsupportedConfirmationOpen = false;
      lastUnsupportedFirmwareKey = null;
    } else if (firmwareKey !== lastUnsupportedFirmwareKey) {
      confirmationError = null;
      firmwareUnsupportedConfirmationOpen = true;
      lastUnsupportedFirmwareKey = firmwareKey;
    }
  });

  let nowMs = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (nowMs = Date.now()), 1_000);
    return () => clearInterval(timer);
  });
  const charging = $derived(liveCharging(connection, Math.max(nowMs, Date.now())));
  const deviceState = $derived(liveStatus(connection?.state, sample, charging));

  $effect(() => {
    if (!connection) {
      appHeader.set(headerOwner, { title: 'Live board', subtitle: 'Recovering connection…' });
      return;
    }

    appHeader.set(headerOwner, {
      title: connection.displayName,
      titleClass: 'truncate text-3xl font-semibold',
      accessory: connection.trackingMode === 'saved' ? locationAccessory : undefined,
      bottomBorder: view === 'detailed',
      subtitle: refloatCompatibility ? 'Unsupported Refloat' : deviceState.display,
      subtitleClass: deviceState.safetyStateActive
        ? 'text-sm text-danger'
        : live
          ? 'text-sm capitalize text-success'
          : 'text-sm capitalize text-warning',
      menuLabel: 'Board actions',
      menuPresentation: 'overlay',
      menuWarning:
        connection.trackingMode === 'guest' ? 'Guest connection — live data will not be saved or tracked.' : undefined,
      menuUnavailable: flywheelOverlayVisible(connection),
      menu: [
        ...viewOptions
          .filter(
            (option) => option.type !== 'custom' || (connection.trackingMode === 'saved' && connection.savedDeviceId)
          )
          .map((option) => ({
            label: option.displayName,
            icon: option.type === 'detailed' ? ('list' as const) : ('layout-dashboard' as const),
            group: 'View',
            selected: view === option.type,
            disabled: !viewReady || viewPending,
            onactivate: async (closeMenu: () => void) => {
              closeMenu();
              await selectView(option.type);
            },
          })),
        {
          label: 'Live charts…',
          icon: 'chart-no-axes-combined',
          group: 'View',
          onactivate: (closeMenu: () => void) => {
            closeMenu();
            liveChartsOpen = true;
          },
        },
        ...(connection.trackingMode === 'saved' && connection.activeSession
          ? [
              {
                label: 'Session…',
                icon: 'chart-no-axes-combined' as const,
                group: 'View',
                onactivate: (closeMenu: () => void) => {
                  closeMenu();
                  if (connection?.activeSession)
                    void goto(`#/sessions/${encodeURIComponent(connection.activeSession.sessionId)}?from=live`);
                },
              },
            ]
          : []),
        ...(connection.trackingMode === 'saved' && backendState.snapshot?.location.status !== 'authorized'
          ? [
              {
                label: 'Ride location…',
                icon: 'map-pin' as const,
                group: 'View',
                onactivate: (closeMenu: () => void) => {
                  closeMenu();
                  locationOpen = true;
                },
              },
            ]
          : []),
        ...(hasFaultHistory(sample) || connection.refloatControls?.fatalErrorLatched === true
          ? [
              {
                label: 'Faults and errors…',
                icon: 'triangle-alert' as const,
                group: 'View',
                appearance: 'danger' as const,
                onactivate: (closeMenu: () => void) => {
                  closeMenu();
                  faultHistoryOpen = true;
                },
              },
            ]
          : []),
        ...lightingMenuActions(connection).map((action) => ({
          label: action.label,
          icon: action.control === 'leds' ? ('lightbulb' as const) : ('flashlight' as const),
          group: 'Refloat',
          checked: action.checked,
          disabled: action.disabled,
          pending: action.pending,
          onactivate: () => {
            if (action.disabled || action.checked === null) return;
            void backendState.setRefloatControl(action.control, !action.checked);
          },
        })),
        ...refloatMenuActions(connection).map((action) => ({
          label: action.label,
          icon: action.control === 'flywheel' ? ('rotate-cw' as const) : ('power' as const),
          group: 'Refloat',
          disabled: action.disabled,
          pending: action.pending,
          onactivate: (closeMenu: () => void) => activateRefloatAction(action, closeMenu),
        })),
        ...(connection.refloatConfiguration
          ? [
              {
                group: 'Refloat',
                icon: 'sliders-horizontal' as const,
                label:
                  connection.refloatConfiguration.availability === 'loading'
                    ? 'Configure Refloat (loading…)'
                    : 'Configure Refloat',
                disabled: connection.refloatConfiguration.availability !== 'ready',
                onactivate: (closeMenu: () => void) => {
                  closeMenu();
                  refloatConfigurationOpen = true;
                },
              },
            ]
          : []),
        ...(connection.refloatConfiguration?.packageVersion && connection.refloatConfiguration.schemaFingerprint
          ? [
              {
                label: 'Tunes…',
                icon: 'sliders-vertical' as const,
                group: 'Refloat',
                disabled: connection.refloatConfiguration.availability !== 'ready',
                onactivate: (closeMenu: () => void) => {
                  closeMenu();
                  refloatTunesOpen = true;
                },
              },
            ]
          : []),
        ...(connection.deviceKind === 'board'
          ? [
              {
                label: 'Calibrate speed…',
                icon: 'route' as const,
                group: 'Board',
                disabled: connection.state !== 'ready',
                onactivate: (closeMenu: () => void) => {
                  closeMenu();
                  speedCalibrationOpen = true;
                },
              },
            ]
          : []),
        ...(connection.savedDeviceId
          ? [
              {
                label: 'Configure board',
                icon: 'settings' as const,
                group: 'Board',
                appearance: savedDevice && !savedDevice.profileComplete ? ('warning' as const) : ('normal' as const),
                onactivate: (closeMenu: () => void) => openConfigure(closeMenu),
              },
            ]
          : []),
        ...(bmsMenuVisible(connection.bms)
          ? [
              {
                label: 'BMS',
                icon: 'battery' as const,
                group: 'Board',
                onactivate: (closeMenu: () => void) => {
                  closeMenu();
                  bmsOpen = true;
                },
              },
            ]
          : []),
        {
          label: 'Shut down controller',
          icon: 'power',
          group: 'Connection',
          appearance: 'destructive' as const,
          disabled: backendState.busy || controllerShutdownDisabled(connection),
          onactivate: (closeMenu: () => void) => {
            closeMenu();
            confirmationError = null;
            shutdownConfirmationOpen = true;
          },
        },
        {
          label: 'Disconnect',
          icon: 'bluetooth-off',
          group: 'Connection',
          appearance: 'destructive' as const,
          disabled: backendState.busy,
          onactivate: (closeMenu: () => void) => requestDisconnect(closeMenu),
        },
        ...(connection.activeSession
          ? [
              {
                label: 'End ride',
                icon: 'flag' as const,
                group: 'Connection',
                appearance: 'destructive' as const,
                disabled: backendState.busy || !connection?.activeSession,
                onactivate: (closeMenu: () => void) => requestEndRide(closeMenu),
              },
            ]
          : []),
        {
          label: 'Back to app',
          icon: 'arrow-left',
          group: 'App',
          onactivate: (closeMenu: () => void) => {
            closeMenu();
            void goto(connectionReturnHref);
          },
        },
      ],
    });
  });
  onDestroy(() => appHeader.clear(headerOwner));

  let endRideRequested = $state(false);
  function requestDisconnect(closeMenu: () => void) {
    confirmationError = null;
    endRideRequested = false;
    closeMenu();
    if (shouldConfirmDisconnect(sample?.rideState)) {
      disconnectConfirmationOpen = true;
      return;
    }
    void disconnect();
  }

  function activateRefloatAction(action: ReturnType<typeof refloatMenuActions>[number], closeMenu: () => void) {
    closeMenu();
    confirmationError = null;
    refloatConfirmation = refloatControlConfirmation(action.control, action.enabled);
    if (refloatConfirmation) return;
    void performRefloatControl(action.control, action.enabled);
  }

  async function performRefloatControl(control?: RefloatControl, enabled?: boolean) {
    const confirmed = refloatConfirmation;
    const selectedControl = control ?? confirmed?.control;
    const selectedEnabled = enabled ?? confirmed?.enabled;
    if (!selectedControl || selectedEnabled === undefined) return;
    confirmationError = null;
    if (!(await backendState.setRefloatControl(selectedControl, selectedEnabled))) {
      confirmationError = backendState.error ?? 'The Refloat control could not be changed. Please try again.';
      return;
    }
    refloatConfirmation = null;
    await tick();
    requestAnimationFrame(() => appHeader.focusMenu());
  }

  $effect(() => {
    if (!flywheelOverlayVisible(connection)) flywheelError = null;
  });

  async function disableFlywheelMode() {
    if (!connection || flywheelDisableUnavailable(connection)) return;
    flywheelError = null;
    if (!(await backendState.setRefloatControl('flywheel', false)))
      flywheelError = backendState.error ?? 'Flywheel mode could not be disabled. Please try again.';
  }

  async function cancelRefloatConfirmation() {
    refloatConfirmation = null;
    await tick();
    requestAnimationFrame(() => appHeader.focusMenu());
  }

  async function performControllerShutdown() {
    if (!connection || controllerShutdownDisabled(connection)) return;
    confirmationError = null;
    if (!(await backendState.shutdownController())) {
      confirmationError = backendState.error ?? 'The controller could not be shut down. Please try again.';
      return;
    }
    shutdownConfirmationOpen = false;
    await tick();
    if (backendState.snapshot?.activeConnection) appHeader.focusMenu();
  }

  async function cancelControllerShutdown() {
    shutdownConfirmationOpen = false;
    await tick();
    appHeader.focusMenu();
  }

  function requestEndRide(closeMenu: () => void) {
    closeMenu();
    confirmationError = null;
    endRideRequested = true;
    disconnectConfirmationOpen = true;
  }
  async function disconnect() {
    if (disconnecting) return;
    disconnecting = true;
    confirmationError = null;
    const completed =
      endRideRequested && connection?.activeSession
        ? await backendState.endRide(connection.activeSession.sessionId)
        : await backendState.disconnectDevice();
    disconnecting = false;
    if (!completed) {
      confirmationError =
        backendState.error ??
        (endRideRequested
          ? 'The ride could not be ended. Please try again.'
          : 'The board could not be disconnected. Please try again.');
      return;
    }
    disconnectConfirmationOpen = false;
    if (!backendState.snapshot?.activeConnection) await goto('#/', { replaceState: true });
  }

  async function cancelDisconnect() {
    disconnectConfirmationOpen = false;
    await tick();
    appHeader.focusMenu();
  }

  async function retryConnection() {
    const deviceId = connection?.deviceId;
    if (!deviceId) return;
    confirmationError = null;
    connectionIssueConfirmationOpen = false;
    lastConnectionIssueKey = null;
    if (!(await backendState.connectDevice(deviceId, connection?.trackingMode ?? 'saved'))) {
      confirmationError = backendState.error ?? 'The board could not be connected. Please try again.';
      connectionIssueConfirmationOpen = true;
    }
  }

  function continueWithUnsupportedFirmware() {
    firmwareUnsupportedConfirmationOpen = false;
  }

  async function cancelConnectionIssue() {
    await disconnect();
    if (!confirmationError) connectionIssueConfirmationOpen = false;
  }

  async function cancelUnsupportedFirmware() {
    await disconnect();
    if (!confirmationError) firmwareUnsupportedConfirmationOpen = false;
  }

  function openConfigure(closeMenu?: () => void) {
    closeMenu?.();
    if (connection?.savedDeviceId) configuration = { savedDeviceId: connection.savedDeviceId, batteryOnly: false };
  }

  function openBatteryConfigure(trigger: HTMLButtonElement) {
    if (connection?.savedDeviceId && !configuration) {
      configuration = { savedDeviceId: connection.savedDeviceId, batteryOnly: true, trigger };
    }
  }

  $effect(() => {
    if (configuration && (connection?.savedDeviceId !== configuration.savedDeviceId || !savedDevice)) {
      configuration = null;
    }
  });

  async function closeConfigure() {
    const closingConfiguration = configuration;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await tick();
    if ((await editor?.flush()) === false) return;
    if (configuration !== closingConfiguration) return;
    configuration = null;
    await tick();
    if (closingConfiguration?.trigger?.isConnected) closingConfiguration.trigger.focus();
    else appHeader.focusMenu();
  }

  async function closeFaultHistory() {
    faultHistoryOpen = false;
    await tick();
    appHeader.focusMenu();
  }

  async function closeLiveCharts(keyboard: boolean) {
    liveChartsOpen = false;
    await tick();
    if (keyboard) appHeader.focusMenu();
  }

  async function closeBms() {
    bmsOpen = false;
    await tick();
    if (bmsTrigger?.isConnected) bmsTrigger.focus();
    else appHeader.focusMenu();
    bmsTrigger = undefined;
  }

  async function closeRefloatConfiguration() {
    if (!(await refloatConfiguration.flush())) return;
    refloatConfigurationOpen = false;
    await tick();
    appHeader.openMenu();
  }

  async function closeRefloatTunes() {
    refloatTunesOpen = false;
    await tick();
    appHeader.openMenu();
  }
</script>

{#snippet locationAccessory()}
  <RideLocationControl
    bind:open={locationOpen}
    unavailable={flywheelOverlayVisible(connection)}
    onclose={() => appHeader.focusMenu()}
  />
{/snippet}

<section
  aria-labelledby="app-title"
  class="relative flex h-full min-h-0 flex-1 flex-col gap-2"
  style="padding-top: var(--live-warning-clearance, 0px)"
>
  {#if connection && !flywheelOverlayVisible(connection)}
    <LiveWarnings
      {connection}
      onconfigure={openBatteryConfigure}
      onfaulthistory={() => {
        appHeader.closeMenu();
        faultHistoryOpen = true;
      }}
      onenablerefloat={() => {
        const action = refloatMenuActions(connection).find(
          (action) => action.kind === 'control' && action.control === 'package' && action.enabled
        );
        if (action && !action.disabled) activateRefloatAction(action, () => {});
      }}
    />
  {/if}
  {#if connection}
    {#if connection.connectionWarning}
      <aside
        role="status"
        aria-label="Possible CAN ID conflict"
        class="shrink-0 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm"
      >
        <p class="font-semibold">Possible CAN ID conflict</p>
        <p>{connection.connectionWarning.message}</p>
      </aside>
    {/if}
    {#if !viewReady}
      <p role="status" class="text-muted">Loading board view…</p>
    {:else if view === 'normal'}
      <div use:motion.surface={'content'} class="h-full min-h-0 flex-1 overflow-hidden">
        <LiveView
          {charging}
          {nowMs}
          onconfigure={openBatteryConfigure}
          onbms={bmsMenuVisible(connection.bms)
            ? (trigger) => {
                bmsTrigger = trigger;
                bmsOpen = true;
              }
            : undefined}
        />
      </div>
    {:else if view === 'custom' && connection.savedDeviceId && connection.trackingMode === 'saved'}
      {#key connection.savedDeviceId}<CustomView bind:this={customView} {connection} {history} {nowMs} />{/key}
    {:else}
      <div
        use:motion.surface={'content'}
        class="min-h-0 flex-1 overflow-y-auto overscroll-y-auto"
        style="--section-header-top: 0px"
      >
        <DetailedView {charging} onconfigure={openBatteryConfigure} />
      </div>
    {/if}
  {:else}
    <p class="text-muted">Recovering active connection…</p>
  {/if}
  {#if viewError}<p role="alert" class="shrink-0 text-warning">{viewError}</p>{/if}
  {#if backendState.error}<p role="alert" class="shrink-0 text-warning">{backendState.error}</p>{/if}
</section>

{#if connection}
  {#if refloatCompatibility}
    <RefloatCompatibilityDialog
      open={connectionIssueConfirmationOpen}
      boardName={connection.displayName}
      compatibility={refloatCompatibility}
      busy={backendState.busy}
      error={confirmationError}
      onretry={retryConnection}
      onexit={cancelConnectionIssue}
    />
  {:else}
    <ConfirmDialog
      open={connectionIssueConfirmationOpen}
      titleId="connection-issue-confirmation-title"
      title="Connection issue"
      description={connection?.connectionIssue?.message ?? 'An unknown connection issue occurred.'}
      confirmLabel="Retry"
      appearance="warning"
      busy={backendState.busy}
      error={confirmationError}
      onconfirm={retryConnection}
      oncancel={cancelConnectionIssue}
    />
  {/if}

  <ConfirmDialog
    open={firmwareUnsupportedConfirmationOpen}
    titleId="firmware-unsupported-confirmation-title"
    title="Firmware unsupported"
    description="Firmware {connection.firmware?.vescVersion} / {connection.firmware
      ?.packageVersion} is not supported. Live values may be incomplete."
    confirmLabel="Continue"
    appearance="warning"
    busy={backendState.busy}
    error={confirmationError}
    onconfirm={continueWithUnsupportedFirmware}
    oncancel={cancelUnsupportedFirmware}
  />
{/if}

{#if bmsOpen && connection}
  <FullScreenOverlay title="Battery management system" titleId="bms-overlay-title" closeLabel="Done" onclose={closeBms}>
    <BmsView bms={connection.bms} units={backendState.settings?.unitPreference ?? 'metric'} />
  </FullScreenOverlay>
{/if}

{#if refloatConfigurationOpen && connection?.refloatConfiguration}
  <FullScreenOverlay
    title="Configure Refloat"
    titleId="refloat-configuration-title"
    closeLabel="Done"
    fixedContent
    headerShadow
    onclose={closeRefloatConfiguration}
  >
    <RefloatConfigurationEditor controller={refloatConfiguration} />
  </FullScreenOverlay>
{/if}

{#if speedCalibrationOpen && connection?.deviceKind === 'board'}
  <FullScreenOverlay
    title="Calibrate speed"
    titleId="speed-calibration-title"
    closeLabel={['collecting', 'refining'].includes(backendState.snapshot?.speedCalibration.status ?? '')
      ? 'Close'
      : 'Done'}
    onclose={() => {
      speedCalibrationOpen = false;
    }}
  >
    <SpeedCalibration />
  </FullScreenOverlay>
{/if}

{#if refloatTunesOpen && connection?.refloatConfiguration}
  <FullScreenOverlay title="Tunes" titleId="refloat-tunes-title" closeLabel="Done" onclose={closeRefloatTunes}>
    <RefloatTunes {connection} />
  </FullScreenOverlay>
{/if}

<ConfirmDialog
  open={disconnectConfirmationOpen}
  titleId="disconnect-confirmation-title"
  title={endRideRequested ? 'End ride?' : 'Disconnect board?'}
  description={endRideRequested
    ? 'This will end the ride and disconnect the board. Reconnecting will start a new ride.'
    : connection?.trackingMode === 'saved'
      ? 'The board is not idle. This will disconnect the board. Your saved ride will remain available to resume.'
      : 'The board is not idle. This will disconnect the board.'}
  confirmLabel={endRideRequested ? 'End ride' : 'Disconnect'}
  appearance="destructive"
  busy={disconnecting}
  error={confirmationError}
  onconfirm={disconnect}
  oncancel={cancelDisconnect}
/>

<ConfirmDialog
  open={refloatConfirmation !== null}
  titleId="refloat-control-confirmation-title"
  title={refloatConfirmation?.title ?? 'Confirm Refloat control'}
  description={refloatConfirmation?.description ?? ''}
  confirmLabel={refloatConfirmation?.confirmLabel ?? 'Confirm'}
  appearance="warning"
  busy={backendState.busy}
  error={confirmationError}
  onconfirm={() => performRefloatControl()}
  oncancel={cancelRefloatConfirmation}
/>

<ConfirmDialog
  open={shutdownConfirmationOpen}
  titleId="controller-shutdown-confirmation-title"
  title={controllerShutdownConfirmation.title}
  description={controllerShutdownConfirmation.description}
  confirmLabel={controllerShutdownConfirmation.confirmLabel}
  appearance="destructive"
  busy={backendState.busy || connection?.controllerActions.pendingAction === 'shutdown'}
  error={confirmationError}
  onconfirm={performControllerShutdown}
  oncancel={cancelControllerShutdown}
/>

<!-- Keep the editor target alive while its overlay fades out. -->
{#each configuration ? [configuration] : [] as target (target.savedDeviceId)}
  <FullScreenOverlay
    title={target.batteryOnly ? 'Battery configuration' : 'Board configuration'}
    titleId="configure-overlay-title"
    onclose={closeConfigure}
  >
    <BoardEditor
      bind:this={editor}
      savedDeviceId={target.savedDeviceId}
      batteryOnly={target.batteryOnly}
      embedded
      onclose={closeConfigure}
    />
  </FullScreenOverlay>
{/each}

{#if connection?.state === 'selecting_controller'}
  <ControllerSelection {connection} ondisconnect={disconnect} />
{/if}

{#if flywheelOverlayVisible(connection)}
  <FlywheelModeOverlay
    busy={backendState.busy || connection?.refloatControls?.pendingAction === 'flywheel'}
    disabled={flywheelDisableUnavailable(connection)}
    error={flywheelError}
    ondisable={disableFlywheelMode}
  />
{/if}

{#if liveChartsOpen && !flywheelOverlayVisible(connection)}
  <LiveCharts {history} onclose={closeLiveCharts} />
{/if}

{#if faultHistoryOpen && !flywheelOverlayVisible(connection)}
  <FaultHistory onclose={closeFaultHistory} />
{/if}
