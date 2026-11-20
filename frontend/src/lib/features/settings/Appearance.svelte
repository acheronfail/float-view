<script lang="ts">
  import { backendState } from '$lib/backend/state.svelte';
  import SegmentedControl from '$lib/ui/SegmentedControl.svelte';
  import { accentPresets } from '$lib/app/theme';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import type { ThemePreference, UnitPreference } from '$lib/backend/contract';
</script>

{#if backendState.settings}
  <div>
    <div class="mt-5 space-y-2 text-sm text-muted">
      <p>Theme</p>
      <SegmentedControl
        label="Theme"
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        value={backendState.settings.themePreference}
        onchange={(themePreference: ThemePreference) => backendState.updateSessionSettings({ themePreference })}
      />
    </div>
    <div class="mt-5 space-y-2 text-sm text-muted">
      <p>Accent color</p>
      <div role="group" aria-label="Accent color" class="flex flex-wrap justify-center gap-2 py-1">
        {#each accentPresets as preset (preset.value)}
          <button
            type="button"
            aria-label={preset.label}
            title={preset.label}
            aria-pressed={backendState.settings.accentPreference === preset.value}
            class="flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-full border-2 border-transparent p-1 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:border-foreground"
            onpointerdown={(event) =>
              activateFromPointer(event, () => {
                void backendState.updateSessionSettings({ accentPreference: preset.value });
              })}
            onclick={(event) =>
              activateFromKeyboardOrAssistiveClick(event, () => {
                void backendState.updateSessionSettings({ accentPreference: preset.value });
              })}
          >
            <span
              aria-hidden="true"
              class="flex size-full items-center justify-center rounded-full"
              style:background={`var(--app-accent-${preset.value})`}
              style:color={`var(--app-on-accent-${preset.value})`}
            >
              {#if backendState.settings.accentPreference === preset.value}
                <svg
                  viewBox="0 0 24 24"
                  class="size-5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="m6 12 4 4 8-8" />
                </svg>
              {/if}
            </span>
          </button>
        {/each}
      </div>
    </div>
    <div class="mt-5 space-y-2 text-sm text-muted">
      <p>Units</p>
      <SegmentedControl
        label="Units"
        options={[
          { value: 'metric', label: 'Metric' },
          { value: 'imperial', label: 'Imperial' },
        ]}
        value={backendState.settings.unitPreference}
        onchange={(unitPreference: UnitPreference) => backendState.updateSessionSettings({ unitPreference })}
      />
    </div>
  </div>
{/if}
