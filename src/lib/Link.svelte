<script lang="ts" module>
  import type { HTMLAnchorAttributes } from 'svelte/elements';

  export interface Props extends HTMLAnchorAttributes {
    label: string;
    children?: never;
  }
</script>

<script lang="ts">
  let { label, class: propClass, ...rest }: Props = $props();
</script>

<a {...rest} class="underline text-sky-300 visited:text-purple-300 {propClass}">{label}</a>
