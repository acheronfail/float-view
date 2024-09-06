<script lang="ts">
  import csv from 'papaparse';
  import { type LatLngExpression } from 'leaflet';
  import sampleCsv from '../assets/sample.csv?raw';
  import {
    FloatControlHeader,
    floatControlKeyMap,
    FloatControlRawHeader,
    type FloatControlRow,
  } from './FloatControlTypes';
  import Chart from './Chart.svelte';
  import Map from './Map.svelte';

  const parsed = csv.parse<FloatControlRow>(sampleCsv.trim(), {
    header: true,
    transformHeader: (header) => floatControlKeyMap[header as FloatControlRawHeader],
    transform: <C extends FloatControlHeader>(value: string, column: C): FloatControlRow[C] => {
      switch (column) {
        case FloatControlHeader.Duty:
          return parseFloat(value.replace(/%/g, '')) as FloatControlRow[C];
        case FloatControlHeader.State:
          return value as FloatControlRow[C];
        default:
          return parseFloat(value) as FloatControlRow[C];
      }
    },
  });

  const data = parsed.data.slice(1);

  let selectedIndex = $state(0);
  let gpsPoints = $derived(data.map((x): LatLngExpression => [x.gps_latitude, x.gps_longitude]));

  console.log(data[0]);
</script>

<!-- TODO: file picker initial view which takes you to this screen -->

<h1>Float View</h1>
<div>Data point count: {data.length}</div>

<input type="range" min="0" max={gpsPoints.length - 1} bind:value={selectedIndex} />

<div style="display: flex; flex-direction: column;">
  <Map {selectedIndex} {gpsPoints} />
  <Chart data={[{ values: data.map((x) => x.speed), color: 'white' }]} bind:selectedIndex title="Speed" unit=" km/h" />
  <Chart data={[{ values: data.map((x) => x.duty) }]} bind:selectedIndex title="Duty cycle" unit="%" />
  <!-- TODO: allow user to select battery voltage? or put in battery specs? -->
  <Chart
    data={[{ values: data.map((x) => x.voltage), color: 'green' }]}
    bind:selectedIndex
    title="Battery Voltage"
    unit="V"
    min={60}
    max={86}
  />
  <Chart data={[{ values: data.map((x) => x.altitude), color: 'brown' }]} bind:selectedIndex title="Elevation" unit="m" />
  <Chart
    data={[
      { values: data.map((x) => x.current_motor), color: 'cyan', label: 'Motor current' },
      { values: data.map((x) => x.current_battery), color: 'azure', label: 'Battery current' },
    ]}
    bind:selectedIndex
    title="I-Mot / I-Batt"
    unit="A"
  />
  <Chart
    data={[
      { values: data.map((x) => x.temp_motor), color: 'orange', label: 'Motor temp' },
      { values: data.map((x) => x.temp_mosfet), color: 'yellow', label: 'Mosfet temp' },
    ]}
    bind:selectedIndex
    title="T-Mot / T-Mosfet"
    unit="°C"
  />
</div>

<style>
  input[type='range'] {
    width: 80vw;
    position: fixed;
    bottom: 1vh;
    left: 10vw;
  }
</style>
