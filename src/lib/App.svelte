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
  import Map, { type FaultPoint } from './Map.svelte';

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
  let faultPoints = $derived.by(() => {
    const points: FaultPoint[] = [];
    data.forEach((x, index) => {
      if (x.state_raw !== 1) {
        points.push({ index, fault: x.state, id: x.state_raw });
      }
    });

    return points;
  });

  console.log(data[0]);

  const HEADER_HEIGHT = '3rem';
</script>

<!-- TODO: file picker initial view which takes you to this screen -->

<header
  style:position="sticky"
  style:z-index="10000"
  style:top="0"
  style:display="flex"
  style:justify-content="space-between"
  style:align-items="center"
  style:background-color="#121418"
  style:height={HEADER_HEIGHT}
  style:padding-left="1rem"
  style:padding-right="1rem"
>
  <h1>Float View</h1>
  <div>Data point count: {data.length}</div>
</header>

<input type="range" min="0" max={gpsPoints.length - 1} bind:value={selectedIndex} />

<main
  style:display="grid"
  style:grid-template-columns="1fr 1fr 1fr"
  style:grid-template-rows="1fr 1fr 1fr"
  style:height="calc(100vh - {HEADER_HEIGHT})"
  style:width="100%"
>
  <div style:position="relative">
    <Map bind:selectedIndex {gpsPoints} {faultPoints} />
  </div>
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
  <Chart
    data={[{ values: data.map((x) => x.altitude), color: 'brown' }]}
    bind:selectedIndex
    title="Elevation"
    unit="m"
  />
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
  <!-- TODO: visualize ADC sensors -->
  <!-- TODO: visualize pitch/roll/yaw ? -->
  <div
    style:overflow="scroll"
    style:height="100%"
    style:width="100%"
    style:grid-column="2 / 4"
    style:place-self="center"
  >
    TODO: something else here? show the other values in the selected position?
    <pre>{JSON.stringify(data[selectedIndex], null, 2)}</pre>
  </div>
</main>

<style>
  input[type='range'] {
    width: 80vw;
    position: fixed;
    bottom: 1vh;
    left: 10vw;
  }
</style>
