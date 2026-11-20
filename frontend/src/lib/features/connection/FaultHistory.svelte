<script lang="ts">
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import { untrack } from 'svelte';
  import { loadFaultsAndErrors } from '$lib/features/faults/session-faults';
  import { faultLabel, type RideFault } from '$lib/features/faults/faults';
  import FullScreenOverlay from '$lib/ui/FullScreenOverlay.svelte';
  import { backendState } from '$lib/backend/state.svelte';
  import FaultList from '$lib/features/faults/FaultList.svelte';
  import { fatalErrorClearUnavailableReason } from './live';
  import { firmwareFaultWarning } from './live-status';
  let { onclose }: { onclose: () => void } = $props();
  const connection = $derived(backendState.snapshot?.activeConnection);
  const sample = $derived(connection?.latestSample);
  let recorded = $state<RideFault[] | null>(null);
  let error = $state('');
  let retry = $state(0);
  let recordedSession: string | undefined;
  const sessionId = $derived(connection?.activeSession?.sessionId);
  const version = $derived(connection?.activeSession?.eventCount ?? sample?.faultHistory?.at(-1)?.observedElapsedMs);
  $effect(() => {
    void retry;
    const id = sessionId;
    void version;
    if (recordedSession !== id) {
      recorded = null;
      recordedSession = id;
    }
    if (!id) {
      recorded = null;
      return;
    }
    let active = true;
    let controller: ReturnType<typeof backendState.createSessionReviewController> | undefined;
    error = '';
    untrack(() => {
      void backendState
        .readSessionMetadata(id)
        .then(async (metadata) => {
          if (!active) return;
          controller = backendState.createSessionReviewController(metadata);
          const faults = await loadFaultsAndErrors(controller, metadata);
          if (active) recorded = faults;
        })
        .catch((reason) => {
          if (active) error = reason instanceof Error ? reason.message : 'History could not be loaded.';
        });
    });
    return () => {
      active = false;
      controller?.dispose();
    };
  });
  const faults = $derived(
    recorded ??
      (sessionId
        ? []
        : [
            ...(sample?.faultHistory ?? []),
            ...(sample?.imuTimeoutHistory ?? []).map((entry) => ({
              reason: entry.active ? 'imuTimeout' : 'imuTimeoutCleared',
              code: null,
              elapsedMs: entry.elapsedMs,
              observedElapsedMs: entry.observedElapsedMs,
            })),
          ].sort((a, b) => (a.elapsedMs ?? a.observedElapsedMs) - (b.elapsedMs ?? b.observedElapsedMs)))
  );
  const warning = $derived(firmwareFaultWarning(sample));
  const reason = $derived(sample?.firmwareFault ?? sample?.lastFirmwareFault?.reason);
  const latched = $derived(
    sample?.fatalErrorLatched === true || connection?.refloatControls?.fatalErrorLatched === true
  );
  const clearing = $derived(connection?.refloatControls?.pendingAction === 'clearFatalError');
  const clearUnavailable = $derived(fatalErrorClearUnavailableReason(connection));
  let clearError = $state('');
  async function clearLatch() {
    if (clearUnavailable || backendState.busy) return;
    clearError = '';
    if (!(await backendState.clearRefloatFatalError()))
      clearError = backendState.error ?? 'The latch could not be cleared. Try again.';
  }
</script>

<FullScreenOverlay title="Faults and errors" titleId="fault-history-title" {onclose}>
  <div class="mx-auto w-full max-w-2xl space-y-4 p-4">
    {#if sample?.imuTimeoutActive}<div role="alert" class="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm">
        IMU timeout active. Step off the board.
      </div>{/if}
    {#if warning}
      <div role="status" class="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm">
        <p class="font-semibold text-danger">
          {sample?.firmwareFault ? 'Controller fault active' : 'Fatal error latched'}
        </p>
        {#if reason}<p class="mt-1 font-medium">{faultLabel(reason, sample?.lastFirmwareFault?.code ?? null)}</p>{/if}
        <p class="mt-1">{warning.description}</p>
        {#if latched}
          <button
            type="button"
            class="mt-3 min-h-11 touch-manipulation rounded-lg border border-danger px-3 py-2 font-semibold text-danger disabled:opacity-50"
            disabled={clearUnavailable !== null || backendState.busy}
            aria-describedby={clearUnavailable ? 'fault-clear-unavailable' : undefined}
            aria-busy={clearing || undefined}
            onpointerdown={(event) => activateFromPointer(event, clearLatch)}
            onclick={(event) => activateFromKeyboardOrAssistiveClick(event, clearLatch)}
            >{clearing ? 'Clearing…' : 'Clear fatal error'}</button
          >
          {#if clearUnavailable && !clearing}<p id="fault-clear-unavailable" class="mt-2">{clearUnavailable}</p>{/if}
          <p class="mt-2 text-xs text-muted">
            Clearing resets the latch. It does not fix the cause or erase fault history.
          </p>
          {#if clearError}<p role="alert" class="mt-2 text-danger">{clearError}</p>{/if}
        {/if}
      </div>
    {/if}
    <p class="text-sm text-muted">
      Recent faults and errors from this ride. Times are approximate; older events may have no ride time.
    </p>
    {#if error}<p role="alert" class="text-sm text-danger">{error}</p>
      <button
        type="button"
        class="min-h-11 touch-manipulation rounded border border-outline px-3 text-sm"
        onpointerdown={(e) =>
          activateFromPointer(e, () => {
            retry++;
          })}
        onclick={(e) =>
          activateFromKeyboardOrAssistiveClick(e, () => {
            retry++;
          })}>Retry</button
      >{/if}
    {#if faults.length}
      <FaultList faults={[...faults].reverse()} />
      {#if !sessionId}<p class="text-xs text-muted">
          Guest history keeps the 20 most recent firmware faults and IMU timeout transitions.
        </p>{/if}
    {:else if sessionId && recorded === null && !error}
      <p class="py-6 text-center text-muted" role="status">Loading history…</p>
    {:else if !error}
      <p class="py-6 text-center text-muted">
        {warning || sample?.imuTimeoutActive ? 'No details recorded for this ride.' : 'No faults or errors recorded.'}
      </p>
    {/if}
  </div>
</FullScreenOverlay>
