<script lang="ts">
  import SegmentedControl from '$lib/ui/SegmentedControl.svelte';
  import type { RefloatConfigurationField, RefloatConfigurationValue } from '$lib/backend/contract';
  import { activateFromKeyboardOrAssistiveClick, activateFromPointer } from '$lib/ui/activation';
  import {
    refloatConfigurationFieldLabel,
    refloatNumericEditor,
    refloatNumericInput,
    refloatNumericText,
  } from './refloat-configuration.svelte';

  let {
    field,
    value,
    disabled = false,
    error = null,
    input,
    onnumericinput,
    onchange,
    ondefault,
    onhelp,
  }: {
    field: RefloatConfigurationField;
    value: RefloatConfigurationValue | undefined;
    disabled?: boolean;
    error?: string | null;
    input?: string;
    onnumericinput?: (input: string) => void;
    onchange: (value: RefloatConfigurationValue) => void;
    ondefault: () => void | Promise<void>;
    onhelp: (field: RefloatConfigurationField, trigger: HTMLButtonElement) => void;
  } = $props();

  const label = $derived(refloatConfigurationFieldLabel(field));
  const fieldId = $derived(`refloat-${field.name.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`);
  const errorId = $derived(`${fieldId}-error`);
  // Mobile numeric keypads may omit minus, so keep the default keyboard for signed or unbounded fields.
  const inputMode = $derived(
    field.minimum !== null && field.minimum >= 0 ? (field.type === 'double' ? 'decimal' : 'numeric') : undefined
  );
  let helpButton = $state<HTMLButtonElement>();
  const editor = $derived(refloatNumericEditor(field));
  const displayed = $derived(
    input !== undefined
      ? input.trim() && Number.isFinite(Number(input))
        ? refloatNumericText(field, Number(input))
        : input
      : value?.type === 'double' || value?.type === 'integer'
        ? refloatNumericText(field, value.value)
        : ''
  );
  let editing = $state(false);
  let text = $state('');
  let editingInput = $state<string | undefined>();
</script>

<div class="block rounded-lg border border-outline bg-elevated p-3 text-sm">
  <span class="flex items-center justify-between gap-2">
    <span class="font-medium">{label}</span>
    <span class="flex shrink-0 items-center gap-1">
      <button
        type="button"
        class="min-h-8 touch-manipulation rounded-md border border-outline px-2 text-xs disabled:opacity-50"
        {disabled}
        aria-label={`Use default for ${label}`}
        title="Use firmware default"
        onpointerdown={(event) => activateFromPointer(event, ondefault)}
        onclick={(event) => activateFromKeyboardOrAssistiveClick(event, ondefault)}>Default</button
      >
      <button
        bind:this={helpButton}
        type="button"
        class="min-h-8 min-w-8 shrink-0 touch-manipulation rounded-md border border-outline px-1 text-xs"
        aria-label={`Show help for ${label}`}
        onpointerdown={(event) => activateFromPointer(event, () => helpButton && onhelp(field, helpButton))}
        onclick={(event) => activateFromKeyboardOrAssistiveClick(event, () => helpButton && onhelp(field, helpButton))}
        >(?)</button
      >
    </span>
  </span>
  {#if field.type === 'boolean'}
    <div class="mt-2">
      <SegmentedControl
        id={fieldId}
        {label}
        options={[
          { value: false, label: 'Off' },
          { value: true, label: 'On' },
        ]}
        value={value?.type === 'boolean' && value.value}
        {disabled}
        describedby={error ? errorId : undefined}
        onchange={(value) => onchange({ type: 'boolean', value })}
      />
    </div>
  {:else if field.type === 'enum'}
    <div class="mt-2">
      <SegmentedControl
        id={fieldId}
        {label}
        options={field.choices.map((label, value) => ({ label, value }))}
        value={value?.type === 'integer' ? value.value : 0}
        {disabled}
        describedby={error ? errorId : undefined}
        onchange={(value) => onchange({ type: 'integer', value })}
      />
    </div>
  {:else if field.type === 'string'}
    <input
      id={fieldId}
      aria-label={label}
      type="text"
      maxlength="4096"
      class="mt-2 w-full rounded-md border border-outline bg-surface px-3 py-2"
      {disabled}
      aria-describedby={error ? errorId : undefined}
      value={value?.type === 'string' ? value.value : ''}
      oninput={(event) => onchange({ type: 'string', value: event.currentTarget.value })}
    />
  {:else}
    <div class="mt-2 flex items-center gap-2">
      <input
        id={fieldId}
        aria-label={label}
        type="number"
        inputmode={inputMode}
        class="min-w-0 flex-1 rounded-md border border-outline bg-surface px-3 py-2"
        min={editor.minimum}
        max={editor.maximum}
        step={editor.step}
        {disabled}
        aria-describedby={error ? errorId : undefined}
        value={editing && (!onnumericinput || input === editingInput) ? text : displayed}
        onfocus={() => {
          text = displayed;
          editingInput = input;
          editing = true;
        }}
        onblur={() => {
          editing = false;
        }}
        oninput={(event) => {
          text = event.currentTarget.value;
          const canonical = refloatNumericInput(field, text);
          editingInput = canonical;
          editing = true;
          if (onnumericinput) {
            onnumericinput(canonical);
            return;
          }
          const number = canonical.trim() ? Number(canonical) : NaN;
          if (!Number.isFinite(number)) return;
          onchange(field.type === 'double' ? { type: 'double', value: number } : { type: 'integer', value: number });
        }}
      />
      {#if editor.suffix}<span class="text-muted">{editor.suffix}</span>{/if}
    </div>
  {/if}
  {#if error}<span id={errorId} role="alert" class="mt-1 block text-xs text-warning">{error}</span>{/if}
</div>
