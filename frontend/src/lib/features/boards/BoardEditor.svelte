<script lang="ts">
  import SegmentedControl from '$lib/ui/SegmentedControl.svelte';
  import { getContext, onDestroy, onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { APP_HEADER_CONTEXT, type AppHeaderContext } from '$lib/app/header';
  import { backendState } from '$lib/backend/state.svelte';
  import BatteryFields from './BatteryFields.svelte';
  import BoardAppearanceEditor from './BoardAppearanceEditor.svelte';
  import BoardIcon from './BoardIcon.svelte';
  import FullScreenOverlay from '$lib/ui/FullScreenOverlay.svelte';
  import { defaultBoardAppearance, type BoardAppearance } from '$lib/backend/contract';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import Icon from '$lib/ui/Icon.svelte';
  import ToggleIndicator from '$lib/ui/ToggleIndicator.svelte';
  import { normalizedCustomName, SerialSaveQueue, validPreferredCanId } from './autosave';
  import { motorOptions } from './motor-options';

  let {
    savedDeviceId,
    embedded = false,
    batteryOnly = false,
    onclose,
  }: { savedDeviceId: string; embedded?: boolean; batteryOnly?: boolean; onclose?: () => void } = $props();
  let customDisplayName = $state('');
  let seriesCount = $state<number | undefined>();
  let parallelCount = $state<number | undefined>();
  let batteryCellProfileId = $state('');
  let batteryPresetId = $state('');
  let batteryCapacityAh = $state<number | undefined>();
  let pendingSaves = $state(0);
  let batteryFields = $state<BatteryFields | undefined>();
  let batteryMinimumCellVoltageV = $state<number | undefined>();
  let motor = $state('');
  let appearance = $state<BoardAppearance>({ ...defaultBoardAppearance });
  let appearanceOpen = $state(false);
  const appearanceTitleId = $props.id();
  let appearanceDialog: HTMLDialogElement | undefined;
  let appearanceButton = $state<HTMLButtonElement>();
  let appearanceQueued = false;
  let preferredCanId = $state<number | undefined>();
  let preferredBmsCanId = $state<number | undefined>();
  const appHeader = getContext<AppHeaderContext>(APP_HEADER_CONTEXT);
  const headerOwner = '/sessions/boards/[savedDeviceId]';
  const saveQueue = new SerialSaveQueue();
  let active = false;
  let loaded = $state(false);
  let autoConnectBusy = $state(false);
  let autoConnectError = $state<string | null>(null);
  let appearanceError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  let failedPatch: Record<string, unknown> = {};
  let discardDrafts = false;

  const device = $derived(backendState.savedDevices.find((value) => value.savedDeviceId === savedDeviceId));
  let name = $derived(
    (customDisplayName.length ? customDisplayName : (device?.advertisedName ?? device?.bluetoothIdentifier)) ?? 'Board'
  );

  $effect(() => {
    if (embedded) return;
    appHeader.set(headerOwner, {
      title: name,
      backHref: '#/sessions',
      backLabel: 'Sessions',
    });
  });
  onDestroy(() => {
    if (!embedded) appHeader.clear(headerOwner);
  });

  onMount(() => {
    active = true;
    void loadProfile();
    return () => {
      active = false;
      backendState.closeBoardProfile();
    };
  });

  function loadProfile() {
    return backendState.openBoardProfile(savedDeviceId).then((opened) => {
      if (!active) return;
      if (!opened) {
        if (!backendState.boardProfileNotFound) return;
        if (embedded) onclose?.();
        else void goto('#/sessions', { replaceState: true });
        return;
      }
      loaded = true;
      customDisplayName = device?.customDisplayName ?? '';
      const values = backendState.selectedBoardProfile?.values;
      appearance = { ...(values?.appearance ?? defaultBoardAppearance) };
      seriesCount = typeof values?.seriesCount === 'number' ? values.seriesCount : undefined;
      parallelCount = typeof values?.parallelCount === 'number' ? values.parallelCount : undefined;
      batteryCellProfileId = values?.batteryCellProfileId ?? '';
      batteryPresetId = values?.batteryPresetId ?? '';
      batteryCapacityAh = values?.batteryCapacityAh ?? undefined;
      batteryMinimumCellVoltageV = values?.batteryMinimumCellVoltageV ?? undefined;
      motor = typeof values?.motor === 'string' ? values.motor : '';
      preferredCanId = typeof values?.preferredCanId === 'number' ? values.preferredCanId : undefined;
      preferredBmsCanId = typeof values?.preferredBmsCanId === 'number' ? values.preferredBmsCanId : undefined;
    });
  }

  function enqueue(action: () => Promise<void>) {
    const ownerId = savedDeviceId;
    saveQueue.enqueue(async () => {
      if (
        !active ||
        !loaded ||
        savedDeviceId !== ownerId ||
        !device ||
        backendState.selectedBoardProfile?.savedDeviceId !== savedDeviceId
      )
        return;
      await action();
    });
  }

  async function toggleAutoConnect() {
    if (autoConnectBusy || backendState.busy || !device?.bluetoothIdentifier) return;
    autoConnectBusy = true;
    const selected = backendState.settings?.autoConnectSavedDeviceId === savedDeviceId;
    const saved = await backendState.updateSessionSettings({
      autoConnectSavedDeviceId: selected ? null : savedDeviceId,
    });
    autoConnectBusy = false;
    autoConnectError = saved ? null : (backendState.error ?? 'Auto-connect could not be saved. Try again.');
  }

  function saveName() {
    const next = normalizedCustomName(customDisplayName);
    if (next === (device?.customDisplayName ?? null)) return;
    enqueue(async () => {
      pendingSaves++;
      const saved = await backendState.updateSavedDeviceName(savedDeviceId, next);
      pendingSaves--;
      if (!active) return;
      if (saved) {
        delete failedPatch.customDisplayName;
        if (!Object.keys(failedPatch).length) saveError = null;
      } else {
        failedPatch.customDisplayName = next;
        saveError = backendState.error ?? 'The name could not be saved. Please try again.';
      }
    });
  }

  function saveProfile(patch: Record<string, unknown>) {
    enqueue(() => persistProfile(patch));
  }

  function openAppearance() {
    appearanceOpen = true;
  }

  function mountAppearanceDialog(node: HTMLDialogElement) {
    appearanceDialog = node;
    node.showModal();
    return {
      destroy() {
        node.close();
        appearanceDialog = undefined;
      },
    };
  }

  async function closeAppearance() {
    await saveQueue.flush();
    appearanceDialog?.close();
    appearanceOpen = false;
    await tick();
    appearanceButton?.focus();
  }

  function saveAppearance(next: BoardAppearance) {
    appearanceError = null;
    appearance = next;
    if (appearanceQueued) return;
    appearanceQueued = true;
    enqueue(async () => {
      appearanceQueued = false;
      await persistProfile({ appearance });
    });
  }

  async function persistProfile(patch: Record<string, unknown>) {
    pendingSaves++;
    const saved = await backendState.updateBoardProfile(savedDeviceId, patch);
    pendingSaves--;
    if (!active) return;
    if (saved) {
      if (patch.appearance) appearanceError = null;
      if (patch.batteryPresetId) {
        for (const key of [
          'batteryPresetId',
          'seriesCount',
          'parallelCount',
          'batteryCellProfileId',
          'batteryCapacityAh',
          'batteryMinimumCellVoltageV',
        ])
          delete failedPatch[key];
      }
      for (const key of Object.keys(patch)) delete failedPatch[key];
      if (!Object.keys(failedPatch).length) saveError = null;
    } else {
      Object.assign(failedPatch, patch);
      saveError = backendState.error ?? 'Settings could not be saved. Please try again.';
      if (patch.appearance) appearanceError = saveError;
    }
  }

  async function discardFailedChanges() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await tick();
    await saveQueue.flush();
    failedPatch = {};
    saveError = null;
    discardDrafts = true;
    onclose?.();
  }

  export async function flush() {
    await saveQueue.flush();
    if (!saveError && !discardDrafts) batteryFields?.flushDrafts();
    await saveQueue.flush();
    return saveError === null;
  }
