<script lang="ts" module>
  import { Units, type RowWithIndex } from '../lib/parse/types';
  import type { RideStats } from './View';

  export interface Props {
    data: RowWithIndex | undefined;
    stats: RideStats;
    batterySpecs: ZBatterySpecs;
    units: Units;
    hasAdcTelemetry: boolean;
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
  import { formatFloat, formatInt } from '../lib/misc';
  import { globalState } from '../lib/global.svelte';

  let { data = empty, stats, batterySpecs, units, hasAdcTelemetry }: Props = $props();

  let showStats = $state(false);

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
    {#if showStats}
      <List
        items={[
          {
            label: 'Total Half Faults (at speed)',
            value: formatInt(stats.totalHalfFaults),
          },
          {
            label: 'Total Full Faults',
            value: formatInt(stats.totalFullFaults),
          },
          {
            label: 'Total Quick Stops',
            value: formatInt(stats.totalQuickStops),
          },
        ]}
      />
    {:else}
      <Footpads {data} {hasAdcTelemetry} />
    {/if}
  </div>

  <div class={itemClass}>
    {#if showStats}
      <List
        items={[
          {
            label: 'Highest Pitch',
            value: `${formatFloat(stats.highestPitch)}°`,
          },
          {
            label: 'Lowest Pitch',
            value: `${formatFloat(stats.lowestPitch)}°`,
          },
        ]}
      />
    {:else}
      <Pitch {data} />
    {/if}
  </div>

  <div class={itemClass}>
    {#if showStats}
      <List
        items={[
          {
            label: 'Highest Roll',
            value: `${formatFloat(stats.highestRoll)}°`,
          },
          {
            label: 'Lowest Roll',
            value: `${formatFloat(stats.lowestRoll)}°`,
          },
        ]}
      />
    {:else}
      <Roll {data} />
    {/if}
  </div>

  <div class={itemClass}>
    {#if showStats}
      <List
        items={[
          {
            label: 'Highest Speed',
            value: `${formatSpeed(stats.highestSpeed)} ${units === Units.Metric ? 'km/h' : 'mph'}`,
            color: ChartColours.Speed,
          },
          {
            label: 'Average Speed',
            value: `${formatSpeed(stats.averageSpeed)} ${units === Units.Metric ? 'km/h' : 'mph'}`,
            color: ChartColours.Speed,
          },
          ...(data.erpm !== undefined ? [{ label: 'Highest ERPM', value: formatInt(stats.highestErpm) }] : []),
          { label: 'Total Distance', value: `${formatFloat(stats.totalDistanceMeters)} m` },
          '-',
          {
            label: 'Index',
            value: formatInt(data.index + 1),
            htmlTitle: 'Line number from the CSV file, or the specific log from the JSON file',
          },
          { value: swapDetailsButton },
        ]}
      />{:else}
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
            value: formatInt(data.index + 1),
            htmlTitle: 'Line number from the CSV file, or the specific log from the JSON file',
          },
          { value: swapDetailsButton },
        ]}
      />
    {/if}
  </div>

  <div class={itemClass}>
    {#if showStats}
      <List
        items={[
          {
            label: 'Highest Duty',
            value: `${formatFloat(stats.highestDuty)}%`,
            color: data.duty > 80 ? 'red' : ChartColours.DutyCycle,
          },
          {
            label: 'Average Duty',
            value: `${formatFloat(stats.averageDuty)}%`,
            color: data.duty > 80 ? 'red' : ChartColours.DutyCycle,
          },
          {
            label: 'Highest Motor Current',
            value: `${formatFloat(stats.highestMotorCurrent)} A`,
            color: ChartColours.CurrentMotor,
          },
          ...(data.current_field_weakening !== undefined
            ? [
                {
                  label: 'Highest Field Weakening',
                  value: `${formatFloat(stats.highestFieldWeakeningCurrent)} A`,
                  color: ChartColours.CurrentMotor,
                },
              ]
            : []),
          {
            label: 'Highest Temp Motor',
            value: `${formatFloat(stats.highestTempMotor)}°C`,
            color: ChartColours.TempMotor,
          },
          {
            label: 'Highest Temp Controller',
            value: `${formatFloat(stats.highestTempController)}°C`,
            color: ChartColours.TempMosfet,
          },
        ]}
      />
    {:else}
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
    {/if}
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

{#snippet swapDetailsButton()}
  {#if showStats}
    <Button onclick={() => (showStats = false)}>Show Point Stats</Button>
  {:else}
    <Button onclick={() => (showStats = true)}>Show Ride Stats</Button>
  {/if}
{/snippet}
