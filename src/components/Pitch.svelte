<script lang="ts">
  import { formatFloat } from '../lib/misc';
  import { type Row } from '../lib/parse/types';
  import List from './List.svelte';

  let { data }: { data: Row } = $props();
  // TODO: what's the difference between `true_pitch` and `pitch`?
</script>

<svg version="1.1" viewBox="0 0 100 100" role="graphics-object" xmlns="http://www.w3.org/2000/svg" height="60%">
  <g transform-origin="center" transform="rotate({data.pitch})">
    <path
      stroke="white"
      fill="none"
      d="m 0.5737371,48.400855 2.8987703,3.711032 A 5.0766499,5.0766499 0 0 0 7.4729053,54.06132 H 92.527109 a 5.0766499,5.0766499 0 0 0 4.000388,-1.949433 l 2.898766,-3.711032 A 1.522995,1.522995 0 0 0 98.228178,45.93868 H 1.7718314 a 1.522995,1.522995 0 0 0 -1.1980943,2.462175"
    />
    <path
      stroke="white"
      fill="none"
      d="m 67.819045,54.06132 a 18.27594,18.27594 0 0 1 -35.638083,0 m 0,-8.12264 a 18.27594,18.27594 0 0 1 35.638083,0 m -8.51354,8.12264 a 10.1533,10.1533 0 0 1 -18.611003,0 m 0,-8.12264 a 10.1533,10.1533 0 0 1 18.611003,0"
    />
  </g>
  {#if typeof data.setpoint === 'number'}
    <g transform-origin="center" transform="rotate({data.setpoint})">
      <path stroke="#0ea5e9cc" stroke-width="2" fill="none" d="m 10,50 L 28,50" />
      <path stroke="#0ea5e9cc" stroke-width="2" fill="none" d="m 72,50 L 90,50" />
    </g>
  {/if}
</svg>

<div class="flex flex-col justify-center items-center w-[50%] font-mono">
  <List
    items={[
      { label: 'Pitch', value: `${formatFloat(data.pitch)}°` },
      { label: 'Set point', value: `${formatFloat(data.setpoint)}°` },
    ]}
  />
</div>