</script>

<section aria-label={batteryOnly ? 'Battery settings' : 'Board settings'}>
  {#if loaded && backendState.selectedBoardProfile?.savedDeviceId === savedDeviceId && device}
    {#if !batteryOnly}
      <button
        bind:this={appearanceButton}
        type="button"
        aria-haspopup="dialog"
        class="mt-3 flex w-full touch-pan-y items-center gap-4 rounded-xl border border-outline bg-elevated px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onpointerdown={(event) => activateFromPointer(event, openAppearance, { scrollable: true })}
        onclick={(event) => activateFromKeyboardOrAssistiveClick(event, openAppearance)}
      >
        <span aria-hidden="true" class="shrink-0"><BoardIcon {appearance} class="block w-24" /></span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-medium">Board appearance</span>
          <span class="block text-xs text-muted">Tap to customise</span>
        </span>
        <Icon name="sliders-horizontal" class="shrink-0 text-xl text-muted" />
      </button>
    {/if}
    {#if !batteryOnly && backendState.selectedBoardProfile.missingFields.length}
      <p class="mt-3 text-sm text-warning">
        <Icon name="triangle-alert" class="mr-1 text-xl" />
        Missing: {backendState.selectedBoardProfile.missingFields.join(', ')}
      </p>
    {/if}
    {#if batteryOnly}
      <p class="text-sm text-muted">Set up your battery for a more accurate charge estimate.</p>
    {/if}
    {#if backendState.snapshot?.activeConnection?.savedDeviceId === savedDeviceId && backendState.snapshot.activeConnection.batteryEstimate.unavailableReason === 'series_mismatch'}
      <p role="status" class="mt-3 text-sm text-warning">
        Battery setup mismatch. The controller reports {backendState.snapshot.activeConnection.currentLimits
          ?.batterySeriesCells ?? 'an unknown number of'} series cells. Choose the matching battery or correct the series
        count in Advanced. Battery percentage is unavailable until the counts match.
      </p>
    {/if}
    <div class="mt-4 grid gap-3 sm:grid-cols-2">
      {#if !batteryOnly}
        <div class="text-sm sm:col-span-2">
          <button
            type="button"
            role="switch"
            aria-checked={backendState.settings?.autoConnectSavedDeviceId === savedDeviceId}
            aria-describedby="auto-connect-help"
            disabled={!device.bluetoothIdentifier || autoConnectBusy || backendState.busy}
            class="flex w-full touch-pan-y items-center justify-between gap-3 rounded-md py-2 text-left disabled:opacity-50"
            onpointerdown={(event) => activateFromPointer(event, toggleAutoConnect, { scrollable: true })}
            onclick={(event) => activateFromKeyboardOrAssistiveClick(event, toggleAutoConnect)}
          >
            <span>Connect automatically</span>
            <ToggleIndicator checked={backendState.settings?.autoConnectSavedDeviceId === savedDeviceId} />
          </button>
          <p id="auto-connect-help" class="text-xs text-muted">
            {#if device.bluetoothIdentifier}
              Connect to this board when you open the app. Only one board can auto-connect at a time.
            {:else}
              Connect to this board locally before enabling auto-connect.
            {/if}
          </p>
          {#if autoConnectError}<p role="alert" class="mt-1 text-warning">{autoConnectError}</p>{/if}
        </div>
        <label class="text-sm sm:col-span-2">
          <span class="mb-1 block text-muted">Display name</span>
          <input
            class="w-full rounded-md border border-outline bg-elevated px-3 py-2"
            type="text"
            maxlength="128"
            bind:value={customDisplayName}
            placeholder={device.advertisedName ?? device.bluetoothIdentifier ?? 'Board'}
            onblur={saveName}
          />
        </label>
        <label class="text-sm sm:col-span-2">
          <span class="mb-1 block text-muted">Preferred BMS CAN ID (optional)</span>
          <input
            class="w-full rounded-md border border-outline bg-elevated px-3 py-2"
            type="number"
            min="0"
            max="253"
            inputmode="numeric"
            bind:value={preferredBmsCanId}
            aria-describedby="preferred-bms-can-help"
            onblur={() => {
              if (preferredBmsCanId === undefined) saveProfile({ preferredBmsCanId: null });
              else if (validPreferredCanId(preferredBmsCanId)) saveProfile({ preferredBmsCanId });
            }}
          />
          <span id="preferred-bms-can-help" class="mt-1 block text-xs text-muted">
            Applies immediately to BMS discovery only. Leave blank to resume automatic BMS selection.
          </span>
          {#if preferredBmsCanId !== undefined && !validPreferredCanId(preferredBmsCanId)}
            <span role="alert" class="mt-1 block text-xs text-warning"> Enter a whole CAN ID from 0 to 253. </span>
          {/if}
        </label>
        <label class="text-sm sm:col-span-2">
          <span class="mb-1 block text-muted">Preferred CAN ID (optional)</span>
          <input
            class="w-full rounded-md border border-outline bg-elevated px-3 py-2"
            type="number"
            min="0"
            max="253"
            inputmode="numeric"
            bind:value={preferredCanId}
            aria-describedby="preferred-can-help"
            onblur={() => {
              if (preferredCanId === undefined) saveProfile({ preferredCanId: null });
              else if (validPreferredCanId(preferredCanId)) saveProfile({ preferredCanId });
            }}
          />
          <span id="preferred-can-help" class="mt-1 block text-xs text-muted">
            Used on the next VESC Express connection. Leave blank for automatic discovery.
          </span>
          {#if preferredCanId !== undefined && !validPreferredCanId(preferredCanId)}
            <span role="alert" class="mt-1 block text-xs text-warning"> Enter a whole CAN ID from 0 to 253. </span>
          {/if}
        </label>
        <dl class="py-1 text-sm sm:col-span-2">
          <dt class="text-muted">Bluetooth identifier</dt>
          <dd class="mt-1">
            {#if device.bluetoothIdentifier}
              <code class="break-all text-foreground select-text">{device.bluetoothIdentifier}</code>
            {:else}
              <span class="text-muted">Not locally associated</span>
            {/if}
          </dd>
        </dl>
      {/if}
      <BatteryFields
        bind:this={batteryFields}
        savedValues={backendState.selectedBoardProfile.values}
        bind:seriesCount
        bind:parallelCount
        bind:batteryPresetId
        bind:batteryCapacityAh
        presets={backendState.snapshot?.batteryPresets ?? []}
        bind:batteryCellProfileId
        bind:batteryMinimumCellVoltageV
        profiles={backendState.snapshot?.batteryCellProfiles ?? []}
        {saveProfile}
      />
      {#if !batteryOnly}
        <div class="text-sm sm:col-span-2">
          <span class="mb-1 block text-muted">Motor</span>
          <SegmentedControl
            label="Motor"
            options={motorOptions}
            value={motor}
            onchange={(value) => {
              motor = value;
              if (motor) saveProfile({ motor });
            }}
          />
        </div>
      {/if}
    </div>
  {:else}
    <p class="text-muted">Loading board configuration…</p>
  {/if}
  {#if pendingSaves}
    <p role="status" class="mt-3 text-sm text-muted">Saving settings…</p>
  {/if}
  {#if saveError}
    <p role="alert" class="mt-3 text-warning">{saveError}</p>
    {#if embedded}
      <button
        type="button"
        class="mt-2 touch-manipulation rounded border border-outline px-3 py-2 text-sm"
        onpointerdown={(event) => activateFromPointer(event, discardFailedChanges)}
        onclick={(event) => activateFromKeyboardOrAssistiveClick(event, discardFailedChanges)}
      >
        Close without saving failed changes
      </button>
    {/if}
  {:else if backendState.error && !autoConnectError}
    <p role="alert" class="mt-3 text-warning">{backendState.error}</p>
    <button
      type="button"
      class="mt-3 touch-manipulation rounded-lg bg-elevated px-4 py-2"
      onpointerdown={(event) => activateFromPointer(event, loadProfile)}
      onclick={(event) => activateFromKeyboardOrAssistiveClick(event, loadProfile)}>Retry</button
    >
  {/if}
</section>

{#if appearanceOpen}
  <dialog
    use:mountAppearanceDialog
    aria-label="Customise board appearance"
    class="m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-canvas p-0 text-foreground"
    oncancel={(event) => {
      event.preventDefault();
      void closeAppearance();
    }}
  >
    <FullScreenOverlay title="Board appearance" titleId={appearanceTitleId} fixedContent onclose={closeAppearance}>
      <div class="flex h-full min-h-0 flex-col">
        <div class="min-h-0 flex-1 overflow-y-auto py-3">
          <BoardAppearanceEditor value={appearance} onchange={saveAppearance} />
        </div>
        {#if appearanceError}
          <div class="shrink-0 border-t border-outline bg-canvas py-3">
            <p role="alert" class="text-sm text-warning">{appearanceError}</p>
            <button
              type="button"
              class="mt-2 touch-manipulation rounded border border-outline px-3 py-2 text-sm"
              disabled={pendingSaves > 0}
              onpointerdown={(event) => activateFromPointer(event, () => saveAppearance(appearance))}
              onclick={(event) => activateFromKeyboardOrAssistiveClick(event, () => saveAppearance(appearance))}
              >Retry save</button
            >
          </div>
        {/if}
      </div>
    </FullScreenOverlay>
  </dialog>
{/if}
