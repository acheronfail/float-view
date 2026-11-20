<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    ActiveConnection,
    RefloatConfigurationField,
    RefloatConfigurationIdentity,
    RefloatConfigurationSchemaPage,
    RefloatConfigurationValues,
    RefloatConfigurationValue,
    RefloatTune,
    RefloatTuneSummary,
  } from '$lib/backend/contract';
  import { backendState } from '$lib/backend/state.svelte';
  import InformationDialog from '$lib/ui/InformationDialog.svelte';
  import Menu from '$lib/ui/Menu.svelte';
  import MenuItem from '$lib/ui/MenuItem.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import { activateFromKeyboardOrAssistiveClick, activateFromPointer } from '$lib/ui/activation';
  import { sameRefloatIdentity, sameRefloatValue } from './refloat-configuration.svelte';
  import { sameRefloatTuneIdentity, tuneCompatibilityVersion } from '$lib/backend/refloat-tune-policy';
  import { captureCurrentRefloatTune, overwriteCurrentRefloatTune } from './refloat-tunes';
  import { refloatConfigurationWriteUnavailableReason } from './live';
  import RefloatConfigurationDiff from './RefloatConfigurationDiff.svelte';

  let { connection }: { connection: ActiveConnection } = $props();
  let tunes = $state<RefloatTuneSummary[]>([]);
  let current = $state<RefloatConfigurationValues | null>(null);
  let matchingCursor = $state<string | null>(null);
  let matchingComplete = $state(false);
  let libraryComplete = $state(false);
  let loadMoreTarget = $state<HTMLElement>();
  let managing = $state(false);
  let managedTune = $state<RefloatTune | null>(null);
  let information = $state<string | null>(null);
  let informationTrigger = $state<HTMLElement>();
  let listLoading = $state(false);
  let nextCursor = $state<string | null>(null);
  let listLoaded = $state(false);
  const packageVersion = $derived(current?.identity.packageVersion ?? connection.refloatConfiguration?.packageVersion);
  function incompatibility(identity: RefloatConfigurationIdentity): string | null {
    if (!current) return 'Read the board tune before applying.';
    if (
      tuneCompatibilityVersion(identity.packageVersion) !== tuneCompatibilityVersion(current.identity.packageVersion)
    ) {
      return `Requires Refloat ${tuneCompatibilityVersion(identity.packageVersion)}. This board uses ${current.identity.packageVersion}.`;
    }
    if (!sameRefloatTuneIdentity(identity, current.identity)) {
      return `This tune uses a different configuration and cannot be applied to this board.`;
    }
    return null;
  }
  const sortedTunes = $derived(
    [...tunes].sort((a, b) => {
      const rank = (tune: RefloatTuneSummary) =>
        !incompatibility(tune.identity)
          ? 0
          : tuneCompatibilityVersion(tune.identity.packageVersion) === tuneCompatibilityVersion(packageVersion ?? '')
            ? 1
            : 2;
      return rank(a) - rank(b);
    })
  );
  const hasMore = $derived(!matchingComplete || !libraryComplete);
  $effect(() => {
    if (!loadMoreTarget || loading || listLoading || backendState.error || !hasMore || tunes.length >= 1000) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadTunes();
    });
    observer.observe(loadMoreTarget);
    return () => observer.disconnect();
  });
  let selected = $state<RefloatTune | null>(null);
  let fields = $state<RefloatConfigurationField[]>([]);
  let loading = $state(false);
  let switchError = $state<{ tuneId: string; message: string } | null>(null);
  let switchingTuneId = $state<string | null>(null);
  let pendingApply = $state<{
    tune: RefloatTune;
    current: RefloatConfigurationValues | null;
    deviceId: string;
    route: string;
    invalidated: boolean;
    trigger: HTMLElement;
  } | null>(null);
  let applyError = $state<string | null>(null);
  $effect(() => {
    if (
      pendingApply &&
      !pendingApply.invalidated &&
      (connection.state !== 'ready' ||
        connection.deviceId !== pendingApply.deviceId ||
        JSON.stringify(connection.controllerConnection) !== pendingApply.route ||
        !connection.refloatConfiguration?.currentLoaded)
    )
      pendingApply.invalidated = true;
  });
  const applyUnavailableReason = $derived(
    refloatConfigurationWriteUnavailableReason(connection, connection.refloatConfiguration, 'applyTune')
  );
  const pendingApplyReason = $derived(
    pendingApply?.invalidated
      ? 'The board connection changed. Close this dialog and select the tune again.'
      : pendingApply
        ? (incompatibility(pendingApply.tune.identity) ?? applyUnavailableReason)
        : null
  );
  function tuneChanges(
    before: Record<string, RefloatConfigurationValue>,
    after: Record<string, RefloatConfigurationValue>
  ) {
    return fields.flatMap((field) => {
      const previous = before[field.name];
      const next = after[field.name];
      return previous && next && sameRefloatValue(previous, next)
        ? []
        : [{ name: field.name, label: field.label, before: previous, after: next }];
    });
  }
  const applyChanges = $derived(
    pendingApply?.current ? tuneChanges(pendingApply.current.values, pendingApply.tune.values) : []
  );
  const applyHasChanges = $derived(applyChanges.length > 0);
  const applyMatchesCurrent = $derived(
    !!pendingApply?.current && !applyHasChanges && !pendingApplyReason && !applyError
  );
  let saveConfirmation = $state(false);
  let saving = $state(false);
  let overwriteConfirmation = $state(false);
  let overwritePreview = $state<RefloatConfigurationValues | null>(null);
  let overwriting = $state(false);
  let overwriteError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  let renameError = $state<string | null>(null);
  let deleteError = $state<string | null>(null);
  let renameConfirmation = $state(false);
  let deleteConfirmation = $state(false);
  let name = $state('');
  let description = $state('');
  let status = $state<string | null>(null);

  const selectedIsActive = $derived(
    !!selected &&
      !!current &&
      !incompatibility(selected.identity) &&
      fields.every((field) => {
        const saved = selected!.values[field.name];
        const actual = current!.values[field.name];
        return !!saved && !!actual && sameRefloatValue(saved, actual);
      })
  );

  onMount(() => {
    void initialize();
  });

  async function initialize() {
    loading = true;
    switchError = null;
    status = null;
    try {
      if (!(await backendState.openRefloatConfiguration())) return;
      const pages: RefloatConfigurationSchemaPage[] = [];
      let cursor: string | null = null;
      for (let count = 0; count < 64; count += 1) {
        const page = await backendState.refloatConfigurationSchema(cursor);
        if (!page) return;
        pages.push(page);
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      if (cursor || !pages.length) return;
      fields = pages.flatMap((page) => page.fields).filter((field) => field.tunable);
      const loaded = await readCurrent(true);
      if (!loaded) return;
      await refreshTunes(loaded);
    } finally {
      loading = false;
    }
  }

  async function readCurrent(refresh: boolean) {
    const loaded = await backendState.readRefloatConfiguration('current', refresh);
    if (!loaded) return null;
    current = loaded;
    return loaded;
  }

  async function refreshTunes(source = current) {
    if (!source) return;
    matchingCursor = null;
    nextCursor = null;
    matchingComplete = false;
    libraryComplete = false;
    tunes = [];
    await loadTunes(source);
  }

  async function loadTunes(source = current) {
    if (!source || listLoading) return;
    listLoading = true;
    try {
      if (!matchingComplete) {
        const matching = await backendState.listRefloatTunes(source.identity, 50, matchingCursor);
        if (!matching) return;
        tunes = [...tunes, ...matching.items].slice(0, 1000);
        matchingCursor = matching.nextCursor;
        matchingComplete = !matchingCursor;
      }
      if (matchingComplete && !libraryComplete && tunes.length < 1000) {
        const page = await backendState.listRefloatTunes(null, 50, nextCursor);
        if (!page) return;
        const existing = new Set(tunes.map((tune) => tune.tuneId));
        tunes = [...tunes, ...page.items.filter((tune) => !existing.has(tune.tuneId))].slice(0, 1000);
        nextCursor = page.nextCursor;
        libraryComplete = !nextCursor;
      }
      listLoaded = true;
    } finally {
      listLoading = false;
    }
  }

  async function selectTune(summary: RefloatTuneSummary, trigger: HTMLElement) {
    if (switchingTuneId || managing || loading || listLoading || backendState.busy) return;
    const reason = incompatibility(summary.identity) ?? applyUnavailableReason;
    if (reason) {
      informationTrigger = trigger;
      information = reason;
      return;
    }
    switchingTuneId = summary.tuneId;
    switchError = null;
    applyError = null;
    status = null;
    const deviceId = connection.deviceId;
    const route = JSON.stringify(connection.controllerConnection);
    try {
      const tune = await backendState.getRefloatTune(summary.tuneId);
      if (!tune) {
        switchError = { tuneId: summary.tuneId, message: backendState.error ?? 'Could not load tune. Try again.' };
        return;
      }
      pendingApply = {
        tune,
        current: null,
        deviceId,
        route,
        invalidated: false,
        trigger,
      };
      const loaded = await readCurrent(true);
      if (!loaded) {
        applyError = backendState.error ?? 'Could not read the current tune. Try again.';
        return;
      }
      pendingApply.current = loaded;
      if (!applyHasChanges) selected = tune;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load tune. Try again.';
      if (pendingApply) applyError = message;
      else switchError = { tuneId: summary.tuneId, message };
    } finally {
      switchingTuneId = null;
    }
  }

  async function confirmApply() {
    const pending = pendingApply;
    if (!pending || pendingApplyReason || switchingTuneId || backendState.busy) return;
    switchingTuneId = pending.tune.tuneId;
    applyError = null;
    try {
      const reviewed = pending.current;
      const loaded = await readCurrent(true);
      if (!loaded) {
        applyError = backendState.error ?? 'Could not read the current tune. Try again.';
        return;
      }
      pending.current = loaded;
      if (pendingApplyReason) return;
      if (
        !reviewed ||
        fields.some((field) => {
          const before = reviewed.values[field.name];
          const after = loaded.values[field.name];
          return !before || !after || !sameRefloatValue(before, after);
        })
      ) {
        applyError = 'Review the updated differences before applying this tune.';
        return;
      }
      if (!applyHasChanges) return;
      const tune = pending.tune;
      const result = await backendState.applyRefloatTune(tune.tuneId, tune.revision, loaded.revision);
      if (result) {
        current = result;
        selected = tune;
        pendingApply = null;
        status = `${tune.name} applied.`;
      } else {
        applyError = backendState.error ?? 'Could not apply tune. Try again.';
      }
    } catch (error) {
      applyError = error instanceof Error ? error.message : 'Could not apply tune. Try again.';
    } finally {
      switchingTuneId = null;
    }
  }

  async function manageTune(tune: RefloatTuneSummary, action: 'rename' | 'delete' | 'overwrite') {
    if (loading || listLoading || switchingTuneId || managing || backendState.busy) return;
    managing = true;
    try {
      managedTune = await backendState.getRefloatTune(tune.tuneId);
      if (!managedTune) return;
      if (action === 'rename') openRename();
      else if (action === 'overwrite') {
        if (incompatibility(managedTune.identity)) return;
        overwriteError = null;
        overwritePreview = null;
        overwriteConfirmation = true;
        try {
          const loaded = await readCurrent(true);
          if (!loaded) {
            overwriteError = backendState.error ?? 'Could not read the current tune. Close this dialog and try again.';
          } else if (incompatibility(managedTune.identity)) {
            overwriteError = incompatibility(managedTune.identity);
          } else {
            overwritePreview = loaded;
          }
        } catch (error) {
          overwriteError = error instanceof Error ? error.message : 'Could not read the current tune. Try again.';
        }
      } else {
        deleteError = null;
        deleteConfirmation = true;
      }
    } finally {
      managing = false;
    }
  }

  function openSave() {
    saveError = null;
    name = '';
    description = '';
    saveConfirmation = true;
  }

  async function saveCurrent() {
    if (!name.trim() || saving) return;
    saving = true;
    saveError = null;
    try {
      const captured = await captureCurrentRefloatTune(
        backendState,
        name.trim(),
        description.trim() || null,
        fields.map((field) => field.name)
      );
      if (!captured) {
        saveError = backendState.error ?? 'Could not save tune. Try again.';
        return;
      }
      current = captured.current;
      selected = captured.tune;
      saveConfirmation = false;
      status = `${captured.tune.name} saved.`;
      await refreshTunes(captured.current);
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'Could not save tune. Try again.';
    } finally {
      saving = false;
    }
  }

  async function overwrite() {
    if (!managedTune || !overwritePreview || overwriting) return;
    overwriting = true;
    overwriteError = null;
    try {
      const captured = await overwriteCurrentRefloatTune(
        {
          updateRefloatTune: (...args) => backendState.updateRefloatTune(...args),
          readRefloatConfiguration: async () => {
            const reviewed = overwritePreview;
            const loaded = await readCurrent(true);
            if (loaded && reviewed && sameRefloatIdentity(loaded.identity, reviewed.identity)) {
              overwritePreview = loaded;
              if (
                fields.some((field) => {
                  const before = reviewed.values[field.name];
                  const after = loaded.values[field.name];
                  return !before || !after || !sameRefloatValue(before, after);
                })
              ) {
                throw new Error('The board’s tune changed. Review the updated differences before overwriting.');
              }
            }
            return loaded;
          },
        },
        managedTune,
        fields.map((field) => field.name)
      );
      if (!captured) {
        overwriteError = backendState.error ?? 'Could not overwrite tune. Try again.';
        return;
      }
      current = captured.current;
      selected = captured.tune;
      managedTune = captured.tune;
      overwriteConfirmation = false;
      status = `${captured.tune.name} saved.`;
      await refreshTunes(captured.current);
    } catch (error) {
      overwriteError = error instanceof Error ? error.message : 'Could not overwrite tune. Try again.';
    } finally {
      overwriting = false;
    }
  }

  function openRename() {
    if (!managedTune) return;
    name = managedTune.name;
    description = managedTune.description ?? '';
    renameError = null;
    renameConfirmation = true;
  }

  async function rename() {
    if (!managedTune || !name.trim()) return;
    renameError = null;
    const updated = await backendState.updateRefloatTune(
      managedTune.tuneId,
      managedTune.revision,
      name.trim(),
      description.trim() || null,
      managedTune.values
    );
    if (!updated) {
      renameError = backendState.error ?? 'Could not rename tune. Try again.';
      return;
    }
    if (selected?.tuneId === updated.tuneId) selected = updated;
    managedTune = updated;
    renameConfirmation = false;
    status = 'Changes saved.';
    await refreshTunes();
  }

  async function remove() {
    if (!managedTune) return;
    deleteError = null;
    if (!(await backendState.deleteRefloatTune(managedTune.tuneId, managedTune.revision))) {
      deleteError = backendState.error ?? 'Could not delete tune. Try again.';
      return;
    }
    const deletedName = managedTune.name;
    if (selected?.tuneId === managedTune.tuneId) selected = null;
    managedTune = null;
    deleteConfirmation = false;
    status = `${deletedName} deleted.`;
    await refreshTunes();
  }
</script>

{#if backendState.error && !switchError && !saveConfirmation && !renameConfirmation && !deleteConfirmation && !overwriteConfirmation && !pendingApply}
  <p role="alert" class="text-warning">{backendState.error}</p>
  <button
    type="button"
    class="touch-manipulation rounded-lg bg-elevated px-4 py-2"
    onpointerdown={(event) => activateFromPointer(event, initialize)}
    onclick={(event) => activateFromKeyboardOrAssistiveClick(event, initialize)}>Retry</button
  >
{/if}
{#if status}<p role="status" class="mb-3 rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
    {status}
  </p>{/if}

<section class="grid content-start gap-3">
  <button
    type="button"
    class="touch-manipulation rounded-md bg-accent-fill px-4 py-2 text-on-accent disabled:opacity-50"
    disabled={!current || loading || listLoading || !!switchingTuneId || managing || backendState.busy}
    onpointerdown={(event) => activateFromPointer(event, openSave)}
    onclick={(event) => activateFromKeyboardOrAssistiveClick(event, openSave)}>Save tune</button
  >
  <div class="grid gap-3" aria-label="Saved tunes">
    {#each sortedTunes as tune (tune.tuneId)}
      {@const reason = incompatibility(tune.identity)}
      {@const active = selected?.tuneId === tune.tuneId && selectedIsActive}
      <div>
        <div
          class="flex rounded-xl border bg-elevated"
          class:border-accent={active}
          class:border-outline={!active}
          data-tune-id={tune.tuneId}
          data-compatible={!reason}
        >
          <button
            type="button"
            aria-busy={switchingTuneId === tune.tuneId}
            aria-describedby={reason ? `tune-${tune.tuneId}-compatibility` : undefined}
            disabled={loading || listLoading || !!switchingTuneId || managing || backendState.busy}
            class="min-w-0 flex-1 touch-pan-y rounded-l-xl p-4 text-left disabled:opacity-50"
            class:text-muted={!!reason}
            class:opacity-60={!!reason}
            aria-haspopup="dialog"
            onpointerdown={(event) => {
              const trigger = event.currentTarget;
              activateFromPointer(event, () => selectTune(tune, trigger));
            }}
            onclick={(event) => {
              const trigger = event.currentTarget;
              activateFromKeyboardOrAssistiveClick(event, () => selectTune(tune, trigger));
            }}
          >
            <span class="flex flex-wrap items-center justify-between gap-2">
              <strong class="break-words">{tune.name}</strong>
              <span
                class="rounded-full border px-2 py-0.5 text-xs whitespace-nowrap"
                class:border-outline={!!reason}
                class:text-muted={!!reason}
                class:border-accent={!reason}
                class:text-accent={!reason}>Refloat {tuneCompatibilityVersion(tune.identity.packageVersion)}</span
              >
            </span>
            {#if tune.description}<span class="mt-1 block text-sm">{tune.description}</span>{/if}
            <span class="mt-2 block text-xs" id={`tune-${tune.tuneId}-compatibility`}>
              {#if switchingTuneId === tune.tuneId}{pendingApply
                  ? 'Working…'
                  : 'Loading…'}{:else if active}Active{:else if reason}Unavailable{:else}Tap to review{/if}
            </span>
          </button>
          <Menu
            label={`Options for ${tune.name}`}
            variant="card"
            disabled={loading || listLoading || !!switchingTuneId || managing || backendState.busy}
          >
            {#snippet children(closeMenu)}
              <MenuItem
                label="Overwrite"
                disabled={!!reason || overwriting}
                onactivate={() => {
                  closeMenu();
                  return manageTune(tune, 'overwrite');
                }}
              />
              <MenuItem
                label="Rename"
                onactivate={() => {
                  closeMenu();
                  return manageTune(tune, 'rename');
                }}
              />
              <MenuItem
                label="Delete"
                appearance="destructive"
                onactivate={() => {
                  closeMenu();
                  return manageTune(tune, 'delete');
                }}
              />
            {/snippet}
          </Menu>
        </div>
        {#if switchError?.tuneId === tune.tuneId}<p role="alert" class="mt-2 text-sm text-warning">
            {switchError.message}
          </p>{/if}
      </div>
    {:else}
      {#if !loading && listLoaded}<p class="py-4 text-center text-sm text-muted">No saved tunes.</p>{/if}
    {/each}
    {#if loading || listLoading}<p role="status" class="text-sm text-muted">Loading…</p>{/if}
    {#if hasMore && tunes.length < 1000 && !backendState.error}<div
        bind:this={loadMoreTarget}
        class="h-1"
        aria-hidden="true"
      ></div>
    {:else if hasMore && tunes.length >= 1000}<p class="text-sm text-muted">Showing the first 1,000 tunes.</p>{/if}
  </div>
</section>

<InformationDialog
  open={information !== null}
  titleId="tune-unavailable-title"
  title="Tune unavailable"
  description={information ?? ''}
  returnFocus={informationTrigger}
  onclose={() => {
    information = null;
  }}
/>

<ConfirmDialog
  open={pendingApply !== null}
  titleId="refloat-tune-apply-title"
  contentLabel="Apply tune comparison"
  returnFocus={pendingApply?.trigger}
  title={applyMatchesCurrent
    ? `${pendingApply?.tune.name ?? 'Tune'} is already active`
    : `Apply ${pendingApply?.tune.name ?? 'tune'}?`}
  description={applyMatchesCurrent
    ? undefined
    : connection.latestSample?.rideState !== 'idle'
      ? 'The board is not idle. Applying a tune can cause the board to cut out momentarily. Review the changes before applying.'
      : 'Replace the board’s current tune with this saved tune.'}
  cancelLabel={applyMatchesCurrent ? 'Done' : 'Cancel'}
  showConfirm={!applyMatchesCurrent}
  confirmLabel={pendingApply?.current ? 'Apply tune' : 'Retry read'}
  appearance={connection.latestSample?.rideState !== 'idle' ? 'warning' : 'normal'}
  busy={!!switchingTuneId || backendState.busy}
  confirmDisabled={!!pendingApplyReason || (!!pendingApply?.current && !applyHasChanges)}
  error={pendingApplyReason ?? applyError}
  onconfirm={confirmApply}
  oncancel={() => {
    pendingApply = null;
    applyError = null;
  }}
>
  {#if pendingApply?.current}
    <RefloatConfigurationDiff
      {fields}
      changes={applyChanges}
      label="Tune differences"
      emptyMessage="This saved tune already matches the board’s current tune."
      beforeLabel="Current board"
      afterLabel="Saved tune"
    />
  {:else if switchingTuneId}
    <p role="status" class="text-sm text-muted">Reading current tune…</p>
  {/if}
</ConfirmDialog>

<ConfirmDialog
  open={saveConfirmation}
  titleId="refloat-tune-save-title"
  title="Save current tune"
  confirmLabel="Save tune"
  busy={saving || backendState.busy}
  confirmDisabled={!name.trim()}
  error={saveError}
  onconfirm={saveCurrent}
  oncancel={() => {
    saveConfirmation = false;
  }}
>
  <div class="grid gap-3">
    <label class="text-sm">
      <span class="mb-1 block text-muted">Name</span>
      <input class="w-full rounded-md border border-outline bg-elevated px-3 py-2" maxlength="128" bind:value={name} />
    </label>
    <label class="text-sm">
      <span class="mb-1 block text-muted">Description (optional)</span>
      <textarea
        class="w-full rounded-md border border-outline bg-elevated px-3 py-2"
        maxlength="1024"
        rows="3"
        bind:value={description}
      ></textarea>
    </label>
  </div>
</ConfirmDialog>

<ConfirmDialog
  open={renameConfirmation}
  titleId="refloat-tune-rename-title"
  title="Rename tune"
  confirmLabel="Save"
  busy={backendState.busy}
  confirmDisabled={!name.trim()}
  error={renameError}
  onconfirm={rename}
  oncancel={() => {
    renameConfirmation = false;
  }}
>
  <div class="grid gap-3">
    <label class="text-sm">
      <span class="mb-1 block text-muted">Name</span>
      <input class="w-full rounded-md border border-outline bg-elevated px-3 py-2" maxlength="128" bind:value={name} />
    </label>
    <label class="text-sm">
      <span class="mb-1 block text-muted">Description (optional)</span>
      <textarea
        class="w-full rounded-md border border-outline bg-elevated px-3 py-2"
        maxlength="1024"
        rows="3"
        bind:value={description}
      ></textarea>
    </label>
  </div>
</ConfirmDialog>

<ConfirmDialog
  open={deleteConfirmation}
  titleId="refloat-tune-delete-title"
  title="Delete {managedTune?.name ?? 'tune'}?"
  description="The board’s tune will stay unchanged."
  confirmLabel="Delete tune"
  appearance="destructive"
  busy={backendState.busy}
  error={deleteError}
  onconfirm={remove}
  oncancel={() => {
    deleteConfirmation = false;
  }}
/>

<ConfirmDialog
  open={overwriteConfirmation}
  titleId="refloat-tune-overwrite-title"
  contentLabel="Overwrite tune comparison"
  title="Overwrite {managedTune?.name ?? 'tune'}?"
  description="Replace this saved tune with the board’s current tune."
  confirmLabel="Overwrite"
  busy={managing || overwriting || backendState.busy}
  confirmDisabled={!overwritePreview}
  error={overwriteError}
  onconfirm={overwrite}
  oncancel={() => {
    overwriteConfirmation = false;
  }}
>
  {#if overwritePreview}
    <RefloatConfigurationDiff
      {fields}
      changes={tuneChanges(managedTune?.values ?? {}, overwritePreview.values)}
      label="Tune differences"
      emptyMessage="No differences. This saved tune already matches the board’s current tune."
      beforeLabel="Saved"
      afterLabel="Current board"
    />
  {:else if managing}
    <p role="status" class="text-sm text-muted">Reading current tune…</p>
  {/if}
</ConfirmDialog>
