<script lang="ts">
  import { type LatLngExpression } from 'leaflet';
  import { type FloatControlRow } from './FloatControlTypes';
  import Chart from './Chart.svelte';
  import Map, { type FaultPoint } from './Map.svelte';
  import OtherInfo from './OtherInfo.svelte';
  import Header, { HEADER_HEIGHT } from './Header.svelte';
  import type { BatterySpecs } from './CommonTypes';
  import { parse, demoData } from './Csv';
  import Picker from './Picker.svelte';

  let data = $state<FloatControlRow[]>(demoData());

  let file = $state<File | undefined>();
  $effect(() => {
    if (file) {
      parse(file).then((results) => {
        // TODO: handle parse errors
        // TODO: is the first GPS value from FloatControl always (0, 0)?
        selectedIndex = 0;
        data = results.data.slice(1);
      });
    }
  });

  let selectedIndex = $state(0);
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

  let cellCount = $state(20);
  let cellMinVolt = $state(3.0);
  let cellMaxVolt = $state(4.2);
  let batterySpecs = $derived<BatterySpecs>({ cellCount, cellMinVolt, cellMaxVolt });

  // event handlers to step left and right in data
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      selectedIndex = Math.min(data.length - 1, selectedIndex + 1);
    }
    if (e.key === 'ArrowLeft') {
      selectedIndex = Math.max(0, selectedIndex - 1);
    }
  });

  // TODO: file picker initial view which takes you to this screen
  // TODO: ability to zoom into data (when zooming map, trim data to visible points on map only??)
</script>

<Header {selectedIndex} bind:file bind:cellCount bind:cellMinVolt bind:cellMaxVolt />

{#if !file}
  <Picker bind:file />
{/if}

<main
  style:display="grid"
  style:grid-template-columns="1fr 1fr 1fr"
  style:grid-template-rows="1fr 1fr 1fr"
  style:grid-gap="1px"
  style:background-color="#444"
  style:height="calc(100vh - {HEADER_HEIGHT})"
  style:width="100%"
>
  <div style:position="relative">
    <Map bind:selectedIndex {gpsPoints} {faultPoints} />
  </div>
  <div
    style:overflow="hidden"
    style:height="100%"
    style:width="100%"
    style:grid-column="2 / 4"
    style:place-self="center"
  >
    <OtherInfo data={data[selectedIndex]} {batterySpecs} />
  </div>

  <Chart data={[{ values: data.map((x) => x.speed), color: 'white' }]} bind:selectedIndex title="Speed" unit=" km/h" />
  <Chart data={[{ values: data.map((x) => x.duty) }]} bind:selectedIndex title="Duty cycle" unit="%" />
  <Chart
    data={[{ values: data.map((x) => x.voltage), color: 'green' }]}
    bind:selectedIndex
    title="Battery Voltage"
    unit="V"
    yAxis={{
      suggestedMin: batterySpecs.cellCount * batterySpecs.cellMinVolt,
      suggestedMax: batterySpecs.cellCount * batterySpecs.cellMaxVolt,
    }}
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
</main>
