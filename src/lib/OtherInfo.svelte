<script lang="ts" context="module">
  import type { BatterySpecs } from './CommonTypes';
  import type { FloatControlRow } from './FloatControlTypes';

  export interface Props {
    data: FloatControlRow;
    batterySpecs: BatterySpecs;
  }
</script>

<script lang="ts">
  import Footpads from './Footpads.svelte';
  import List from './List.svelte';
  import Pitch from './Pitch.svelte';
  import Roll from './Roll.svelte';

  let { data, batterySpecs }: Props = $props();

  const getStateColor = (state: string): string | undefined => {
    switch (state.toLowerCase()) {
      case 'startup':
        return 'grey';
      case 'riding':
        return 'yellowgreen';
      case 'stop half':
      case 'wheelslip':
        return 'orange';
      case 'stop full':
      case 'stop angle':
        return 'red';
    }
  };
</script>

<div
  style:height="100%"
  style:width="100%"
  style:display="grid"
  style:grid-template-columns="minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)"
  style:grid-template-rows="minmax(0, 1fr) minmax(0, 1fr)"
  style:grid-gap="1px"
  style:background-color="#333"
  style:place-items="center"
>
  <div class="item">
    <Footpads {data} {batterySpecs} />
  </div>

  <div class="item">
    <Pitch {data} {batterySpecs} />
  </div>

  <div class="item">
    <Roll {data} {batterySpecs} />
  </div>

  <div class="item">
    <List
      items={[
        { label: 'Speed', value: `${data.speed} km/h` },
        { label: 'ERPM', value: `${data.erpm}` },
        { label: 'Distance', value: `${data.distance} km` },
        '-',
        { label: 'State', value: data.state, color: getStateColor(data.state) },
      ]}
    />
  </div>

  <div class="item">
    <List
      items={[
        { label: 'Duty', value: `${data.duty}%`, color: data.duty > 80 ? 'red' : undefined },
        { label: 'Motor Current', value: `${data.current_motor} A` },
        { label: 'Field Weakening', value: `${data.current_field_weakening} A` },
        '-',
        { label: 'Temp Motor', value: `${data.temp_motor}°C` },
        { label: 'Temp Controller', value: `${data.temp_mosfet}°C` },
      ]}
    />
  </div>

  <div class="item">
    <List
      items={[
        { label: 'Spec', value: `${batterySpecs.cellCount}S` },
        '-',
        { label: 'Batt V (total)', value: `${data.voltage} V` },
        { label: 'Batt V (cell)', value: `${(data.voltage / batterySpecs.cellCount).toFixed(1)} V` },
        { label: 'Batt Current', value: `${data.current_battery} A` },
      ]}
    />
  </div>
</div>

<style>
  .item {
    position: relative;
    background-color: #1a1a1a;
    color: #fff;
    display: flex;
    justify-content: space-around;
    align-items: center;
    width: 100%;
    height: 100%;
  }
</style>
