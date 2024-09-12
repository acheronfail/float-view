<script lang="ts" module>
  import { type ZBatterySpecs } from './Settings.svelte';

  export interface Props {
    data: FloatControlRowWithIndex | undefined;
    batterySpecs: ZBatterySpecs;
    units: Units;
  }
</script>

<script lang="ts">
  import Footpads from './Footpads.svelte';
  import List from './List.svelte';
  import Pitch from './Pitch.svelte';
  import Roll from './Roll.svelte';
  import { empty, State } from './FloatControlTypes';
  import type { FloatControlRowWithIndex, Units } from './Csv';
  import settings from './Settings.svelte';
  import Button from './Button.svelte';

  let { data = empty, batterySpecs, units }: Props = $props();

  const getStateColor = (state: string): string | undefined => {
    switch (state.toLowerCase()) {
      case 'riding':
        return 'yellowgreen';
      case State.Startup:
        return 'grey';
      case State.StopHalf:
      case State.Wheelslip:
        return 'orange';
      case State.StopFull:
      case State.StopAngle:
        return 'red';
    }
  };

  const itemClass =
    'text-xs wide:text-sm relative bg-slate-900 text-slate-100 flex justify-around items-center h-full w-full';
</script>

<div
  class="h-full w-full bg-slate-600 grid gap-px place-items-center grid-cols-[repeat(2,minmax(0,1fr))] grid-rows-[repeat(3,minmax(0,1fr))] wide:grid-cols-[repeat(3,minmax(0,1fr))] wide:grid-rows-[repeat(2,minmax(0,1fr))]"
>
  <div class={itemClass}>
    <Footpads {data} />
  </div>

  <div class={itemClass}>
    <Pitch {data} />
  </div>

  <div class={itemClass}>
    <Roll {data} />
  </div>

  <div class={itemClass}>
    <List
      items={[
        { label: 'Speed', value: `${data.speed} ${units === 'metric' ? 'km/h' : 'mph'}` },
        { label: 'ERPM', value: `${data.erpm}` },
        { label: 'Distance', value: `${data.distance} ${units === 'metric' ? 'km' : 'mi'}` },
        '-',
        { label: 'State', value: data.state.toUpperCase(), color: getStateColor(data.state) },
        { label: 'CSV Row', value: (data.index + 1).toString(), htmlTitle: 'Selected line from the CSV file' },
      ]}
    />
  </div>

  <div class={itemClass}>
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

  <div class={itemClass}>
    <List
      items={[
        { label: 'Spec', value: batterySpecs.cellCount ? `${batterySpecs.cellCount}S` : configureButton },
        '-',
        { label: 'Batt V (total)', value: `${data.voltage} V` },
        {
          label: 'Batt V (cell)',
          value: `${batterySpecs.cellCount ? (data.voltage / batterySpecs.cellCount).toFixed(1) : '??'} V`,
        },
        { label: 'Batt Current', value: `${data.current_battery} A` },
      ]}
    />
  </div>
</div>

{#snippet configureButton()}
  <Button onclick={() => (settings.open = true)}>set</Button>
{/snippet}
