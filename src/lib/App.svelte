<script lang="ts">
  import { type LatLngExpression } from 'leaflet';
  import sampleCsv from '../assets/sample.csv?raw';
  import { type FloatControlRow } from './FloatControlTypes';
  import Chart from './Chart.svelte';
  import Map, { type FaultPoint } from './Map.svelte';
  import OtherInfo from './OtherInfo.svelte';
  import Header, { HEADER_HEIGHT } from './Header.svelte';
  import type { BatterySpecs } from './CommonTypes';
  import { parse } from './Csv';
  import Picker from './Picker.svelte';
  import { onMount } from 'svelte';

  // TODO: import.meta.env.DEV
  // TODO: use sample as demo, but also for dev?

  let file = $state<File | undefined>();
  onMount(() => {
    // FIXME: when file is selected, parse it and start app
    parse(sampleCsv).then((results) => (data = results.data.slice(1)));
  });

  let data = $state<FloatControlRow[]>([
    {
      time: 0,
      state: 'RIDING',
      distance: 0,
      speed: 0,
      duty: 0,
      voltage: 0,
      current_battery: 0,
      current_motor: 0,
      current_field_weakening: 0,
      requested_amps: 0,
      pitch: 0,
      roll: 0,
      setpoint: 0,
      setpoint_atr: 0,
      setpoint_carve: 0,
      temp_mosfet: 0,
      temp_motor: 0,
      adc1: 0,
      adc2: 0,
      motor_fault: 0,
      ah: 0,
      ah_charged: 0,
      wh: 0,
      wh_charged: 0,
      erpm: 0,
      altitude: 0,
      state_raw: 0,
      true_pitch: 0,
      setpoint_torque_tilt: 0,
      setpoint_break_tilt: 0,
      setpoint_remote: 0,
      temp_battery: 0,
      current_booster: 0,
      gps_latitude: 0,
      gps_longitude: 0,
      gps_accuracy: 0,
    },
  ]);
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

  let cellCount = $state(20);
  let cellMinVolt = $state(3.0);
  let cellMaxVolt = $state(4.2);
  let batterySpecs = $derived<BatterySpecs>({ cellCount, cellMinVolt, cellMaxVolt });

  // TODO: file picker initial view which takes you to this screen
  // TODO: ability to zoom into data (when zooming map, trim data to visible points on map only??)
</script>

<Header dataLen={data.length} bind:cellCount bind:cellMinVolt bind:cellMaxVolt />

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
