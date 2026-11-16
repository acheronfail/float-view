<script lang="ts">
  import { getContext, onDestroy, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { APP_HEADER_CONTEXT, type AppHeaderContext } from '$lib/app/header';
  import { UI_RESTORATION, type UiRestoration } from '$lib/app/ui-restoration.svelte';
  import { backendState } from '$lib/backend/state.svelte';
  import { defaultLiveWidgetSlots, type BoardProfile, type LiveWidgetField } from '$lib/backend/contract';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import CustomView from './CustomView.svelte';
  import LiveView from './LiveView.svelte';
  import LiveValueBox from './LiveValueBox.svelte';
  import { dashboardPreview, previewHistory, previewNowMs, type PreviewInteractions } from './dashboard-preview';

  let { savedDeviceId }: { savedDeviceId: string } = $props();
  const header = getContext<AppHeaderContext>(APP_HEADER_CONTEXT);
  const restoration = getContext<UiRestoration>(UI_RESTORATION);
  const owner = '/sessions/boards/[savedDeviceId]/views';
  const board = $derived(backendState.savedDevices.find((b) => b.savedDeviceId === savedDeviceId));
  const boardHref = $derived(`#/sessions/boards/${encodeURIComponent(savedDeviceId)}`);
  let view = $state<'normal' | 'custom'>('normal');
  let profile = $state<BoardProfile | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let custom = $state<CustomView>();
  let generation = 0;
  const exampleLights = $state({ headlights: false, leds: true });
  const previewInteractions: PreviewInteractions = {
    lighting: exampleLights,
    toggleLighting(control) {
      exampleLights[control] = !exampleLights[control];
    },
  };
  const slots = $derived(profile?.values.liveWidgetSlots ?? defaultLiveWidgetSlots);
  const preview = $derived({ ...dashboardPreview(savedDeviceId), liveWidgetSlots: slots });

  $effect(() => {
    header.set(owner, {
      title: board?.displayName ?? 'Board',
      titleClass: 'truncate text-3xl font-semibold',
      subtitle: `${view === 'custom' ? 'Custom View' : 'Live View'} · Preview values`,
      bottomBorder: false,
      backHref: boardHref,
      backLabel: 'Board',
      backInMenu: true,
      menuLabel: 'View options',
      menu: [
        {
          label: view === 'custom' ? 'Switch to Live View' : 'Switch to Custom View',
          disabled: loading || !profile,
          onactivate: async (closeMenu) => {
            closeMenu();
            await selectView(view === 'custom' ? 'normal' : 'custom');
          },
        },
        {
          label: 'Back',
          onactivate: async (closeMenu) => {
            closeMenu();
            if (!custom || (await custom.requestLeave())) finish();
          },
        },
      ],
    });
    // Recreated frontends return to the board; no preview or draft is replayed.
    restoration.present(boardHref, null, null);
  });
  onDestroy(() => header.clear(owner));
  $effect(() => {
    const id = savedDeviceId;
    void load(id);
    return () => {
      generation++;
    };
  });
  $effect(() => {
    if (backendState.status === 'connected' && !board)
      void tick().then(() => goto('#/sessions', { replaceState: true }));
  });

  async function load(id: string) {
    const current = ++generation;
    loading = true;
    error = null;
    try {
      const result = await backendState.readBoardProfile(id);
      if (current === generation) {
        profile = result;
        view = result.values.lastLiveView === 'custom' ? 'custom' : 'normal';
      }
    } catch (e) {
      if (current === generation) error = e instanceof Error ? e.message : 'Could not load views. Try again.';
    } finally {
      if (current === generation) loading = false;
    }
  }
  async function selectView(next: 'normal' | 'custom') {
    if (next === view || (custom && !(await custom.requestLeave()))) return;
    view = next;
  }
  async function selectSlot(slot: number, field: LiveWidgetField) {
    const current = generation;
    const result = await backendState.saveLiveWidgetSlot(savedDeviceId, slot, field);
    if (current === generation) profile = result;
  }
  function finish() {
    void goto(boardHref);
  }
</script>

<section aria-label="Customise board views" class="relative flex h-full min-h-0 flex-1 flex-col gap-2">
  {#if loading}<p role="status" class="text-sm text-muted">Loading views…</p>{/if}
  {#if error}
    <div role="alert" class="text-sm text-warning">
      <p>{error}</p>
      <button
        type="button"
        class="min-h-11 touch-manipulation underline"
        onpointerdown={(e) => activateFromPointer(e, () => load(savedDeviceId))}
        onclick={(e) => activateFromKeyboardOrAssistiveClick(e, () => load(savedDeviceId))}>Retry loading</button
      >
    </div>
  {/if}
  {#if board && profile && !loading}
    <p class="sr-only">
      {view === 'normal'
        ? 'Hold a box to configure it. Choices save automatically.'
        : 'Hold a widget or the background to arrange your dashboard.'}
    </p>
    {#if view === 'custom'}
      <CustomView
        bind:this={custom}
        connection={preview}
        history={previewHistory}
        nowMs={previewNowMs}
        {previewInteractions}
      />
    {:else}
      <LiveView presentation={preview} nowMs={previewNowMs}>
        {#snippet boxes()}
          <div class="grid grid-cols-4 gap-1.5" aria-label="Live number widgets">
            {#each [0, 1, 2, 3] as slot (slot)}
              <LiveValueBox
                sample={preview.latestSample}
                {slot}
                previewSlots={slots}
                {previewInteractions}
                onselect={selectSlot}
              />
            {/each}
          </div>
        {/snippet}
        {#snippet centre()}
          <div>
            <LiveValueBox
              sample={preview.latestSample}
              slot={4}
              previewSlots={slots}
              {previewInteractions}
              onselect={selectSlot}
            />
          </div>
        {/snippet}
      </LiveView>
    {/if}
  {/if}
</section>
