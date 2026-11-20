<script lang="ts" module>
  export type DialogAppearance = 'normal' | 'warning' | 'destructive';
</script>

<script lang="ts">
  import { backDismissal } from '$lib/ui/back-dismissal';
  import { createMotion } from './motion';
  import { tick, type Snippet } from 'svelte';
  import { activateFromKeyboardOrAssistiveClick, activateFromPointer, type Activation } from './activation';

  const { appear: appearSurface, exit: exitSurface, surface: enterSurface } = createMotion();

  let {
    open,
    titleId,
    title,
    description,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    appearance = 'normal',
    busy = false,
    confirmDisabled = false,
    showConfirm = true,
    error = null,
    onconfirm,
    oncancel,
    ondismiss = oncancel,
    dismissLabel = cancelLabel,
    children,
    contentLabel,
    returnFocus,
  }: {
    open: boolean;
    titleId: string;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    appearance?: DialogAppearance;
    busy?: boolean;
    confirmDisabled?: boolean;
    /** Close-only feedback can retain this dialog and its focus handling. */
    showConfirm?: boolean;
    error?: string | null;
    onconfirm: Activation;
    oncancel: Activation;
    /** Optional dismissal action when the secondary button has another purpose. */
    ondismiss?: Activation;
    dismissLabel?: string;
    children?: Snippet;
    /** Makes long confirmation content a labelled keyboard-scrollable region. */
    contentLabel?: string;
    returnFocus?: HTMLElement;
  } = $props();

  let dialog = $state<HTMLElement>();
  let cancelButton = $state<HTMLButtonElement>();

  $effect(() => {
    if (!open || typeof document === 'undefined') return;
    const previouslyFocused =
      returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
    void tick().then(() => cancelButton?.focus());
    return () => {
      void tick().then(() => previouslyFocused?.focus());
    };
  });

  $effect(() => {
    if (open && !showConfirm) void tick().then(() => cancelButton?.focus());
  });

  function cancel() {
    if (!busy) void oncancel();
  }

  function dismiss() {
    if (!busy) void ondismiss();
  }

  function confirm() {
    if (!busy && !confirmDisabled) void onconfirm();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open) return;

    if (event.key !== 'Tab' || !dialog) return;
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div in:appearSurface={'content'} out:exitSurface class="fixed inset-0 z-50 grid place-items-center p-4">
    <button
      type="button"
      class="absolute inset-0 h-full w-full cursor-default touch-none bg-black/60"
      aria-label={dismissLabel}
      onpointerdown={(event) => activateFromPointer(event, dismiss, { preventPointerDownDefault: true })}
      onclick={(event) => activateFromKeyboardOrAssistiveClick(event, dismiss)}
    ></button>
    <div
      use:enterSurface={'dialog'}
      bind:this={dialog}
      use:backDismissal={{ close: dismiss }}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? `${titleId}-description` : undefined}
      class="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col rounded-2xl border border-outline bg-surface p-5 shadow-2xl"
    >
      <h2 id={titleId} class="shrink-0 text-xl font-semibold break-words">{title}</h2>
      <!-- Scrollable confirmation content needs keyboard access. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="min-h-0 overflow-y-auto overscroll-contain"
        role={contentLabel ? 'region' : undefined}
        aria-label={contentLabel}
        tabindex={contentLabel ? 0 : undefined}
      >
        {#if description}<p id={`${titleId}-description`} class="mt-2 text-sm leading-6 text-muted">
            {description}
          </p>{/if}
        {#if children}
          <div class="mt-4">{@render children()}</div>
        {/if}
      </div>
      {#if error}<p role="alert" class="mt-3 shrink-0 text-sm text-warning">{error}</p>{/if}
      <div class="mt-6 flex shrink-0 flex-wrap justify-end gap-3">
        <button
          bind:this={cancelButton}
          type="button"
          class="touch-manipulation rounded-lg border border-outline px-4 py-2 disabled:opacity-50"
          disabled={busy}
          onpointerdown={(event) => activateFromPointer(event, cancel, { preventPointerDownDefault: true })}
          onclick={(event) => activateFromKeyboardOrAssistiveClick(event, cancel)}>{cancelLabel}</button
        >
        {#if showConfirm}<button
            type="button"
            class="touch-manipulation rounded-lg px-4 py-2 font-medium disabled:opacity-50"
            class:bg-danger={appearance === 'destructive'}
            class:text-on-danger={appearance === 'destructive'}
            class:bg-warning={appearance === 'warning'}
            class:text-on-warning={appearance === 'warning'}
            class:bg-accent-fill={appearance === 'normal'}
            class:text-on-accent={appearance === 'normal'}
            disabled={busy || confirmDisabled}
            onpointerdown={(event) => activateFromPointer(event, confirm)}
            onclick={(event) => activateFromKeyboardOrAssistiveClick(event, confirm)}
            >{busy ? 'Working…' : confirmLabel}</button
          >{/if}
      </div>
    </div>
  </div>
{/if}
