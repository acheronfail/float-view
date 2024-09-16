<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  export interface Props extends HTMLButtonAttributes {
    children: Snippet;
    class?: string;
  }
</script>

<script lang="ts">
  let { children, class: propClass, ...rest }: Props = $props();
</script>

<button
  {...rest}
  class="text-sm border rounded px-3 py-1 bg-slate-700 font-bold active:bg-slate-800 touch-none {propClass}"
>
  {@render children()}
</button>
