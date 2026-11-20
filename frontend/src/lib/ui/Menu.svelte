<script lang="ts">
  import { backDismissal } from '$lib/ui/back-dismissal';
  import { createMotion } from './motion';
  import type { Snippet } from 'svelte';
  import { activateFromKeyboardOrAssistiveClick, activateFromPointer, isPrimaryPointerActivation } from './activation';
  import Icon from './Icon.svelte';

  const { appear: appearSurface, exit: exitSurface } = createMotion();

  let {
    label,
    variant = 'default',
    disabled = false,
    children,
    button = $bindable(),
    menuOpen = $bindable(false),
  }: {
    label: string;
    variant?: 'default' | 'card';
    disabled?: boolean;
    children: Snippet<[close: () => void]>;
    button?: HTMLButtonElement;
    menuOpen?: boolean;
  } = $props();

  let menuRoot = $state<HTMLDivElement>();
  let menuPanel = $state<HTMLDivElement>();
  let openAbove = $state(false);
  $effect(() => {
    if (!menuOpen || variant !== 'card' || !button || !menuPanel) return;
    const bounds = button.getBoundingClientRect();
    openAbove = window.innerHeight - bounds.bottom < menuPanel.offsetHeight && bounds.top >= menuPanel.offsetHeight;
  });

  function closeMenu() {
    menuOpen = false;
    button?.focus();
  }

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function dismissOnOutsidePointer(event: PointerEvent) {
    if (!menuOpen || !menuRoot || !isPrimaryPointerActivation(event)) return;
    if (!(event.target instanceof Node) || !menuRoot.contains(event.target)) closeMenu();
  }
</script>

<svelte:window onpointerdown={dismissOnOutsidePointer} />

<div
  use:backDismissal={{ close: closeMenu, enabled: menuOpen }}
  bind:this={menuRoot}
  class="relative shrink-0"
  class:self-stretch={variant === 'card'}
>
  <button
    bind:this={button}
    type="button"
    class={variant === 'card'
      ? 'grid h-full min-h-11 w-16 touch-pan-y place-items-center rounded-r-xl border-l border-outline text-muted hover:bg-surface disabled:opacity-50'
      : 'grid h-11 w-11 touch-manipulation place-items-center rounded-full border border-outline bg-surface'}
    {disabled}
    aria-label={label}
    aria-expanded={menuOpen}
    onpointerdown={(event) => activateFromPointer(event, toggleMenu)}
    onclick={(event) => activateFromKeyboardOrAssistiveClick(event, toggleMenu)}
  >
    <Icon name="ellipsis-vertical" class="text-xl" />
  </button>
  {#if menuOpen}
    <div
      in:appearSurface={'menu'}
      out:exitSurface
      class="absolute right-0 z-30 w-max max-w-[calc(100dvw-2rem-env(safe-area-inset-left,0px)-env(safe-area-inset-right,0px))] min-w-[min(13rem,calc(100dvw-2rem))] overflow-hidden rounded-xl border border-outline bg-elevated shadow-xl"
      bind:this={menuPanel}
      class:top-full={variant === 'card' && !openAbove}
      class:bottom-full={variant === 'card' && openAbove}
      class:top-12={variant !== 'card'}
    >
      {@render children(closeMenu)}
    </div>
  {/if}
</div>
