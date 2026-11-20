<script lang="ts">
  import { backDismissal } from '$lib/ui/back-dismissal';
  import { createMotion } from '$lib/ui/motion';
  import { onMount } from 'svelte';
  import type { AppHeaderAction } from './header';
  import Icon from '$lib/ui/Icon.svelte';
  import ToggleIndicator from '$lib/ui/ToggleIndicator.svelte';
  import { activateFromKeyboardOrAssistiveClick, activateFromPointer } from '$lib/ui/activation';
  import { wrappedDialogFocus } from '$lib/ui/dialog';

  const motion = createMotion();

  let {
    label,
    subtitle,
    actions,
    unavailable = false,
    warning,
    button = $bindable(),
    open = $bindable(false),
  }: {
    label: string;
    subtitle: string;
    actions: AppHeaderAction[];
    unavailable?: boolean;
    warning?: string;
    button?: HTMLButtonElement;
    open?: boolean;
  } = $props();

  const titleId = $props.id();
  let dialog: HTMLDialogElement;
  let activationFrame: number | undefined;
  const groups = $derived([...new Set(actions.map((action) => action.group ?? 'Actions'))]);

  onMount(() => () => {
    if (activationFrame !== undefined) cancelAnimationFrame(activationFrame);
    dialog.close();
  });

  $effect(() => {
    if (open && !dialog.open && !unavailable) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (unavailable && open) close(false);
  });

  function show() {
    if (unavailable) return;
    dialog.showModal();
    open = true;
  }

  function close(keyboard: boolean) {
    if (activationFrame !== undefined) cancelAnimationFrame(activationFrame);
    activationFrame = undefined;
    dialog.close();
    open = false;
    if (keyboard) button?.focus();
    else button?.blur();
  }

  function activate(action: AppHeaderAction, keyboard: boolean) {
    if (action.disabled || action.pending || action.checked === null || unavailable || activationFrame !== undefined)
      return;
    if (keyboard) {
      void action.onactivate(() => close(true));
      return;
    }
    // Scrollable tiles retain the touch gesture's default mouse events. Let
    // those finish before handing focus to another dialog or route.
    activationFrame = requestAnimationFrame(() => {
      activationFrame = undefined;
      if (!open || action.disabled || action.pending || action.checked === null || unavailable) return;
      void action.onactivate(() => close(false));
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const active = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    const target = wrappedDialogFocus(active, controls, event.shiftKey);
    if (!target) return;
    event.preventDefault();
    target.focus();
  }
</script>

<button
  bind:this={button}
  type="button"
  class={`grid h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-full border disabled:opacity-50 ${warning ? 'border-warning/40 bg-warning/10 text-warning' : 'border-outline bg-surface'}`}
  title={warning}
  aria-label={label}
  aria-haspopup="dialog"
  aria-expanded={open}
  disabled={unavailable}
  onpointerdown={(event) => activateFromPointer(event, show, { preventPointerDownDefault: true })}
  onclick={(event) => activateFromKeyboardOrAssistiveClick(event, show)}
>
  <Icon name="ellipsis-vertical" class="text-xl" />
</button>

<dialog
  use:backDismissal={{ close: () => close(true), enabled: open }}
  use:motion.surface={'panel'}
  bind:this={dialog}
  aria-labelledby={titleId}
  onkeydown={handleKeydown}
  class="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-canvas p-0 text-foreground backdrop:bg-canvas"
  oncancel={(event) => {
    event.preventDefault();
    event.stopPropagation();
    close(true);
  }}
>
  <div class="app-safe-area app-safe-area-without-tabs mx-auto flex h-full min-h-0 max-w-3xl flex-col">
    <header class="flex shrink-0 items-center justify-between gap-3 border-b border-outline pb-3">
      <div class="min-w-0">
        <h2 id={titleId} class="text-xl font-bold">{label}</h2>
        <p class="mt-1 truncate text-sm text-muted">{subtitle}</p>
      </div>
      <button
        type="button"
        class="min-h-11 shrink-0 touch-manipulation rounded-lg border border-outline px-4"
        onpointerdown={(event) => activateFromPointer(event, () => close(false))}
        onclick={(event) => activateFromKeyboardOrAssistiveClick(event, () => close(true))}>Done</button
      >
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain py-3">
      <div class="space-y-4">
        {#if warning}
          <p class="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm" role="status">
            {warning}
          </p>
        {/if}
        {#each groups as group, index (group)}
          {@const groupActions = actions.filter((action) => (action.group ?? 'Actions') === group)}
          {@const threeColumns =
            groupActions.length === 3 || groupActions.some((action) => action.selected !== undefined)}
          {@const stacked = groupActions.length === 3 && !groupActions.some((action) => action.selected !== undefined)}
          <section aria-labelledby={`${titleId}-${index}`}>
            <h3 id={`${titleId}-${index}`} class="mb-2 text-xs font-semibold tracking-widest text-muted uppercase">
              {group}
            </h3>
            <div class="grid gap-2" class:grid-cols-3={threeColumns} class:grid-cols-2={!threeColumns}>
              {#each groupActions as action (action.label)}
                <button
                  type="button"
                  aria-label={action.label}
                  aria-current={action.selected ? 'page' : undefined}
                  role={typeof action.checked === 'boolean' ? 'switch' : undefined}
                  aria-checked={typeof action.checked === 'boolean' ? action.checked : undefined}
                  aria-describedby={action.checked === null ? `${titleId}-unknown-${action.label}` : undefined}
                  aria-busy={action.pending || undefined}
                  disabled={action.disabled || action.pending || action.checked === null}
                  class={`flex min-h-14 min-w-0 touch-pan-y items-center gap-2 rounded-lg border border-outline px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${action.selected ? 'bg-accent-soft text-on-accent-soft' : 'bg-surface hover:bg-elevated'} ${stacked ? 'max-sm:flex-col max-sm:justify-center max-sm:text-center' : ''}`}
                  class:text-danger={action.appearance === 'destructive' || action.appearance === 'danger'}
                  class:text-warning={action.appearance === 'warning'}
                  onpointerdown={(event) => activateFromPointer(event, () => activate(action, false))}
                  onclick={(event) => activateFromKeyboardOrAssistiveClick(event, () => activate(action, true))}
                >
                  {#if action.icon}<Icon name={action.icon} class="shrink-0 text-lg" />{/if}
                  <span class={`min-w-0 flex-1 ${stacked ? 'max-sm:flex-none' : ''}`}>
                    <span class="block text-sm font-medium">{action.label}</span>
                    {#if action.pending}
                      <span class="block text-xs text-muted">Pending…</span>
                    {:else if action.checked === null}
                      <span id={`${titleId}-unknown-${action.label}`} class="block text-xs text-muted">Unknown</span>
                    {:else if action.disabled}
                      <span class="block text-xs text-muted">Unavailable</span>
                    {/if}
                  </span>
                  {#if typeof action.checked === 'boolean'}
                    <ToggleIndicator checked={action.checked} />
                  {/if}
                  {#if action.appearance === 'warning' && action.icon !== 'triangle-alert'}
                    <Icon name="triangle-alert" class="shrink-0 text-lg" />
                  {/if}
                </button>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    </div>
  </div>
</dialog>
