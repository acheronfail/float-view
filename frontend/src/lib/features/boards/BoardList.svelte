<script lang="ts">
  import { backendState } from '$lib/backend/state.svelte';
  import { formatDistanceM } from '$lib/features/measurements/format';
  import { navigationLink } from '$lib/ui/navigation-link';
  import BoardIcon from './BoardIcon.svelte';

  const units = $derived(backendState.settings?.unitPreference ?? 'metric');

  function duration(milliseconds: number): string {
    const minutes = Math.round(milliseconds / 60_000);
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }
</script>

<section aria-label="Saved boards" class="flex flex-col gap-4">
  {#if backendState.savedDevices.length}
    <ul class="flex flex-col gap-2">
      {#each backendState.savedDevices as device (device.savedDeviceId)}
        <li>
          <a
            href={`#/sessions/boards/${encodeURIComponent(device.savedDeviceId)}`}
            use:navigationLink
            class="motion-feedback block min-w-0 touch-manipulation rounded-lg border border-outline bg-elevated p-3 transition-colors hover:border-accent hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:border-accent active:bg-accent-soft motion-reduce:transition-none"
          >
            <div class="flex min-w-0 items-center gap-2">
              <BoardIcon appearance={device.appearance} class="w-16 shrink-0" />
              <span class="min-w-0 flex-1 truncate font-semibold" title={device.displayName}>{device.displayName}</span>
            </div>
            <dl class="mt-2 grid grid-cols-3 gap-2 border-t border-outline pt-2 text-sm">
              <div class="min-w-0">
                <dt class="text-xs text-muted">Sessions</dt>
                <dd class="truncate font-medium tabular-nums" title={String(device.summary.sessionCount)}>
                  {device.summary.sessionCount}
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs text-muted">Riding time</dt>
                <dd class="truncate font-medium tabular-nums" title={duration(device.summary.totalRidingElapsedMs)}>
                  {duration(device.summary.totalRidingElapsedMs)}
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs text-muted">Distance</dt>
                <dd
                  class="truncate font-medium tabular-nums"
                  title={formatDistanceM(device.summary.totalDistanceM, units)}
                >
                  {formatDistanceM(device.summary.totalDistanceM, units)}
                </dd>
              </div>
            </dl>
          </a>
        </li>
      {/each}
    </ul>
  {:else if backendState.status === 'connected'}
    <p class="text-muted">Saved boards and their sessions will appear here. Guest rides are not saved or tracked.</p>
  {:else}
    <p class="text-muted">Loading saved boards…</p>
  {/if}
  {#if backendState.error}<p role="alert" class="text-warning">{backendState.error}</p>{/if}
</section>
