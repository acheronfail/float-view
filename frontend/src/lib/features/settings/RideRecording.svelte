<script lang="ts">
  import { backendState } from '$lib/backend/state.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import SectionTitle from '$lib/ui/SectionTitle.svelte';
  import OnOffSetting from './OnOffSetting.svelte';
  import RideContinuity from './RideContinuity.svelte';
  import { navigationLink } from '$lib/ui/navigation-link';
  const inputClass = 'mt-1 block w-full rounded-lg border border-outline bg-elevated px-3 py-2 text-foreground';
</script>

{#if backendState.settings}
  <section aria-label="Ride recording">
    <SectionTitle title="Recording preferences" />

    <div class="mt-3 space-y-2">
      <OnOffSetting
        label="Record ride location"
        checked={backendState.settings.locationRecordingEnabled}
        onchange={(locationRecordingEnabled) => backendState.updateSessionSettings({ locationRecordingEnabled })}
      />
      <p class="text-xs text-muted">Save your route alongside ride readings.</p>
      <a
        href="#/settings/connection"
        use:navigationLink
        aria-label="Location permissions"
        class="flex min-h-14 items-center justify-between gap-3 border-b border-outline py-3 text-sm hover:bg-elevated"
      >
        <span
          ><span class="block font-medium">Location permissions</span><span class="mt-1 block text-xs text-muted"
            >Connection &amp; permissions</span
          ></span
        >
        <Icon name="chevron-right" class="size-5 shrink-0 text-muted" />
      </a>
    </div>
    <div class="mt-5"><RideContinuity /></div>
    <details class="advanced-recording mt-6">
      <summary
        class="sticky z-10 flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 border-b border-accent-soft bg-canvas py-2 font-mono text-sm font-semibold tracking-[0.10em] text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        style="top: var(--section-header-top, 0px)"
      >
        <span>Advanced recording</span>
        <Icon name="chevron-right" class="disclosure-arrow size-6 shrink-0 text-2xl" />
      </summary>
      <p class="mt-2 text-sm text-muted">Adjust recording detail and how gaps appear in charts.</p>

      <label class="mt-5 block text-sm text-muted">
        Minimum ride distance (meters)
        <input
          class={inputClass}
          type="number"
          inputmode="numeric"
          min="0"
          max="1000000"
          step="10"
          value={backendState.settings.minimumSessionDistance}
          onchange={(event) =>
            backendState.updateSessionSettings({
              minimumSessionDistance: Number(event.currentTarget.value),
            })}
        />
      </label>
      <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="text-sm text-muted"
          >Idle samples / second
          <input
            class={inputClass}
            type="number"
            inputmode="decimal"
            min="0.0167"
            max="10"
            step="0.1"
            value={1000 / backendState.settings.idlePersistIntervalMs}
            onchange={(event) =>
              backendState.updateSessionSettings({
                idlePersistIntervalMs: Math.round(1000 / Math.max(0.0167, Number(event.currentTarget.value))),
              })}
          />
        </label>
        <label class="text-sm text-muted"
          >Riding samples / second
          <input
            class={inputClass}
            type="number"
            inputmode="decimal"
            min="0.1"
            max="20"
            step="1"
            value={1000 / backendState.settings.ridingPersistIntervalMs}
            onchange={(event) =>
              backendState.updateSessionSettings({
                ridingPersistIntervalMs: Math.round(1000 / Math.max(0.1, Number(event.currentTarget.value))),
              })}
          />
        </label>
        <label class="text-sm text-muted"
          >Ride detection checks / second
          <input
            class={inputClass}
            type="number"
            inputmode="decimal"
            min="0.1"
            max="10"
            step="0.5"
            value={1000 / backendState.settings.idleProbeIntervalMs}
            onchange={(event) =>
              backendState.updateSessionSettings({
                idleProbeIntervalMs: Math.round(1000 / Math.max(0.1, Number(event.currentTarget.value))),
              })}
          />
        </label>
        <label class="text-sm text-muted"
          >Keep detailed recording after a ride (seconds)
          <input
            class={inputClass}
            type="number"
            inputmode="numeric"
            min="0"
            max="300"
            step="1"
            value={backendState.settings.postRideTailMs / 1000}
            onchange={(event) =>
              backendState.updateSessionSettings({
                postRideTailMs: Math.round(Number(event.currentTarget.value) * 1000),
              })}
          />
        </label>
      </div>
      <label class="mt-3 block text-sm text-muted">
        Chart gap length (seconds)
        <input
          class={inputClass}
          type="number"
          inputmode="decimal"
          min="0.1"
          max="3600"
          step="0.1"
          placeholder="Automatic"
          value={backendState.settings.historyGapThresholdSeconds ?? ''}
          aria-describedby="history-gap-help"
          onchange={(event) => {
            const value = event.currentTarget.value.trim();
            const seconds = Number(value);
            backendState.updateSessionSettings({
              historyGapThresholdSeconds:
                value === '' || !Number.isFinite(seconds) ? null : Math.max(0.1, Math.min(3600, seconds)),
            });
          }}
        />
        <span id="history-gap-help" class="mt-1 block text-xs">Leave on Automatic for easy setup.</span>
      </label>
    </details>
  </section>
{/if}

<style>
  summary::-webkit-details-marker {
    display: none;
  }
  .advanced-recording[open] :global(.disclosure-arrow) {
    transform: rotate(90deg);
  }
</style>
