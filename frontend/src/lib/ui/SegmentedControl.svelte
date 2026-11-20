<script lang="ts" generics="T extends string | number | boolean">
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from './activation';

  let {
    label,
    options,
    value,
    disabled = false,
    variant = 'default',
    describedby,
    id,
    onchange,
  }: {
    label: string;
    options: { value: T; label: string; disabled?: boolean; group?: string }[];
    value: T;
    disabled?: boolean;
    variant?: 'default' | 'compact';
    describedby?: string;
    id?: string;
    onchange: (value: T) => void;
  } = $props();

  const choices = $derived(options.filter((option) => !option.disabled));
  const groups = $derived([...new Set(options.map((option) => option.group))]);
  function select(next: T) {
    if (!disabled && next !== value) onchange(next);
  }
</script>

{#if variant === 'default' && choices.length > 0 && choices.length <= 3}
  <div
    {id}
    role="group"
    aria-label={label}
    aria-describedby={describedby}
    class="flex w-full flex-wrap gap-1 rounded-xl border border-outline bg-surface p-1"
  >
    {#each choices as option (option.value)}
      <button
        type="button"
        disabled={disabled || option.disabled}
        aria-pressed={value === option.value}
        class="motion-feedback min-h-11 min-w-11 flex-[1_1_5rem] touch-manipulation rounded-lg px-2 py-2 text-sm font-medium [overflow-wrap:anywhere] text-muted transition-colors select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 aria-pressed:bg-accent-fill aria-pressed:text-on-accent aria-pressed:shadow-sm motion-reduce:transition-none"
        onpointerdown={(event) => activateFromPointer(event, () => select(option.value))}
        onclick={(event) => activateFromKeyboardOrAssistiveClick(event, () => select(option.value))}
        >{option.label}</button
      >
    {/each}
  </div>
{:else}
  <div class="relative w-full min-w-0">
    <select
      {id}
      {disabled}
      aria-label={label}
      aria-describedby={describedby}
      class="min-h-11 w-full max-w-full min-w-0 touch-manipulation appearance-none rounded-md border py-2 pr-9 pl-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
      class:border-outline={variant === 'default'}
      class:bg-elevated={variant === 'default'}
      class:border-transparent={variant === 'compact'}
      class:bg-surface={variant === 'compact'}
      class:font-medium={variant === 'compact'}
      value={String(value)}
      onchange={(event) => {
        const option = options.find((option) => String(option.value) === event.currentTarget.value);
        if (!disabled && option && !option.disabled) onchange(option.value);
      }}
    >
      {#each groups as group (group)}
        {#if group}
          <optgroup label={group}>
            {#each options.filter((option) => option.group === group) as option (option.value)}
              <option value={String(option.value)} disabled={option.disabled}>{option.label}</option>
            {/each}
          </optgroup>
        {:else}
          {#each options.filter((option) => !option.group) as option (option.value)}
            <option value={String(option.value)} disabled={option.disabled}>{option.label}</option>
          {/each}
        {/if}
      {/each}
    </select>
    <span
      aria-hidden="true"
      class="pointer-events-none absolute top-1/2 right-3 size-2 -translate-y-3/4 rotate-45 border-r-2 border-b-2 border-muted"
      class:opacity-50={disabled}
    ></span>
  </div>
{/if}
