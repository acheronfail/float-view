<script lang="ts">
  import { backDismissal } from '$lib/ui/back-dismissal';
  import { createMotion } from './motion';
  import { tick } from 'svelte';
  import { activateFromKeyboardOrAssistiveClick, activateFromPointer, type Activation } from './activation';
  import { restoreDialogFocus, wrappedDialogFocus } from './dialog';

  const { appear: appearSurface, exit: exitSurface, surface: enterSurface } = createMotion();

  let {
    open,
    titleId,
    title,
    description,
    returnFocus,
    onclose,
  }: {
    open: boolean;
    titleId: string;
    title: string;
    description: string;
    returnFocus?: HTMLElement;
    onclose: Activation;
  } = $props();

  let dialog = $state<HTMLElement>();
  let doneButton = $state<HTMLButtonElement>();
  let scrollable = $state(false);
  let moreAbove = $state(false);
  let moreBelow = $state(false);

  function updateScrollHints(node: HTMLElement) {
    scrollable = node.scrollHeight > node.clientHeight + 1;
    moreAbove = scrollable && node.scrollTop > 1;
    moreBelow = scrollable && node.scrollTop + node.clientHeight < node.scrollHeight - 1;
  }

  function observeDescription(node: HTMLElement) {
    const observer = new ResizeObserver(() => updateScrollHints(node));
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    updateScrollHints(node);
    return { destroy: () => observer.disconnect() };
  }

  $effect(() => {
    if (!open || typeof document === 'undefined') return;
    const focusTarget = returnFocus;
    void tick().then(() => doneButton?.focus());
    return () => restoreDialogFocus(focusTarget);
  });

  function close() {
    void onclose();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open) return;

    if (event.key !== 'Tab' || !dialog) return;
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )
    );
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = wrappedDialogFocus(activeElement, controls, event.shiftKey);
    if (!target) return;
    event.preventDefault();
    target.focus();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div
    in:appearSurface={'content'}
    out:exitSurface
    class="fixed inset-0 z-50 flex items-center justify-center pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]"
  >
    <button
      type="button"
      class="absolute inset-0 h-full w-full cursor-default touch-none bg-black/60"
      aria-label="Close help"
      onpointerdown={(event) => activateFromPointer(event, close, { preventPointerDownDefault: true })}
      onclick={(event) => activateFromKeyboardOrAssistiveClick(event, close)}
    ></button>
    <div
      use:enterSurface={'dialog'}
      bind:this={dialog}
      use:backDismissal={{ close }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-description`}
      class="relative flex max-h-full min-h-0 w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-outline bg-surface p-5 shadow-2xl"
    >
      <h2 id={titleId} class="shrink-0 text-xl font-semibold">{title}</h2>
      <!-- The scroll region needs focus so keyboard users can read the entire description. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        use:observeDescription
        id={`${titleId}-description`}
        role="region"
        aria-label={`${title} help`}
        tabindex="0"
        onscroll={(event) => updateScrollHints(event.currentTarget)}
        class:scrollable
        class:more-above={moreAbove}
        class:more-below={moreBelow}
        class="help-description mt-2 min-h-0 touch-pan-y overflow-y-auto overscroll-contain p-3 text-sm leading-6 wrap-anywhere whitespace-pre-wrap text-muted"
      >
        <div>{description}</div>
      </div>
      <div class="mt-6 flex shrink-0 justify-end">
        <button
          bind:this={doneButton}
          type="button"
          class="touch-manipulation rounded-lg bg-accent-fill px-4 py-2 font-medium text-on-accent"
          onpointerdown={(event) => activateFromPointer(event, close, { preventPointerDownDefault: true })}
          onclick={(event) => activateFromKeyboardOrAssistiveClick(event, close)}>Done</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  .help-description {
    --help-shadow-above: transparent;
    --help-shadow-below: transparent;
  }

  .scrollable {
    box-shadow:
      inset 0 10px 10px -10px var(--help-shadow-above),
      inset 0 -10px 10px -10px var(--help-shadow-below);
  }

  .more-above {
    --help-shadow-above: color-mix(in srgb, var(--app-foreground) 24%, transparent);
  }

  .more-below {
    --help-shadow-below: color-mix(in srgb, var(--app-foreground) 24%, transparent);
  }
</style>
