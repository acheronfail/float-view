<script lang="ts">
  import { navigationLink } from './navigation-link';
  import type { Snippet } from 'svelte';
  import { activateFromKeyboardOrAssistiveClick, activateFromPointer, type Activation } from './activation';

  type ListItemProps = {
    title: string;
    subtitle: string;
    href?: string;
    trailing?: Snippet;
    leading?: Snippet;
    onactivate?: Activation;
    disabled?: boolean;
    emphasized?: boolean;
  };

  let {
    title,
    subtitle,
    href,
    trailing,
    leading,
    onactivate,
    disabled = false,
    emphasized = false,
  }: ListItemProps = $props();
  const interactiveClass = $derived(
    'flex w-full min-w-0 touch-manipulation items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors motion-feedback motion-reduce:transition-none active:border-accent active:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ' +
      (emphasized
        ? ' border-accent bg-accent-soft hover:bg-accent-soft/80 disabled:hover:bg-accent-soft'
        : ' border-transparent bg-elevated hover:border-outline hover:bg-surface disabled:hover:border-transparent disabled:hover:bg-elevated')
  );
</script>

{#if href}
  <a class={interactiveClass} {href} use:navigationLink>
    {#if leading}{@render leading()}{/if}
    <span class="block min-w-0 flex-1">
      <span class="block font-medium">{title}</span>
      <span class="text-sm text-muted">{subtitle}</span>
    </span>
    {#if trailing}{@render trailing()}{/if}
  </a>
{:else if onactivate}
  <button
    type="button"
    class={interactiveClass}
    {disabled}
    onpointerdown={(event) => activateFromPointer(event, onactivate)}
    onclick={(event) => activateFromKeyboardOrAssistiveClick(event, onactivate)}
  >
    {#if leading}{@render leading()}{/if}
    <span class="block min-w-0 flex-1">
      <span class="block font-medium">{title}</span>
      <span class="text-sm text-muted">{subtitle}</span>
    </span>
    {#if trailing}{@render trailing()}{/if}
  </button>
{:else}
  <div class="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-elevated p-3">
    {#if leading}{@render leading()}{/if}
    <div class="min-w-0 flex-1">
      <span class="block font-medium">{title}</span>
      <span class="text-sm text-muted">{subtitle}</span>
    </div>
    {#if trailing}{@render trailing()}{/if}
  </div>
{/if}
