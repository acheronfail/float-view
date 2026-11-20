<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import { createMotion } from '$lib/ui/motion';
  import { backDismissal } from '$lib/ui/back-dismissal';
  import { backendState } from '$lib/backend/state.svelte';
  import { ApiRequestError } from '$lib/backend/client';
  import {
    MAX_DASHBOARD_WIDGETS,
    type CustomDashboard,
    type DashboardWidget,
    type BoardProfile,
  } from '$lib/backend/contract';
  import { validCustomDashboard, dashboardDimensions } from '$lib/backend/custom-dashboard';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import WidgetConfiguration from './WidgetConfiguration.svelte';
  import CustomWidget from './CustomWidget.svelte';
  import WidgetPicker from './WidgetPicker.svelte';
  import { defaultDashboard, moveWidget, widgetTitle, type DashboardGridGeometry } from './custom-dashboard';
  import { dashboardGesture } from './dashboard-gesture';
  import { dashboardBackgroundGesture } from './dashboard-background-gesture';
  import type { LiveHistory } from './live-history';
  import type { DashboardConnection, PreviewInteractions } from './dashboard-preview';

  let {
    connection,
    history,
    nowMs,
    previewInteractions,
  }: {
    connection: DashboardConnection;
    history: LiveHistory;
    nowMs: number;
    previewInteractions?: PreviewInteractions;
  } = $props();
  const { appear: appearSurface, exit: exitSurface } = createMotion();
  const boardId = $derived(connection.savedDeviceId);
  const units = $derived(backendState.settings?.unitPreference ?? 'metric');
  let profile = $state<BoardProfile | null>(null);
  let accepted = $state<CustomDashboard | null>(null);
  let draft = $state<CustomDashboard | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let saving = $state(false);
  let conflict = $state(false);
  let requestGeneration = 0;
  let selected = $state<string | null>(null);
  let picker = $state(false);
  let pendingWidget = $state<DashboardWidget | null>(null);
  let scroll = $state<HTMLElement>();
  let scrolled = $state(false);
  let announcement = $state('');
  let gridGeometry = $state<DashboardGridGeometry>({ columns: 4, cellSize: 80, rowSize: 56, gap: 6 });
  const wiggleReferenceDiagonal = $derived(
    Math.hypot(
      Math.min(4, gridGeometry.columns) * (gridGeometry.cellSize + gridGeometry.gap) - gridGeometry.gap,
      Math.min(2, gridGeometry.columns) * (gridGeometry.rowSize + gridGeometry.gap) - gridGeometry.gap
    )
  );
  function measureWidgetWiggle(node: HTMLElement, referenceDiagonal: number) {
    function updateAngle() {
      const diagonal = Math.hypot(node.offsetWidth, node.offsetHeight);
      if (!diagonal) return;
      // Preserve the large (4x2) widget's original 0.35-degree wiggle, giving
      // every size the same corner travel at the current responsive grid size.
      const angle = (0.35 * referenceDiagonal) / diagonal;
      node.style.setProperty('--widget-wiggle-angle', `${angle}deg`);
    }
    const observer = new ResizeObserver(updateAngle);
    observer.observe(node, { box: 'border-box' });
    return {
      update(nextReferenceDiagonal: number) {
        referenceDiagonal = nextReferenceDiagonal;
        updateAngle();
      },
      destroy() {
        observer.disconnect();
      },
    };
  }

  function measureGrid(node: HTMLElement) {
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(node);
      gridGeometry = {
        columns: style.gridTemplateColumns.split(/\s+/).length,
        cellSize: parseFloat(style.gridTemplateColumns),
        rowSize: parseFloat(style.gridAutoRows),
        gap: parseFloat(style.columnGap),
      };
    });
    observer.observe(node);
    return {
      destroy() {
        observer.disconnect();
      },
    };
  }

  let discard = $state(false);
  let leaveResolver: ((leave: boolean) => void) | null = null;
  let trigger: HTMLElement | null = null;
  const dashboard = $derived(draft ?? accepted);
  const dirty = $derived(!!draft && JSON.stringify(draft) !== JSON.stringify(accepted));
  const configured = $derived(pendingWidget ?? draft?.widgets.find((w) => w.id === selected));

  async function load() {
    const id = boardId;
    const generation = ++requestGeneration;
    if (!id) return;
    loading = true;
    error = null;
    try {
      const value = await backendState.readBoardProfile(id);
      if (generation !== requestGeneration || boardId !== id) return;
      const data = value.values.customDashboard;
      if (data != null && !validCustomDashboard(data)) throw new Error('This dashboard is unsupported or unreadable.');
      profile = value;
      accepted = data ?? defaultDashboard(value.values.liveWidgetSlots ?? connection.liveWidgetSlots);
      draft = null;
      conflict = false;
    } catch (e) {
      if (generation === requestGeneration)
        error = e instanceof Error ? e.message : 'Could not load dashboard. Try again.';
    } finally {
      if (generation === requestGeneration) loading = false;
    }
  }
  $effect(() => {
    const id = boardId;
    untrack(() => {
      profile = null;
      accepted = null;
      draft = null;
      selected = null;
      pendingWidget = null;
      picker = false;
      saving = false;
      finishLeave(false);
      if (id) void load();
    });
    return () => {
      requestGeneration++;
      finishLeave(false);
    };
  });

  function edit() {
    if (!accepted || draft || loading || saving) return;
    draft = structuredClone($state.snapshot(accepted));
    error = null;
  }
  export async function requestLeave(): Promise<boolean> {
    if (saving || discard) return false;
    if (!dirty) {
      draft = null;
      selected = null;
      pendingWidget = null;
      picker = false;
      return true;
    }
    discard = true;
    return new Promise((resolve) => {
      leaveResolver = resolve;
    });
  }
  function finishLeave(leave: boolean) {
    discard = false;
    if (leave) {
      draft = null;
      selected = null;
      pendingWidget = null;
      picker = false;
      error = null;
    }
    const resolve = leaveResolver;
    leaveResolver = null;
    resolve?.(leave);
  }
  beforeNavigate((navigation) => {
    if (!draft) return;
    if (saving || dirty) {
      navigation.cancel();
      if (navigation.to && !saving)
        void requestLeave().then((leave) => {
          if (leave && navigation.to) void goto(navigation.to.url);
        });
    }
  });
  async function save() {
    if (!draft || !profile || !boardId || saving || conflict) return;
    const id = boardId,
      generation = requestGeneration;
    saving = true;
    error = null;
    try {
      const result = await backendState.saveDashboard(id, profile.revision, $state.snapshot(draft));
      if (id !== boardId || generation !== requestGeneration) return;
      profile = result;
      accepted =
        result.values.customDashboard ?? defaultDashboard(result.values.liveWidgetSlots ?? connection.liveWidgetSlots);
      draft = null;
    } catch (e) {
      if (generation !== requestGeneration) return;
      conflict = e instanceof ApiRequestError && e.code === 'conflict';
      error = conflict
        ? 'This board profile changed. Reload current values before saving again.'
        : e instanceof Error
          ? e.message
          : 'Could not save dashboard. Try again.';
    } finally {
      if (generation === requestGeneration) saving = false;
    }
  }
  function configure(id: string, opener?: HTMLElement) {
    if (saving) return;
    trigger = opener ?? (document.activeElement as HTMLElement);
    selected = id;
  }
  async function closeConfiguration() {
    selected = null;
    pendingWidget = null;
    picker = false;
    await tick();
    if (trigger?.isConnected) trigger.focus();
    else addButton?.focus();
  }
  function reorder(id: string, index: number) {
    if (!draft || saving) return;
    draft = moveWidget(draft, id, index);
    const position = draft.widgets.findIndex((w) => w.id === id);
    announcement = `${widgetTitle(draft.widgets[position])}, position ${position + 1} of ${draft.widgets.length}`;
  }
  async function remove(id: string) {
    if (!draft || saving) return;
    const index = draft.widgets.findIndex((widget) => widget.id === id);
    if (index < 0) return;
    const title = widgetTitle(draft.widgets[index]);
    draft = { ...draft, widgets: draft.widgets.filter((widget) => widget.id !== id) };
    announcement = `${title} removed`;
    await tick();
    const surfaces = scroll?.querySelectorAll<HTMLButtonElement>('.edit-surface');
    if (surfaces?.length) surfaces[Math.min(index, surfaces.length - 1)].focus();
    else addButton?.focus();
  }
  let addButton = $state<HTMLButtonElement>();
  function apply(widget: DashboardWidget) {
    if (!draft || saving) return;
    if (pendingWidget && draft.widgets.length >= MAX_DASHBOARD_WIDGETS) return;
    draft = {
      ...draft,
      widgets: pendingWidget ? [...draft.widgets, widget] : draft.widgets.map((w) => (w.id === widget.id ? widget : w)),
    };
    void closeConfiguration();
  }
  function add(preset: DashboardWidget) {
    if (!draft || saving || draft.widgets.length >= MAX_DASHBOARD_WIDGETS) return;
    pendingWidget = { ...structuredClone($state.snapshot(preset)), id: crypto.randomUUID() };
    picker = false;
    selected = null;
  }
  async function cancel() {
    await requestLeave();
  }
