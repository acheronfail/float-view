<script lang="ts">
  import { onDestroy } from 'svelte';
  import { backendState } from '$lib/backend/state.svelte';
  import { ApiRequestError } from '$lib/backend/client';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';

  let { sessionId, preview = false }: { sessionId: string | null; preview?: boolean } = $props();
  let pending = $state(false);
  let result = $state<'idle' | 'saved' | 'failed' | 'unconfirmed'>('idle');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let alive = true;
  const message = $derived(
    pending
      ? 'Saving…'
      : result === 'saved'
        ? 'Marker saved'
        : result === 'failed'
          ? 'Could not save'
          : result === 'unconfirmed'
            ? 'Save not confirmed'
            : 'Mark ride'
  );
  function clear() {
    generation++;
    clearTimeout(timer);
    result = 'idle';
  }
  $effect(() => {
    void sessionId;
    clear();
  });
  onDestroy(() => {
    alive = false;
    clear();
  });
  async function save() {
    if (preview || !sessionId || pending) return;
    const session = sessionId;
    const ticket = generation;
    pending = true;
    result = 'idle';
    clearTimeout(timer);
    try {
      await backendState.saveRideMarker(session, crypto.randomUUID());
      if (alive && ticket === generation && session === sessionId) result = 'saved';
    } catch (error) {
      if (alive && ticket === generation && session === sessionId)
        result = error instanceof ApiRequestError ? 'failed' : 'unconfirmed';
    } finally {
      pending = false;
      if (alive && ticket === generation) timer = setTimeout(() => (result = 'idle'), 2_000);
    }
  }
</script>

<button
  type="button"
  aria-label="Save ride marker"
  aria-busy={pending}
  disabled={preview || !sessionId || pending}
  class="marker-button flex h-full min-h-11 w-full touch-pan-y flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default"
  class:feedback={pending || result !== 'idle'}
  class:confirmed={result === 'saved'}
  onpointerdown={(event) => activateFromPointer(event, save)}
  onclick={(event) => activateFromKeyboardOrAssistiveClick(event, save)}
  onkeydown={(event) => {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
  }}
>
  <span
    class={`shrink-0 text-base ${pending ? 'i-lucide-loader-circle' : result === 'saved' ? 'i-lucide-check' : result === 'failed' || result === 'unconfirmed' ? 'i-lucide-triangle-alert' : 'i-lucide-flag'}`}
    aria-hidden="true"
  ></span>
  <span class="text-[10px] leading-[11px] font-semibold [overflow-wrap:anywhere]">{message}</span>
  {#if !sessionId && !preview}<span class="text-[9px] leading-tight text-muted">No active ride</span>{/if}
</button>
<span role="status" aria-live="polite" class="sr-only">{result !== 'idle' || pending ? message : ''}</span>

<style>
  .feedback {
    color: var(--color-warning);
    background: color-mix(in srgb, var(--color-warning) 10%, var(--color-surface));
  }
  .confirmed {
    background: color-mix(in srgb, var(--color-warning) 25%, var(--color-surface));
    box-shadow: 0 0 16px color-mix(in srgb, var(--color-warning) 35%, transparent);
    animation: marker-confirm 250ms ease-out;
  }
  @keyframes marker-confirm {
    50% {
      transform: scale(1.04);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .confirmed {
      animation: none;
    }
  }
</style>
