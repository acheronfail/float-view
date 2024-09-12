<script lang="ts" module>
  import { demoFile } from './Csv';
  import settings from './Settings.svelte';

  export interface Props {
    file: File | undefined;
  }
</script>

<script lang="ts">
  let { file = $bindable() }: Props = $props();

  const closeRide = () => (file = undefined);
</script>

<div
  style:position="fixed"
  style:z-index="1"
  style:height="calc(var(--header-height) + 1000px)"
  style:top="-1000px"
  style:left="0"
  style:right="0"
  style:background-color="#121418"
>
  <!-- hack to stop mobiles with notches from showing content as they scroll -->
</div>

<header
  style:position="sticky"
  style:z-index="10000"
  style:top="0"
  style:display="flex"
  style:justify-content="space-between"
  style:align-items="center"
  style:gap="1rem"
  style:background-color="#121418"
  style:border-bottom="1px solid #333"
  style:height="var(--header-height)"
  style:padding-left="1rem"
  style:padding-right="1rem"
  style:white-space="nowrap"
>
  <h1 style:flex-grow="1" style:display="flex" style:flex-direction="row" style:justify-content="start">
    Float View
    {#if file === demoFile}
      <span style:width="1px" style:font-size="0.8rem" style:font-family="monospace" style:color="magenta">
        (demo)
      </span>
    {/if}
  </h1>
  {#if file}
    <button onclick={closeRide}>close ride</button>
  {/if}
  <button onclick={() => (settings.open = true)}>configure</button>
</header>
