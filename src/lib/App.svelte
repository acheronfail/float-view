<script lang="ts">
  import Chart from './Chart.svelte';
  import Map, { type FaultPoint } from './Map.svelte';
  import Details from './Details.svelte';
  import Header from './Header.svelte';
  import { demoFile, demoRows, parse, type Units, type FloatControlRowWithIndex } from './Csv';
  import Picker from './Picker.svelte';
  import type { EventHandler } from 'svelte/elements';
  import { State } from './FloatControlTypes';
  import Modal from './Modal.svelte';
  import { riderIconSvg } from './MapUtils';
  import settings from './Settings.svelte';
  import SettingsModal from './SettingsModal.svelte';

  /** selected file */
  let file = $state<File | undefined>(import.meta.env.DEV ? demoFile : undefined);
  /** parsed csv data from Float Control */
  let rows = $state<FloatControlRowWithIndex[]>(demoRows);
  let units = $state<Units>('metric');
  /** selected index of `rows` */
  let selectedRowIndex = $state(0);
  /** entire view of gps points from `rows` */
  let { gpsPoints, gpsGaps } = $derived.by(() => {
    const gpsPoints: [number, number][] = [];
    const gpsGaps: number[] = [0];
    for (let i = 0; i < rows.length; ++i) {
      const prev = rows[i - 1];
      const curr = rows[i];

      gpsPoints.push([curr.gps_latitude, curr.gps_longitude]);
      if (prev && curr.time - prev.time > 60) {
        gpsGaps.push(i);
      }
    }

    // When Float Control starts recording a ride, it seems to set the GPS points as 0,0
    // until it gets a location. We can't show those on the map, so just default them to
    // the first known location.
    // TODO: we may have to do this after each gap, too
    const firstKnownPoint = rows.find((row) => row.gps_accuracy > 0);
    if (firstKnownPoint) {
      for (let i = 0; i < gpsPoints.length; ++i) {
        const [lat, lng] = gpsPoints[i];
        if (lat === 0 && lng === 0) {
          gpsPoints[i] = [firstKnownPoint.gps_latitude, firstKnownPoint.gps_longitude];
        }
      }
    }

    return { gpsPoints, gpsGaps };
  });
  /** entire list of faults from `rows` */
  let faultPoints = $derived.by(() => {
    const points: FaultPoint[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      let fault: string | undefined;
      if (row.state !== 'riding') {
        fault = row.state;
      } else if (row.speed > 2) {
        const combinedAdcVoltage = row.adc1 + row.adc2;
        if (combinedAdcVoltage < 2) {
          fault = State.Custom_NoFootpadsAtSpeed;
        } else if (combinedAdcVoltage < 4) {
          fault = State.Custom_OneFootpadAtSpeed;
        }
      }

      // SAFETY: since the enum is non-exhaustive, just check it's not in here so
      // any ones we don't know about are shown
      if (fault && !settings.hiddenFaults.includes(fault as State)) {
        points.push({ index: i, fault });
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

  const setVisible = (arrayAsMap: boolean[]) => {
    visible = arrayAsMap;
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
  let loading = $state(false);
  let timer = -1;
  $effect(() => {
    if (file) {
      timer = window.setTimeout(() => (loading = true));
      parse(file)
        .then((results) => {
          clearTimeout(timer);

          units = results.units;
          // FIXME: handle parse errors
          if (results.csv.errors.length) {
            console.log(results.csv.errors);
            alert(`An error occurred when parsing your CSV file!`);
          }

          rows = results.csv.data;
          selectedIndex = 0;
        })
        .finally(() => (loading = false));
    }
  });

  const stepNext = () => setSelectedIdx((selectedIndex + 1) % visibleRows.length);
  const stepPrev = () => setSelectedIdx(selectedIndex ? selectedIndex - 1 : visibleRows.length - 1);

  let heldDown = false;
  let timeout = -1;
  const repeat = (fn: () => void) => {
    const loop = () => {
      if (!heldDown) return;
      fn();
      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  };
  const onInteractStart =
    (fn: () => void): EventHandler =>
    () => {
      heldDown = true;
      timeout = window.setTimeout(() => repeat(fn), 300);
    };
  const onInteractEnd: EventHandler = () => {
    heldDown = false;
    clearTimeout(timeout);
  };

  const initButtons = (node: HTMLDivElement) => {
    // prevent tap-and-hold firing context menu
    node.addEventListener('contextmenu', (e) => e.preventDefault(), { passive: false });
    // prevent tap-and-hold showing magnifying glass
    node.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  };

  // event handlers to step left and right in data
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      stepNext();
    }
    if (e.key === 'ArrowLeft') {
      stepPrev();
    }
  });
</script>

<Header bind:file />

<SettingsModal />

{#if !file}
  <Picker bind:file />
{:else if loading}
  <Modal open closable={false} title="Loading...">
    <div>
      <h3>Parsing your ride...</h3>
      <div class="rotate">
        {@html riderIconSvg}
      </div>
    </div>
  </Modal>
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
    <Map {setSelectedIdx} {setVisible} {selectedRowIndex} {visibleRows} {gpsPoints} {gpsGaps} {faultPoints} />
  </div>
  <div
    style:overflow="hidden"
    style:height="100%"
    style:width="100%"
    style:place-self="center"
    class="column-2-to-row-2"
  >
    <Details data={visibleRows[selectedIndex]} batterySpecs={settings.batterySpecs} {units} />
  </div>

  <div class="chart">
    <Chart
      data={[{ values: visibleRows.map((x) => x.speed), color: 'white' }]}
      {selectedIndex}
      {setSelectedIdx}
      {gapIndices}
      title="Speed"
      precision={1}
      unit={units === 'metric' ? ' km/h' : ' mph'}
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
      precision={1}
      yAxis={{ suggestedMin: settings.suggestedVMin, suggestedMax: settings.suggestedVMax }}
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
      precision={1}
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
      precision={1}
      unit="°C"
    />
  </div>
</main>

<div
  style:position="fixed"
  style:right="1rem"
  style:bottom="1rem"
  style:flex-direction="row"
  style:justify-content="center"
  style:align-items="center"
  style:gap="1rem"
  style:user-select="none"
  class="buttons"
  use:initButtons
>
  <button
    onclick={stepPrev}
    ontouchstart={onInteractStart(stepPrev)}
    onmousedown={onInteractStart(stepPrev)}
    ontouchend={onInteractEnd}
    onmouseup={onInteractEnd}
  >
    ←
  </button>
  <button
    onclick={stepNext}
    ontouchstart={onInteractStart(stepNext)}
    onmousedown={onInteractStart(stepNext)}
    ontouchend={onInteractEnd}
    onmouseup={onInteractEnd}
  >
    →
  </button>
</div>

<style>
  @keyframes spin {
    100% {
      transform: rotate(360deg);
    }
  }

  .rotate {
    animation: spin 1s infinite linear;
  }

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

  .buttons {
    display: none;
  }
  .buttons button {
    font-weight: bold;
    padding: 0.5rem 1rem;
    touch-action: manipulation;
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

    .buttons {
      display: flex;
    }
  }
</style>
