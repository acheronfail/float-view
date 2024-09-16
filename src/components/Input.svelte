<script lang="ts" module>
  import type { HTMLInputAttributes } from 'svelte/elements';
  export interface Props extends HTMLInputAttributes {
    id: string;
    label: string;
    inline?: boolean;
  }
</script>

<script lang="ts">
  let { id, label, value = $bindable(), inline = false, class: propClass, ...rest }: Props = $props();
</script>

<div class="{inline ? 'inline-flex' : 'flex'} flex-row space-between {propClass}">
  <label class="grow text-left truncate" title={label} for={id}>{label}:</label>
  <input class="bg-slate-900 border rounded px-2 py min-w-24" {...rest} {id} bind:value />
</div>
