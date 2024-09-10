<script lang="ts">
  import { type LatLngExpression } from 'leaflet';
  import { type FloatControlRow } from './FloatControlTypes';
  import Chart from './Chart.svelte';
  import Map, { type FaultPoint } from './Map.svelte';
  import OtherInfo from './OtherInfo.svelte';
  import Header from './Header.svelte';
  import type { BatterySpecs } from './CommonTypes';
  import { demoFile, demoRows, parse, type FloatControlRowWithIndex } from './Csv';
  import Picker from './Picker.svelte';

  // battery specs
  let cellCount = $state(20);
  let cellMinVolt = $state(3.0);
  let cellMaxVolt = $state(4.2);
  let batterySpecs = $derived<BatterySpecs>({ cellCount, cellMinVolt, cellMaxVolt });

  /** selected file */
  let file = $state<File | undefined>(import.meta.env.DEV ? demoFile : undefined);
  /** parsed csv data from Float Control */
  let rows = $state<FloatControlRowWithIndex[]>(demoRows);
  /** selected index of `rows` */
  let selectedRowIndex = $state(0);
  /** entire view of gps points from `rows` */
  let gpsPoints = $derived(rows.map((x): LatLngExpression => [x.gps_latitude, x.gps_longitude]));
  /** entire list of faults from `rows` */
  let faultPoints = $derived.by(() => {
    const points: FaultPoint[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].state !== 'RIDING') {
        points.push({ index: i, fault: rows[i].state });
      }
    }

    return points;
  });

  /** array-as-map of whether particular rows are visible or not */
  let visible = $state<boolean[]>([]);
  /** filtered visible rows */
  let visibleRows = $derived(rows.filter((_, i) => visible[i]));
  /** indices of gaps between non-contiguous ranges in `visibleRows` */
  let gapIndices = $derived.by(() => {
    let gaps: number[] = [];
    let prev = visibleRows[0]?.index ?? 0;
    for (let i = 1; i < visibleRows.length; i++) {
      const { index } = visibleRows[i];
      if (prev < index - 1) {
        gaps.push(i);
      }

      prev = index;
    }

    return gaps;
  });
  /** selected index of `visibleRows` */
  let selectedIndex = $state(0);

  const updateSelectedRowIdx = () => {
    if (!visible[selectedRowIndex]) {
      // it's not the best, but try to find a point on the line that's somewhat in the middle
      // this doesn't really work well if there are multiple lines going in different directions
      selectedRowIndex = visibleRows[Math.floor(visibleRows.length / 2)]?.index ?? 0;
    }
  };

  const setSelectedIdx = (index: number) => {
    selectedIndex = index;
    selectedRowIndex = visibleRows[selectedIndex]?.index ?? 0;
  };

  // parse csv when file is selected
  $effect(() => {
    if (file) {
      parse(file).then((results) => {
        // TODO: handle parse errors
        rows = results.data;
        selectedIndex = 0;
      });
    }
  });

  // event handlers to step left and right in data
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      selectedIndex = Math.min(visibleRows.length - 1, selectedIndex + 1);
    }
    if (e.key === 'ArrowLeft') {
      selectedIndex = Math.max(0, selectedIndex - 1);
    }
  });
</script>

<Header bind:file bind:cellCount bind:cellMinVolt bind:cellMaxVolt />

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
    <Map
      bind:visible
      bind:selectedIndex
      {setSelectedIdx}
      {updateSelectedRowIdx}
      {selectedRowIndex}
      {visibleRows}
      {gpsPoints}
      {faultPoints}
    />
  </div>
  <div
    style:overflow="hidden"
    style:height="100%"
    style:width="100%"
    style:place-self="center"
    class="column-2-to-row-2"
  >
    <OtherInfo data={visibleRows[selectedIndex]} {batterySpecs} />
  </div>

  <div class="chart">
    <Chart
      data={[{ values: visibleRows.map((x) => x.speed), color: 'white' }]}
      {selectedIndex}
      {setSelectedIdx}
      {gapIndices}
      title="Speed"
      unit=" km/h"
    />
  </div>
  <div class="chart">
    <Chart
      data={[{ values: visibleRows.map((x) => x.duty) }]}
      {selectedIndex}
      {setSelectedIdx}
      {gapIndices}
      title="Duty cycle"
      unit="%"
    />
  </div>
  <div class="chart">
    <Chart
      data={[{ values: visibleRows.map((x) => x.voltage), color: 'green' }]}
      {selectedIndex}
      {setSelectedIdx}
      {gapIndices}
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
      data={[{ values: visibleRows.map((x) => x.altitude), color: 'brown' }]}
      {selectedIndex}
      {setSelectedIdx}
      {gapIndices}
      title="Elevation"
      unit="m"
    />
  </div>
  <div class="chart">
    <Chart
      data={[
        { values: visibleRows.map((x) => x.current_motor), color: 'cyan', label: 'Motor current' },
        { values: visibleRows.map((x) => x.current_battery), color: 'azure', label: 'Battery current' },
      ]}
      {selectedIndex}
      {setSelectedIdx}
      {gapIndices}
      title="I-Mot / I-Batt"
      unit="A"
    />
  </div>
  <div class="chart">
    <Chart
      data={[
        { values: visibleRows.map((x) => x.temp_motor), color: 'orange', label: 'Motor temp' },
        { values: visibleRows.map((x) => x.temp_mosfet), color: 'yellow', label: 'Mosfet temp' },
      ]}
      {selectedIndex}
      {setSelectedIdx}
      {gapIndices}
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
