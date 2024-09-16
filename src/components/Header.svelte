<script lang="ts" module>
  import Button from './Button.svelte';
  import { demoFile } from '../lib/parse/float-control';
  import settings from '../lib/settings.svelte';

  export interface Props {
    file: File | undefined;
  }
</script>

<script lang="ts">
  let { file = $bindable() }: Props = $props();

  const closeRide = () => (file = undefined);
</script>

<div class="fixed z-[9000] h-[calc(var(--header-height)+1000px)] top-[-1000px] left-0 right-0 bg-slate-950">
  <!-- hack to stop mobiles with notches from showing content as they scroll -->
</div>

<header
  class="sticky z-[10000] top-0 flex justify-between items-center
  gap-4 bg-slate-950 border-b h-[--header-height] px-4 whitespace-nowrap"
>
  <h1 class="font-bold text-lg grow flex flex-rol justify-start">
    Float View
    {#if file === demoFile}
      <span class="w-[1px] text-xs font-mono text-fuchsia-500"> (demo) </span>
    {/if}
  </h1>
  {#if file}
    <Button onclick={closeRide}>close ride</Button>
  {/if}
  <Button onclick={() => (settings.open = true)}>configure</Button>
</header>
