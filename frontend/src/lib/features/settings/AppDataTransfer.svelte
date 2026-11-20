<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { backendState } from '$lib/backend/state.svelte';
  import type { AppImportSummary } from '$lib/backend/contract';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import SectionTitle from '$lib/ui/SectionTitle.svelte';
  import FullScreenOverlay from '$lib/ui/FullScreenOverlay.svelte';

  let { children }: { children?: Snippet } = $props();

  let picker: HTMLInputElement;
  let file = $state<File | null>(null);
  let action = $state<'import' | 'clear' | null>(null);
  let running = $state(false);
  let applySettings = $state(false);
  let summary = $state<AppImportSummary | null>(null);
  let cleared = $state(false);
  let importButton: HTMLButtonElement;
  let clearButton: HTMLButtonElement;
  const idle = $derived(!backendState.snapshot?.activeConnection && !backendState.snapshot?.pausedRide);
  const disabled = $derived(!idle || backendState.busy || running);
  const buttonClass =
    'min-h-11 touch-manipulation rounded border border-outline bg-elevated px-3 py-2 disabled:opacity-50';

  async function close() {
    if (running) return;
    const previous = action;
    action = null;
    file = null;
    await tick();
    (previous === 'clear' ? clearButton : importButton)?.focus();
  }
  async function confirm() {
    if (running) return;
    running = true;
    summary = null;
    cleared = false;
    try {
      if (action === 'import' && file) summary = await backendState.importAppData(file, applySettings);
      else if (action === 'clear') cleared = await backendState.clearAppData();
    } finally {
      running = false;
      await close();
    }
  }
</script>

<section aria-label="Backups" class="space-y-3">
  <SectionTitle title="Backups" />
  <p class="text-sm text-muted">
    Back up or transfer your sessions, boards, configurations, tunes and preferences in one ZIP.
  </p>
  <p class="text-sm text-muted">
    The ZIP includes recorded locations. Bluetooth connections must be set up again on a new device.
  </p>
  {#if !idle}<p class="text-sm text-muted">
      Disconnect and end any paused ride before exporting, importing or clearing data.
    </p>{/if}
  <div class="flex flex-wrap gap-3">
    <button
      type="button"
      class={buttonClass}
      {disabled}
      onpointerdown={(e) => activateFromPointer(e, () => backendState.exportAppData())}
      onclick={(e) => activateFromKeyboardOrAssistiveClick(e, () => backendState.exportAppData())}>Create backup</button
    >
    <button
      bind:this={importButton}
      type="button"
      class={buttonClass}
      {disabled}
      onpointerdown={(e) => activateFromPointer(e, () => picker.click())}
      onclick={(e) => activateFromKeyboardOrAssistiveClick(e, () => picker.click())}>Restore backup…</button
    >
    <input
      bind:this={picker}
      type="file"
      accept=".zip,application/zip"
      class="hidden"
      aria-label="Backup file"
      onchange={(e) => {
        file = e.currentTarget.files?.[0] ?? null;
        e.currentTarget.value = '';
        applySettings = false;
        if (file) action = 'import';
      }}
    />
  </div>
  {#if backendState.exportStatus}<p role="status" class="text-sm">{backendState.exportStatus}</p>{/if}
  {#if summary}
    <div role="status" class="space-y-1 text-sm">
      <p>Backup restored.</p>
      <p>Boards: {summary.boardsAdded} added, {summary.boardsSkipped} already saved.</p>
      <p>Sessions: {summary.sessionsAdded} added, {summary.sessionsSkipped} already saved.</p>
      <p>Tunes: {summary.tunesAdded} added, {summary.tunesSkipped} already saved.</p>
      <p>{summary.settingsImported ? 'Preferences restored.' : 'Your preferences were kept.'}</p>
    </div>
  {/if}
</section>

{@render children?.()}

<section aria-label="Clear app data" class="space-y-3">
  <SectionTitle title="Clear app data" />
  <p class="text-sm text-muted">Delete app data on this device and reset preferences.</p>
  <button
    bind:this={clearButton}
    type="button"
    class={`${buttonClass} text-warning`}
    {disabled}
    onpointerdown={(e) =>
      activateFromPointer(e, () => {
        action = 'clear';
      })}
    onclick={(e) =>
      activateFromKeyboardOrAssistiveClick(e, () => {
        action = 'clear';
      })}>Clear app data…</button
  >
  {#if cleared}<p role="status" class="text-sm">App data cleared.</p>{/if}
</section>

{#if action}
  <FullScreenOverlay
    title={action === 'import' ? 'Restore backup' : 'Clear app data'}
    titleId="app-data-action-title"
    closeLabel="Cancel"
    closeDisabled={running}
    onclose={close}
  >
    <div class="space-y-5 py-4">
      {#if running}
        <p role="status">
          {action === 'import' ? 'Validating and restoring your backup…' : 'Clearing app data…'}
        </p>
        <progress
          aria-label={action === 'import' ? 'Restoring backup' : 'Clearing app data'}
          class="w-full accent-accent"
        ></progress>
        <p class="text-sm text-muted">Keep the app open until this finishes.</p>
      {:else if action === 'import'}
        <p class="break-all">{file?.name}</p>
        <p>
          New sessions, boards and tunes will be added. Existing sessions, board configurations and tunes will be kept.
          Restoring the same backup again skips data you already have.
        </p>
        <label class="flex min-h-11 items-center gap-3"
          ><input type="checkbox" bind:checked={applySettings} />Also restore preferences</label
        >
        <button
          type="button"
          class={buttonClass}
          onpointerdown={(e) => activateFromPointer(e, confirm)}
          onclick={(e) => activateFromKeyboardOrAssistiveClick(e, confirm)}>Restore backup</button
        >
      {:else}
        <p>
          Delete all sessions, boards, configurations and tunes, and reset preferences on this device. This cannot be
          undone.
        </p>
        <button
          type="button"
          class={`${buttonClass} text-warning`}
          onpointerdown={(e) => activateFromPointer(e, confirm)}
          onclick={(e) => activateFromKeyboardOrAssistiveClick(e, confirm)}>Delete app data</button
        >
      {/if}
    </div>
  </FullScreenOverlay>
{/if}
