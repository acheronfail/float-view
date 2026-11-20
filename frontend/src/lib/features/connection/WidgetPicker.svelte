<script lang="ts">
  import { MAX_DASHBOARD_WIDGETS } from '$lib/backend/contract';
  import type { DashboardWidget, UnitPreference } from '$lib/backend/contract';
  import FullScreenOverlay from '$lib/ui/FullScreenOverlay.svelte';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import CustomWidget from './CustomWidget.svelte';
  import { pickerGroups } from './widget-catalog';
  import type { LiveHistory } from './live-history';
  import type { DashboardConnection } from './dashboard-preview';
  let {
    connection,
    history,
    units,
    nowMs,
    full,
    onchoose,
    onclose,
  }: {
    connection: DashboardConnection;
    history: LiveHistory;
    units: UnitPreference;
    nowMs: number;
    full: boolean;
    onchoose: (widget: DashboardWidget) => void;
    onclose: () => void;
  } = $props();
  let query = $state('');
  let browseAll = $state(false);
  const groups = $derived(pickerGroups(query, browseAll));
</script>

<FullScreenOverlay title="Add widget" titleId="add-widget-title" closeLabel="Cancel" {onclose}>
  <label class="mb-4 block text-sm font-semibold"
    >Find a value or widget
    <input
      type="search"
      maxlength="128"
      class="mt-2 min-h-11 w-full rounded-lg border border-outline bg-surface px-3"
      aria-label="Search widgets"
      placeholder="Search speed, battery, voltage…"
      bind:value={query}
    />
  </label>
  <p class="mb-4 text-sm text-muted">
    Choose a value for a simple 1 × 1 number. You can change its display and size before adding.
  </p>
  {#if full}<p role="status" class="mb-4 text-warning">
      Dashboard limit reached ({MAX_DASHBOARD_WIDGETS} widgets). Remove a widget first.
    </p>{/if}
  {#if !groups.length}<p role="status" class="py-6 text-center text-muted">
      No matching widgets. Try another value or clear the search.
    </p>{/if}
  {#each groups as group (group.name)}
    <section class="mb-6" aria-label={group.name}>
      <h3 class="mb-2 text-sm font-semibold">{group.name}</h3>
      <div class="grid gap-2 sm:grid-cols-2">
        {#each group.entries as entry (entry.widget.id)}
          <button
            type="button"
            class="flex min-h-24 w-full touch-pan-y items-center gap-3 rounded-xl border border-outline bg-surface p-3 text-left disabled:opacity-40"
            disabled={full}
            aria-label={entry.name}
            aria-describedby={`picker-${entry.widget.id}`}
            onpointerdown={(e) => activateFromPointer(e, () => onchoose(entry.widget))}
            onclick={(e) => activateFromKeyboardOrAssistiveClick(e, () => onchoose(entry.widget))}
          >
            <span class="min-w-0 flex-1"
              ><span class="block font-semibold">{entry.name}</span><span
                id={`picker-${entry.widget.id}`}
                class="mt-1 block text-xs text-muted">{entry.description}</span
              ></span
            >
            <div
              class="pointer-events-none size-18 shrink-0 overflow-hidden rounded-lg bg-canvas p-1"
              inert
              aria-hidden="true"
            >
              <CustomWidget widget={entry.widget} preview {connection} {history} {units} {nowMs} />
            </div>
          </button>
        {/each}
      </div>
      {#if group.name === 'Values' && !browseAll && !query.trim()}
        <button
          type="button"
          class="mt-2 min-h-11 touch-pan-y rounded-lg px-2 font-semibold text-accent"
          onpointerdown={(e) =>
            activateFromPointer(e, () => {
              browseAll = true;
            })}
          onclick={(e) =>
            activateFromKeyboardOrAssistiveClick(e, () => {
              browseAll = true;
            })}>Browse all values →</button
        >
      {/if}
    </section>
  {/each}
</FullScreenOverlay>
