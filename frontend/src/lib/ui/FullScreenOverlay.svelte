<script lang="ts">
  import { backDismissal } from '$lib/ui/back-dismissal';
  import { createMotion } from './motion';
  import { onMount, tick, type Snippet } from 'svelte';
  import { activateFromKeyboardOrAssistiveClick, activateFromPointer, type Activation } from './activation';
  import { wrappedDialogFocus } from './dialog';

  const { appear: appearSurface, exit: exitSurface } = createMotion();

  let {
    title,
    titleId,
    closeLabel = 'Done',
    closeDisabled = false,
    fixedContent = false,
    headerShadow = false,
    onclose,
    children,
  }: {
    title: string;
    titleId: string;
    closeLabel?: string;
    closeDisabled?: boolean;
    fixedContent?: boolean;
    headerShadow?: boolean;
    onclose: Activation;
    children: Snippet;
  } = $props();

  let dialog = $state<HTMLElement>();
  let closeButton = $state<HTMLButtonElement>();
  let closing = $state(false);

  let focusFrame: number | undefined;
  let focusGeneration = 0;
  function focusCloseButton() {
    const generation = ++focusGeneration;
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
    void tick().then(() => {
      if (generation !== focusGeneration) return;
      const focusIfOutside = () => {
        if (dialog && !dialog.inert && !dialog.contains(document.activeElement)) closeButton?.focus();
      };
      // Focus as soon as the panel is visible. Retry after a preceding native
      // dialog releases focus, without resetting a user's first Tab movement.
      focusIfOutside();
      focusFrame = requestAnimationFrame(focusIfOutside);
    });
  }
  onMount(() => {
    focusCloseButton();
    return () => {
      focusGeneration++;
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
    };
  });

  async function close() {
    if (closing || closeDisabled) return;
    closing = true;
    try {
      await onclose();
    } finally {
      closing = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    // A confirmation above this overlay owns its own keyboard handling.
    if (event.defaultPrevented || dialog?.inert) return;
    const focusedDialog = document.activeElement?.closest('dialog, [role="dialog"], [role="alertdialog"]');
    if (focusedDialog && focusedDialog !== dialog) return;

    if (event.key !== 'Tab' || !dialog) return;
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )
    );
    // Some WebViews clear focus after a cancelled pointer gesture. Keep the
    // next Tab inside the active panel even while focus is temporarily outside.
    if (focusedDialog !== dialog) {
      event.preventDefault();
      (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
      return;
    }
    const target = wrappedDialogFocus(
      document.activeElement instanceof HTMLElement ? document.activeElement : null,
      controls,
      event.shiftKey
    );
    if (target) {
      event.preventDefault();
      target.focus();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  use:backDismissal={{ close }}
  in:appearSurface|global={'panel'}
  out:exitSurface|global
  onintrostart={focusCloseButton}
  bind:this={dialog}
  role="dialog"
  aria-modal="true"
  aria-labelledby={titleId}
  class="fixed inset-0 z-40 h-dvh w-screen bg-canvas text-foreground"
>
  <div
    class:app-safe-area-without-tabs={!fixedContent}
    class="app-safe-area mx-auto flex h-full min-h-0 max-w-3xl flex-col"
  >
    <header
      class={`relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-outline bg-canvas pb-3 ${headerShadow ? 'shadow-[0_4px_8px_-4px_rgb(0_0_0_/_0.35)]' : ''}`}
    >
      <h2 id={titleId} class="min-w-0 text-xl font-bold">{title}</h2>
      <button
        bind:this={closeButton}
        type="button"
        class="min-h-11 shrink-0 touch-manipulation rounded-lg border border-outline px-4"
        disabled={closing || closeDisabled}
        onpointerdown={(event) => activateFromPointer(event, close, { preventPointerDownDefault: true })}
        onclick={(event) => activateFromKeyboardOrAssistiveClick(event, close)}
        >{closing ? 'Saving…' : closeLabel}</button
      >
    </header>
    <div
      class:overflow-y-auto={!fixedContent}
      class:overscroll-contain={!fixedContent}
      class:py-3={!fixedContent}
      class="min-h-0 flex-1"
    >
      {@render children()}
    </div>
  </div>
</div>
