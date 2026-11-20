<script lang="ts">
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import { createThemeToggle } from './theme-toggle.svelte';
  import ThemeToggleDisplay from './ThemeToggleDisplay.svelte';
  let { preview = false }: { preview?: boolean } = $props();
  const appearance = createThemeToggle();
</script>

<button
  type="button"
  aria-label="Light / dark mode"
  aria-pressed={appearance.theme === 'dark'}
  aria-busy={appearance.pending}
  disabled={preview || appearance.disabled}
  class="flex h-full min-h-11 w-full touch-pan-y items-center justify-center rounded-lg px-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
  onpointerdown={(event) => activateFromPointer(event, appearance.toggle)}
  onclick={(event) => activateFromKeyboardOrAssistiveClick(event, appearance.toggle)}
  onkeydown={(event) => {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
  }}
>
  <ThemeToggleDisplay theme={appearance.theme} pending={appearance.pending} failed={appearance.failed} />
</button>