</script>

<section
  class="custom-dashboard relative flex h-full min-h-0 flex-col"
  aria-label="Custom dashboard"
  use:backDismissal={{ close: cancel, enabled: !!draft && !selected && !pendingWidget && !picker }}
>
  {#if error}<div role="alert" class="mb-2 text-sm text-warning">
      <p>{error}</p>
      <button
        type="button"
        class="min-h-11 touch-manipulation underline"
        onpointerdown={(e) =>
          activateFromPointer(e, async () => {
            if (!draft || (await requestLeave())) await load();
          })}
        onclick={(e) =>
          activateFromKeyboardOrAssistiveClick(e, async () => {
            if (!draft || (await requestLeave())) await load();
          })}>{conflict ? 'Reload current values' : 'Retry loading'}</button
      >
    </div>{/if}
  {#if loading}<p role="status">Loading dashboard…</p>{/if}
  {#if draft}<p class="sr-only" role="status">Editing dashboard</p>{:else if dashboard}<p class="sr-only">
      Press and hold any widget or the background to arrange your dashboard.
    </p>{/if}
  <div
    bind:this={scroll}
    class="dashboard-scroll min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain select-none [-webkit-touch-callout:none]"
    use:dashboardBackgroundGesture={{ key: boardId, disabled: !accepted || !!draft || loading || saving, onedit: edit }}
    onscroll={(event) => (scrolled = event.currentTarget.scrollTop > 1)}
  >
    <div
      class="dashboard-scroll-edge pointer-events-none sticky top-0 z-30 h-0"
      class:scrolled
      aria-hidden="true"
    ></div>
    {#if dashboard}
      {#if !dashboard.widgets.length}<p class="p-6 text-center text-muted">
          No widgets yet. Add a widget to get started.
        </p>{/if}
      {#if !draft && !dashboard.widgets.length}
        <button
          type="button"
          class="min-h-11 touch-manipulation rounded-lg border border-outline px-4"
          onpointerdown={(e) =>
            activateFromPointer(e, () => {
              edit();
              picker = true;
            })}
          onclick={(e) =>
            activateFromKeyboardOrAssistiveClick(e, () => {
              edit();
              picker = true;
            })}>Add widget</button
        >
      {/if}
      <div class="dashboard-layout mx-auto w-full max-w-[100rem]">
        <div class="dashboard-grid grid gap-1.5" aria-label="Dashboard widgets" use:measureGrid>
          {#each dashboard.widgets as widget, index (widget.id)}
            <article
              use:measureWidgetWiggle={wiggleReferenceDiagonal}
              use:dashboardGesture={{
                id: widget.id,
                scroll,
                editing: !!draft,
                disabled: saving || loading || selected !== null || pendingWidget !== null || picker || discard,
                onedit: edit,
                onconfigure: () => configure(widget.id),
                onmove: reorder,
              }}
              data-dashboard-widget={widget.id}
              data-index={index}
              data-size={typeof widget.size === 'string' ? widget.size : `${widget.size.columns}x${widget.size.rows}`}
              data-short={dashboardDimensions(widget.size).rows === 1}
              style:--widget-columns={dashboardDimensions(widget.size).columns}
              style:--widget-rows={dashboardDimensions(widget.size).rows}
              class="dashboard-card relative min-w-0 rounded-lg border border-outline bg-surface"
              class:action-widget={widget.kind === 'action'}
              class:editing={!!draft}
              aria-label={widgetTitle(widget)}
            >
              {#if !draft}
                <button
                  type="button"
                  class="sr-only focus:not-sr-only focus:absolute focus:inset-0 focus:z-10 focus:rounded-lg focus:bg-surface"
                  aria-label={`Arrange ${widgetTitle(widget)}`}
                  onclick={(e) =>
                    activateFromKeyboardOrAssistiveClick(e, () => {
                      const card = e.currentTarget.closest('article');
                      edit();
                      void tick().then(() => card?.querySelector<HTMLButtonElement>('.edit-surface')?.focus());
                    })}>Arrange widget</button
                >
              {/if}
              <div class="h-full min-h-0" inert={!!draft}>
                <CustomWidget
                  {widget}
                  {connection}
                  {history}
                  {units}
                  {nowMs}
                  preview={!!previewInteractions}
                  {previewInteractions}
                />
              </div>
              {#if draft && scroll}
                <button
                  type="button"
                  class="edit-surface absolute inset-0 z-10 rounded-lg"
                  aria-label={`Configure ${widgetTitle(widget)}, position ${index + 1} of ${dashboard.widgets.length}`}
                  disabled={saving}
                  onclick={(e) => activateFromKeyboardOrAssistiveClick(e, () => configure(widget.id, e.currentTarget))}
                  aria-describedby="dashboard-keyboard-help"
                  aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                  onkeydown={(e) => {
                    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                      e.preventDefault();
                      const surface = e.currentTarget;
                      reorder(widget.id, index + (e.key === 'ArrowLeft' ? -1 : 1));
                      void tick().then(() => surface.focus());
                    }
                  }}
                ></button>
                <button
                  type="button"
                  data-dashboard-remove
                  class="dashboard-remove absolute -top-5 -right-[19px] z-20 flex size-11 touch-manipulation items-start justify-end rounded-full pt-px focus-visible:outline-2 focus-visible:outline-danger disabled:opacity-50"
                  aria-label={`Remove ${widgetTitle(widget)}`}
                  disabled={saving}
                  onpointerdown={(e) => activateFromPointer(e, () => remove(widget.id))}
                  onclick={(e) => activateFromKeyboardOrAssistiveClick(e, () => remove(widget.id))}
                  ><span
                    class="delete-badge flex size-7 items-center justify-center rounded-full border border-danger/50 text-danger shadow-sm"
                    aria-hidden="true"
                    ><svg
                      viewBox="0 0 16 16"
                      class="size-4"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.25"
                      stroke-linecap="round"><path d="m4 4 8 8m0-8-8 8" /></svg
                    ></span
                  ></button
                >
              {/if}
            </article>
          {/each}
        </div>
      </div>
    {/if}
  </div>
  {#if draft && !selected && !pendingWidget && !picker && !discard}
    <div
      class="dashboard-toolbar absolute inset-x-0 z-30 mx-auto flex w-fit max-w-full items-center gap-1 rounded-full border border-outline bg-surface/95 p-1.5 shadow-lg backdrop-blur"
      role="toolbar"
      aria-label="Edit dashboard"
      in:appearSurface|global={'menu'}
      out:exitSurface|global
    >
      <button
        type="button"
        class="min-h-11 touch-manipulation rounded-full px-3"
        disabled={saving}
        bind:this={addButton}
        onpointerdown={(e) =>
          activateFromPointer(e, () => {
            trigger = e.currentTarget;
            picker = true;
          })}
        onclick={(e) =>
          activateFromKeyboardOrAssistiveClick(e, () => {
            trigger = e.currentTarget;
            picker = true;
          })}
        aria-label="Add widget">+ Add</button
      >
      <button
        type="button"
        class="min-h-11 touch-manipulation rounded-full px-3"
        disabled={saving}
        onpointerdown={(e) => activateFromPointer(e, cancel)}
        onclick={(e) => activateFromKeyboardOrAssistiveClick(e, cancel)}>Cancel</button
      >
      <button
        type="button"
        class="min-h-11 touch-manipulation rounded-full bg-accent-fill px-4 text-on-accent disabled:opacity-40"
        disabled={saving || conflict}
        onpointerdown={(e) => activateFromPointer(e, save)}
        onclick={(e) => activateFromKeyboardOrAssistiveClick(e, save)}
        aria-label={saving ? 'Saving dashboard' : 'Save dashboard'}>{saving ? 'Saving…' : 'Save'}</button
      >
    </div>
  {/if}

  <p id="dashboard-keyboard-help" class="sr-only">Use Alt+Left or Alt+Right to move a widget.</p>
  <p class="sr-only" aria-live="polite">{announcement}</p>
</section>

{#if picker && draft}
  <WidgetPicker
    {connection}
    {history}
    {units}
    {nowMs}
    full={draft.widgets.length >= MAX_DASHBOARD_WIDGETS}
    onchoose={add}
    onclose={closeConfiguration}
  />
{/if}
{#if configured && draft}
  {#key configured.id}<WidgetConfiguration
      widget={configured}
      {connection}
      {history}
      {units}
      {nowMs}
      grid={gridGeometry}
      adding={pendingWidget !== null}
      onapply={apply}
      onclose={closeConfiguration}
    />{/key}
{/if}
<ConfirmDialog
  open={discard}
  titleId="discard-dashboard-title"
  title="Discard dashboard changes?"
  description="Your saved dashboard will stay unchanged."
  confirmLabel="Discard changes"
  appearance="warning"
  onconfirm={() => finishLeave(true)}
  oncancel={() => finishLeave(false)}
/>

<style>
  .custom-dashboard {
    container: dashboard / inline-size;
  }
  .dashboard-scroll {
    --delete-gutter: max(0px, calc(1rem - env(safe-area-inset-right, 0px)));
    margin-right: calc(-1 * var(--delete-gutter));
    padding-right: 1.25rem;
    padding-bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));
  }
  .dashboard-scroll-edge::after {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    border-top: 1px solid color-mix(in srgb, var(--color-outline) 70%, transparent);
    box-shadow: 0 4px 8px rgb(0 0 0 / 0.25);
    opacity: 0;
  }
  .dashboard-scroll-edge.scrolled::after {
    opacity: 1;
  }
  .dashboard-toolbar {
    bottom: max(0.5rem, env(safe-area-inset-bottom, 0px));
    border-color: color-mix(in srgb, var(--color-accent-fill) 45%, var(--color-outline));
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--color-accent-fill) 20%, transparent),
      0 6px 24px color-mix(in srgb, var(--color-accent-fill) 30%, transparent),
      0 4px 12px #0003;
  }
  .dashboard-layout {
    container-type: inline-size;
    padding-top: 1.5rem;
  }
  .dashboard-grid {
    --columns: 2;
    grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
    grid-auto-rows: clamp(3.5rem, calc((100cqw - (var(--columns) - 1) * 0.375rem) / var(--columns) * 0.55), 5rem);
    grid-auto-flow: row;
    align-items: stretch;
  }
  .dashboard-card {
    touch-action: none;
    user-select: none;
    -webkit-touch-callout: none;
    padding: 0.75rem;
    min-height: 0;
    grid-column: span min(var(--widget-columns), var(--columns));
    grid-row: span var(--widget-rows);
  }
  .dashboard-card[data-short='true'] {
    padding: 0.375rem;
  }
  .dashboard-card.action-widget {
    padding: 0;
  }
  .dashboard-card[data-size='medium'],
  .dashboard-card[data-size='large'] {
    grid-row: span min(var(--widget-rows), var(--columns));
  }
  .delete-badge {
    background: color-mix(in srgb, var(--color-danger) 12%, var(--color-canvas));
  }
  .dashboard-remove:hover .delete-badge {
    background: color-mix(in srgb, var(--color-danger) 22%, var(--color-canvas));
  }
  .dashboard-remove:active .delete-badge {
    transform: scale(0.94);
  }
  .dashboard-card.editing::before,
  .dashboard-card.editing > :global(div) {
    animation: var(--widget-wiggle, wiggle 240ms ease-in-out alternate infinite);
  }
  /* Keep the editing border below the delete badge; parent outlines paint over descendants. */
  .dashboard-card.editing::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    border: 2px dashed var(--color-accent);
    border-radius: inherit;
    pointer-events: none;
  }
  .dashboard-card > :global(div),
  .dashboard-card::before {
    transition: scale 120ms ease-out;
  }
  .dashboard-card:global([data-pressing]) {
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface));
  }
  .dashboard-card:global([data-pressing]) > :global(div),
  .dashboard-card:global([data-pressing])::before {
    scale: 0.97;
    animation: none;
    rotate: 0deg;
  }
  .edit-surface {
    touch-action: none;
  }
  .dashboard-card:global([data-dragging]) {
    opacity: 1;
    animation: none;
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    cursor: grabbing;
  }
  .dashboard-card:global([data-dragging]) > :global(div),
  .dashboard-card:global([data-dragging]) > :global(button) {
    visibility: hidden;
  }
  .dashboard-card:global([data-drop])::before {
    border: 3px solid var(--color-accent);
    animation: none;
    rotate: 0deg;
  }
  @keyframes wiggle {
    from {
      rotate: calc(-1 * var(--widget-wiggle-angle, 0deg));
    }
    to {
      rotate: var(--widget-wiggle-angle, 0deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dashboard-card > :global(div),
    .dashboard-card::before {
      transition: none;
    }
    .dashboard-card:global([data-pressing]) > :global(div),
    .dashboard-card:global([data-pressing])::before {
      scale: 1;
    }

    .dashboard-card.editing::before,
    .dashboard-card.editing > :global(div) {
      animation: none;
    }
  }
  @container dashboard (max-width: 14rem) {
    .dashboard-grid {
      --columns: 1;
    }
  }
  @container dashboard (min-width: 20rem) {
    .dashboard-grid {
      --columns: 4;
    }
  }
  @container dashboard (min-width: 40rem) {
    .dashboard-grid {
      --columns: 8;
    }
  }
  @container dashboard (min-width: 72rem) {
    .dashboard-grid {
      --columns: 12;
    }
  }
</style>
