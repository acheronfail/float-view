<script lang="ts">
  import type { Props } from './OtherInfo.svelte';

  let { data }: Props = $props();
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
</svg>

<div
  style:display="flex"
  style:flex-direction="column"
  style:justify-content="center"
  style:align-items="center"
  style:width="30%"
  style:font-family="monospace"
>
  <span>{data.pitch}°</span>
  <span style:color="grey">Pitch</span>
</div>
