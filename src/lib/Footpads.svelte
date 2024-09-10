<script lang="ts">
  import type { FloatControlRow } from './FloatControlTypes';
  import List from './List.svelte';

  let { data }: { data: FloatControlRow } = $props();
  let goingSlow = $derived(data.speed < 2);
  let adc1Enabled = $derived(data.adc1 > 2);
  let adc2Enabled = $derived(data.adc2 > 2);

  const ACTIVE_COLOUR = '#6aa';
</script>

<svg version="1.1" role="graphics-object" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80" height="50%">
  <path
    stroke="white"
    fill="none"
    d="M 61.135201,5.4592 H 38.864798 A 33.405601,13.634527 0 0 0 5.4591996,19.09373 V 74.5408 H 94.5408 V 19.09373 A 33.405601,13.634527 0 0 0 61.135201,5.4592 m -11.135196,8.180715 v 52.720169"
  />
  <path
    fill={adc1Enabled ? ACTIVE_COLOUR : goingSlow ? 'none' : '#ff0000'}
    d="M 44.432401,10.913009 V 69.086991 H 11.026803 V 20.366282 a 27.838002,9.4532727 0 0 1 27.837995,-9.453273 h 5.567603"
  />
  <path
    fill={adc2Enabled ? ACTIVE_COLOUR : goingSlow ? 'none' : '#ff0000'}
    d="M 55.567598,69.086991 H 88.973197 V 20.366282 A 27.838002,9.4532727 0 0 0 61.135201,10.913009 h -5.567603 v 58.173982"
  />
</svg>

<div
  style:height="100%"
  style:width="40%"
  style:display="flex"
  style:align-items="center"
  style:justify-content="center"
>
  <List
    items={[
      {
        label: 'ADC1',
        value: data.adc1.toFixed(2),
        color: adc1Enabled ? 'yellowgreen' : goingSlow ? 'grey' : 'red',
      },
      {
        label: 'ADC2',
        value: data.adc2.toFixed(2),
        color: adc2Enabled ? 'yellowgreen' : goingSlow ? 'grey' : 'red',
      },
    ]}
  />
</div>
