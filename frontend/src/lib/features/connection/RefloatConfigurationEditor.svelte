<script lang="ts">
  import { createMotion } from '$lib/ui/motion';
  import SegmentedControl from '$lib/ui/SegmentedControl.svelte';
  import { onMount, tick } from 'svelte';
  import type { RefloatConfigurationField as RefloatConfigurationFieldContract } from '$lib/backend/contract';
  import { backendState } from '$lib/backend/state.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import InformationDialog from '$lib/ui/InformationDialog.svelte';
  import { activateFromKeyboardOrAssistiveClick, activateFromPointer } from '$lib/ui/activation';
  import RefloatConfigurationField from './RefloatConfigurationField.svelte';
  import RefloatConfigurationDiff from './RefloatConfigurationDiff.svelte';
  import {
    formatRefloatValue,
    refloatConfigurationFieldHelp,
    refloatConfigurationFieldLabel,
    resolveRefloatConfigurationSection,
    type RefloatConfigurationController,
  } from './refloat-configuration.svelte';

  const { expand: expandControls, collapse: collapseControls } = createMotion();

  let { controller }: { controller: RefloatConfigurationController } = $props();
  let writeConfirmation = $state(false);
  let writeError = $state<string | null>(null);
  const readinessWarning = $derived(
    controller.loading ? null : (controller.error ?? controller.writeUnavailableReason)
  );
  const controlsExpanded = $derived(controller.position.controlsExpanded);
  const selectedSectionKey = $derived(controller.position.sectionKey);
  let scroller = $state<HTMLDivElement>();
  let helpField = $state<RefloatConfigurationFieldContract | null>(null);
  let helpTrigger = $state<HTMLButtonElement>();
  const selectedSection = $derived(resolveRefloatConfigurationSection(controller.sections, selectedSectionKey));
  const subsections = $derived.by(() => {
    const fields = controller.filteredSectionFields(selectedSection);
    const groups: { key: string; heading: string | null; fields: RefloatConfigurationFieldContract[] }[] = [];
    for (const [index, field] of fields.entries()) {
      let group = groups.at(-1);
      if (!group || (field.heading && field.heading !== fields[index - 1]?.heading)) {
        group = { key: field.name, heading: field.heading, fields: [] };
        groups.push(group);
      }
      group.fields.push(field);
    }
    return groups;
  });

  $effect(() => {
    const sections = controller.sections;
    if (!sections.some((section) => section.key === selectedSectionKey)) {
      if (sections.length && !controller.loading) controller.setPosition({ sectionKey: sections[0]!.key });
    }
  });

  onMount(() => {
    void (async () => {
      await controller.open();
      await tick();
      if (scroller) scroller.scrollTop = controller.position.scrollTop;
    })();
  });

  async function write() {
    try {
      if (await controller.write()) {
        writeError = null;
        writeConfirmation = false;
      } else writeError = backendState.error ?? 'The configuration could not be written. Please try again.';
    } catch (error) {
      writeError = error instanceof Error ? error.message : 'The configuration could not be written. Please try again.';
    }
  }

  function confirmWrite() {
    writeConfirmation = true;
  }

  async function readValues(source: 'current' | 'default') {
    await controller.load(source);
    if (!controller.error) writeError = null;
  }

  function showHelp(field: RefloatConfigurationFieldContract, trigger: HTMLButtonElement) {
    helpField = field;
    helpTrigger = trigger;
  }

  function closeHelp() {
    helpField = null;
  }

  function selectSection(sectionKey: string) {
    controller.setPosition({ sectionKey, scrollTop: 0 });
    if (scroller) scroller.scrollTop = 0;
  }

  function toggleControls() {
    controller.setPosition({ controlsExpanded: !controlsExpanded });
  }
</script>

