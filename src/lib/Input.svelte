<script lang="ts" context="module">
  import type { HTMLInputAttributes } from 'svelte/elements';
  export interface Props extends HTMLInputAttributes {
    id: string;
    label: string;
    inline?: boolean;
  }
</script>

<script lang="ts">
  let { id, label, value = $bindable(), inline = false, ...rest }: Props = $props();
</script>

<div style:display={inline ? 'inline-block' : 'block'}>
  <label for={id}>{label}:</label>
  <input {...rest} {id} bind:value />
</div>
