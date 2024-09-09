<script lang="ts">
  import { type LatLngExpression } from 'leaflet';
  import { type FloatControlRow } from './FloatControlTypes';
  import Chart from './Chart.svelte';
  import Map, { type FaultPoint } from './Map.svelte';
  import OtherInfo from './OtherInfo.svelte';
  import Header from './Header.svelte';
  import type { BatterySpecs } from './CommonTypes';
  import { demoFile, demoRows, parse } from './Csv';
  import Picker from './Picker.svelte';

  let cellCount = $state(20);
  let cellMinVolt = $state(3.0);
  let cellMaxVolt = $state(4.2);
  let batterySpecs = $derived<BatterySpecs>({ cellCount, cellMinVolt, cellMaxVolt });

  let selectedIndex = $state(0);
  let file = $state<File | undefined>(import.meta.env.DEV ? demoFile : undefined);
  let data = $state<FloatControlRow[]>(demoRows);
  let visibleIndices = $state<boolean[]>([]);
  let visibleData = $derived(data.filter((_, i) => visibleIndices[i]));

  $effect(() => {
    if (file) {
      parse(file).then((results) => {
        // TODO: handle parse errors
        data = results.data;
        selectedIndex = 0;
      });
    }
  });

  let gpsPoints = $derived(data.map((x): LatLngExpression => [x.gps_latitude, x.gps_longitude]));
  let faultPoints = $derived.by(() => {
    const points: FaultPoint[] = [];
    data.forEach((x, index) => {
      if (x.state !== 'RIDING') {
        points.push({ index, fault: x.state });
      }
    });

    return points;
  });

  // event handlers to step left and right in data
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      selectedIndex = Math.min(data.length - 1, selectedIndex + 1);
    }
    if (e.key === 'ArrowLeft') {
      selectedIndex = Math.max(0, selectedIndex - 1);
    }
  });

</script>

<Header {selectedIndex} bind:file bind:cellCount bind:cellMinVolt bind:cellMaxVolt />

{#if !file}
  <Picker bind:file />
{/if}

<main
  style:display="grid"
  style:grid-auto-flow="dense"
  style:grid-gap="1px"
  style:background-color="#444"
  style:width="100%"
  class="grid-container"
>
  <div style:position="relative" class="map-container">
    <Map bind:selectedIndex bind:visibleIndices {gpsPoints} {faultPoints} />
  </div>
  <div
    style:overflow="hidden"
    style:height="100%"
    style:width="100%"
    style:place-self="center"
    class="column-2-to-row-2"
  >
    <OtherInfo data={data[selectedIndex]} {selectedIndex} {batterySpecs} />
  </div>

  <div class="chart">
    <Chart
      data={[{ values: visibleData.map((x) => x.speed), color: 'white' }]}
      bind:selectedIndex
      {visibleIndices}
      title="Speed"
      unit=" km/h"
    />
  </div>
  <div class="chart">
    <Chart
      data={[{ values: visibleData.map((x) => x.duty) }]}
      bind:selectedIndex
      {visibleIndices}
      title="Duty cycle"
      unit="%"
    />
  </div>
  <div class="chart">
    <Chart
      data={[{ values: visibleData.map((x) => x.voltage), color: 'green' }]}
      bind:selectedIndex
      {visibleIndices}
      title="Battery Voltage"
      unit="V"
      yAxis={{
        suggestedMin: batterySpecs.cellCount * batterySpecs.cellMinVolt,
        suggestedMax: batterySpecs.cellCount * batterySpecs.cellMaxVolt,
      }}
    />
  </div>
  <div class="chart">
    <Chart
      data={[{ values: visibleData.map((x) => x.altitude), color: 'brown' }]}
      bind:selectedIndex
      {visibleIndices}
      title="Elevation"
      unit="m"
    />
  </div>
  <div class="chart">
    <Chart
      data={[
        { values: visibleData.map((x) => x.current_motor), color: 'cyan', label: 'Motor current' },
        { values: visibleData.map((x) => x.current_battery), color: 'azure', label: 'Battery current' },
      ]}
      bind:selectedIndex
      {visibleIndices}
      title="I-Mot / I-Batt"
      unit="A"
    />
  </div>
  <div class="chart">
    <Chart
      data={[
        { values: visibleData.map((x) => x.temp_motor), color: 'orange', label: 'Motor temp' },
        { values: visibleData.map((x) => x.temp_mosfet), color: 'yellow', label: 'Mosfet temp' },
      ]}
      bind:selectedIndex
      {visibleIndices}
      title="T-Mot / T-Mosfet"
      unit="°C"
    />
  </div>
</main>

<style>
  .column-2-to-row-2 {
    grid-column: span 2;
    grid-row: unset;
  }

  .grid-container {
    grid-template-columns: repeat(3, 1fr);
    height: calc(100vh - var(--header-height));
  }

  .chart {
    background-color: #000;
    box-sizing: border-box;
    display: flex;
    overflow: hidden;
  }

  /* TODO: preprocessor to save all media query constants */
  @media (width <= 600px) {
    .column-2-to-row-2 {
      grid-row: span 2;
      grid-column: unset;
    }

    .grid-container {
      height: unset;
      grid-template-columns: repeat(auto-fit, minmax(var(--grid-width), 1fr));
    }

    .map-container {
      height: var(--grid-width);
      position: sticky !important;
      top: var(--header-height);
      z-index: 100;
      border-bottom: 1px solid #333;
    }

    .chart {
      height: var(--grid-width);
    }
  }
</style>