<section class="flex h-full min-h-0 flex-col" aria-labelledby="refloat-configuration-title">
  <div class="z-10 -mx-4 -mt-px max-h-[45%] min-h-12 overflow-y-auto border-y border-outline bg-surface px-4 py-1">
    <div class="flex min-h-11 items-center text-sm">
      {#if !controlsExpanded}
        <div class="max-w-[65%] min-w-0">
          <SegmentedControl
            label="Section"
            variant="compact"
            disabled={controller.loading || !controller.sections.length}
            value={selectedSection?.key ?? ''}
            options={controller.sections.map((section) => ({ value: section.key, label: section.label }))}
            onchange={selectSection}
          />
        </div>
      {/if}
      <button
        type="button"
        aria-label="Section and search controls"
        aria-expanded={controlsExpanded}
        aria-controls="refloat-configuration-controls"
        class="flex min-h-11 min-w-0 flex-1 touch-manipulation items-center justify-between gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-accent"
        onpointerdown={(event) => activateFromPointer(event, toggleControls)}
        onclick={(event) => activateFromKeyboardOrAssistiveClick(event, toggleControls)}
      >
        <span class="min-w-0 font-medium">
          {#if controlsExpanded}Section & search{:else if controller.search}<span class="text-muted">
              · Filtered</span
            >{/if}
        </span>
        <span class="shrink-0 text-muted">{controlsExpanded ? 'Hide controls' : 'Show controls'}</span>
      </button>
    </div>
    {#if controlsExpanded}
      <div id="refloat-configuration-controls" in:expandControls out:collapseControls class="space-y-2 pb-2">
        <div class="grid gap-2 sm:grid-cols-2">
          <div class="grid gap-1 text-sm">
            <span class="font-medium">Section</span>
            <SegmentedControl
              label="Section"
              disabled={controller.loading || !controller.sections.length}
              value={selectedSection?.key ?? ''}
              options={controller.sections.map((section) => ({ value: section.key, label: section.label }))}
              onchange={selectSection}
            />
          </div>
          <label class="grid gap-1 text-sm">
            <span class="font-medium">Search this section</span>
            <input
              type="search"
              placeholder="Search fields"
              class="w-full rounded-md border border-outline bg-elevated px-3 py-2"
              maxlength="512"
              value={controller.search}
              oninput={(event) => {
                controller.search = event.currentTarget.value;
                if (scroller) scroller.scrollTop = 0;
              }}
            />
          </label>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            class="touch-manipulation rounded-md border border-outline px-3 py-2 disabled:opacity-50"
            disabled={controller.loading || backendState.busy || controller.summary?.pendingOperation !== null}
            onpointerdown={(event) => activateFromPointer(event, () => readValues('current'))}
            onclick={(event) => activateFromKeyboardOrAssistiveClick(event, () => readValues('current'))}
            >Read current</button
          >
          <button
            type="button"
            class="touch-manipulation rounded-md border border-outline px-3 py-2 disabled:opacity-50"
            disabled={controller.loading || backendState.busy || controller.summary?.pendingOperation !== null}
            onpointerdown={(event) => activateFromPointer(event, () => readValues('default'))}
            onclick={(event) => activateFromKeyboardOrAssistiveClick(event, () => readValues('default'))}
            >Read defaults</button
          >
        </div>
        {#if !(controller.loading && !controller.pages.length) && !controller.error}
          <div class="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
            <span>
              Source: <strong>{controller.source === 'current' ? 'Current device values' : 'Firmware defaults'}</strong>
            </span>
            <span>{controller.diff.length} changed</span>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div
    bind:this={scroller}
    class="min-h-0 flex-1 scroll-pt-8 space-y-3 overflow-y-auto overscroll-contain pb-3 [overflow-anchor:none] *:first:mt-3"
    onscroll={() => {
      if (scroller && !controller.loading) controller.setPosition({ scrollTop: Math.max(0, scroller.scrollTop) });
    }}
  >
    {#if controller.saveError}
      <p role="alert" class="text-warning">{controller.saveError}</p>
      <button
        type="button"
        class="touch-manipulation rounded-md border border-outline px-3 py-2"
        onpointerdown={(event) =>
          activateFromPointer(event, async () => {
            if (controller.loaded) await controller.flush();
            else await controller.open();
          })}
        onclick={(event) =>
          activateFromKeyboardOrAssistiveClick(event, async () => {
            if (controller.loaded) await controller.flush();
            else await controller.open();
          })}>Retry draft save</button
      >
    {/if}
    {#if controller.restored && !controller.incompatible}
      <p class="text-sm text-muted">Draft restored · {controller.diff.length} changes</p>
    {/if}
    {#if controller.defaultError}
      <p role="alert" class="text-warning">{controller.defaultError}</p>
    {/if}
    {#if controller.incompatible}
      <div class="rounded-lg border border-warning/40 p-3 text-sm">
        <p>
          This saved draft uses a different firmware or schema and cannot be written. Read current or defaults to
          replace it.
        </p>
        {#each Object.entries(controller.incompatible.values) as [name, value] (name)}
          <p>{name}: {controller.incompatible.inputs[name] ?? formatRefloatValue(value)}</p>
        {/each}
      </div>
    {/if}
    {#if controller.loading && !controller.pages.length}
      <p class="text-muted">Loading audited Refloat schema…</p>
    {:else if controller.error}
      <p role="alert" class="text-warning">{controller.error}</p>
      <button
        type="button"
        class="touch-manipulation rounded-lg bg-elevated px-4 py-2"
        onpointerdown={(event) => activateFromPointer(event, () => controller.open())}
        onclick={(event) => activateFromKeyboardOrAssistiveClick(event, () => controller.open())}>Retry</button
      >
    {:else if selectedSection}
      <section class="grid gap-2" aria-labelledby="refloat-selected-section">
        <h3 id="refloat-selected-section" class="text-lg font-semibold">
          {selectedSection.group} · {selectedSection.subgroup}
        </h3>
        {#if subsections.length}
          {#each subsections as subsection (subsection.key)}
            <div class="grid gap-2 md:grid-cols-2">
              {#if subsection.heading}
                <h4
                  class="sticky top-0 z-10 border-b border-outline bg-canvas py-1 text-sm font-semibold text-muted md:col-span-2"
                >
                  {subsection.heading}
                </h4>
              {/if}
              {#each subsection.fields as field (field.name)}
                <RefloatConfigurationField
                  {field}
                  value={controller.draft[field.name]}
                  error={controller.validationErrors[field.name]}
                  disabled={controller.loading || backendState.busy || !controller.loaded || !!controller.incompatible}
                  input={controller.inputs[field.name]}
                  onnumericinput={(input) => controller.setNumericInput(field.name, input)}
                  onchange={(value) => controller.setValue(field.name, value)}
                  ondefault={() => controller.useDefault(field.name)}
                  onhelp={showHelp}
                />
              {/each}
            </div>
          {/each}
        {:else}
          <p class="rounded-lg border border-outline p-3 text-sm text-muted">No fields match this search.</p>
        {/if}
      </section>
    {/if}
  </div>

  {#if controller.pages.length}
    <div
      class="-mx-4 grid shrink-0 gap-2 border-t border-outline bg-surface px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom,0px))] shadow-[0_-4px_8px_-6px_rgb(0_0_0_/_0.35)]"
    >
      {#if writeError || readinessWarning}
        <div
          class="max-h-[min(10rem,30dvh)] space-y-2 overflow-y-auto rounded-md border border-warning/40 bg-warning/10 p-2 text-sm text-warning"
        >
          {#if writeError}
            <p role="alert"><strong>Write could not be confirmed.</strong> {writeError}</p>
          {/if}
          {#if readinessWarning}
            <p id="refloat-write-readiness" role="status" aria-live="polite">{readinessWarning}</p>
          {/if}
        </div>
      {/if}
      <button
        type="button"
        class="min-h-11 touch-manipulation rounded-md bg-accent-fill px-3 py-2 text-sm leading-tight text-on-accent disabled:opacity-50"
        aria-describedby={readinessWarning ? 'refloat-write-readiness' : undefined}
        disabled={!controller.canWrite || controller.loading || backendState.busy}
        onpointerdown={(event) => activateFromPointer(event, confirmWrite)}
        onclick={(event) => activateFromKeyboardOrAssistiveClick(event, confirmWrite)}>Write configuration</button
      >
    </div>
  {/if}
</section>

<InformationDialog
  open={helpField !== null}
  titleId="refloat-field-help-title"
  title={helpField ? refloatConfigurationFieldLabel(helpField) : ''}
  description={helpField ? refloatConfigurationFieldHelp(helpField) : ''}
  returnFocus={helpTrigger}
  onclose={closeHelp}
/>

<ConfirmDialog
  open={writeConfirmation}
  titleId="refloat-write-confirmation-title"
  contentLabel="Configuration comparison"
  title="Write persistent Refloat configuration?"
  description="This writes one complete configuration and verifies every value by reading it back."
  confirmLabel="Write and verify"
  appearance="warning"
  busy={controller.loading || backendState.busy}
  confirmDisabled={!controller.canWrite}
  error={controller.loading ? null : [writeError, readinessWarning].filter(Boolean).join(' ') || null}
  onconfirm={write}
  oncancel={() => {
    writeConfirmation = false;
  }}
>
  <RefloatConfigurationDiff
    changes={controller.diff}
    fields={controller.fields}
    beforeLabel="Current"
    afterLabel="New"
  />
</ConfirmDialog>
