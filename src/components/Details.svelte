<script lang="ts" module>
  import { Units, type RowWithIndex } from '../lib/parse/types';

  export interface Props {
    data: RowWithIndex | undefined;
    batterySpecs: ZBatterySpecs;
    units: Units;
  }
</script>

<script lang="ts">
  import Footpads from './Footpads.svelte';
  import List from './List.svelte';
  import Pitch from './Pitch.svelte';
  import Roll from './Roll.svelte';
  import settings, { type ZBatterySpecs } from '../lib/settings.svelte';
  import Button from './Button.svelte';
  import { ChartColours } from './Chart';
  import { empty, State } from '../lib/parse/types';
  import { formatFloat } from '../lib/misc';
  import { globalState } from '../lib/global.svelte';

  let { data = empty, batterySpecs, units }: Props = $props();

  let voltsPerCell = $derived(batterySpecs.cellCount ? data.voltage / batterySpecs.cellCount : NaN);
  let cellVoltsLow = $derived(voltsPerCell && batterySpecs.cellMinVolt && voltsPerCell < batterySpecs.cellMinVolt);
  let formatSpeed = $derived((x: number) => (Number.isNaN(x) ? '??' : globalState.mapSpeed(x).toFixed(1)));

  const getStateColor = (state: string): string | undefined => {
    switch (state.toLowerCase()) {
      case 'riding':
        return 'yellowgreen';
      case State.Startup:
        return 'grey';
      case State.StopHalf:
      case State.Quickstop:
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
  class="h-full w-full bg-slate-600 grid gap-px place-items-center
  grid-cols-[repeat(2,minmax(0,1fr))]
  grid-rows-[repeat(3,minmax(0,1fr))]
  wide:grid-cols-[repeat(3,minmax(0,1fr))]
  wide:grid-rows-[repeat(2,minmax(0,1fr))]"
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
        {
          label: 'Speed',
          value: `${formatSpeed(data.speed)} ${units === Units.Metric ? 'km/h' : 'mph'}`,
          color: ChartColours.Speed,
        },
        ...(data.erpm !== undefined ? [{ label: 'ERPM', value: `${data.erpm}` }] : []),
        { label: 'Distance', value: `${formatSpeed(data.distance)} ${units === Units.Metric ? 'km' : 'mi'}` },
        '-',
        { label: 'State', value: data.state.toUpperCase(), color: getStateColor(data.state) },
        {
          label: 'Index',
          value: (data.index + 1).toString(),
          htmlTitle: 'Line number from the CSV file, or the specific log from the JSON file',
        },
      ]}
    />
  </div>

  <div class={itemClass}>
    <List
      items={[
        {
          label: 'Duty',
          value: `${formatFloat(data.duty)}%`,
          color: data.duty > 80 ? 'red' : ChartColours.DutyCycle,
        },
        {
          label: 'Motor Current',
          value: `${formatFloat(data.current_motor)} A`,
          color: ChartColours.CurrentMotor,
        },
        ...(data.current_field_weakening !== undefined
          ? [
              {
                label: 'Field Weakening',
                value: `${formatFloat(data.current_field_weakening)} A`,
                color: ChartColours.CurrentMotor,
              },
            ]
          : []),
        '-',
        { label: 'Temp Motor', value: `${formatFloat(data.temp_motor)}°C`, color: ChartColours.TempMotor },
        { label: 'Temp Controller', value: `${formatFloat(data.temp_mosfet)}°C`, color: ChartColours.TempMosfet },
      ]}
    />
  </div>

  <div class={itemClass}>
    <List
      items={[
        { label: 'Spec', value: batterySpecs.cellCount ? `${batterySpecs.cellCount}S` : configureButton },
        '-',
        {
          label: 'Batt V (total)',
          value: `${formatFloat(data.voltage)} V`,
          color: ChartColours.BatteryVoltage,
        },
        {
          label: 'Batt V (cell)',
          value: `${voltsPerCell ? voltsPerCell.toFixed(1) : '??'} V`,
          color: cellVoltsLow ? 'red' : ChartColours.BatteryVoltage,
        },
        {
          label: 'Batt Current',
          value: `${formatFloat(data.current_battery)} A`,
          color: ChartColours.CurrentBattery,
        },
        {
          label: 'Batt Watts',
          value: `${formatFloat(data.current_battery * data.voltage)} W`,
        },
      ]}
    />
  </div>
</div>

{#snippet configureButton()}
  <Button onclick={() => (settings.open = true)}>set</Button>
{/snippet}
