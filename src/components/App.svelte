<script lang="ts">
  import Chart from './Chart.svelte';
  import Map, { type FaultPoint } from './Map.svelte';
  import Details from './Details.svelte';
  import Header from './Header.svelte';
  import { demoFile, demoRows } from '../lib/parse/float-control';
  import Picker from './Picker.svelte';
  import type { DragEventHandler, EventHandler } from 'svelte/elements';
  import { DataSource, State, type RowWithIndex } from '../lib/parse/types';
  import Modal from './Modal.svelte';
  import { riderSvg } from '../lib/map-helpers';
  import settings from '../lib/settings.svelte';
  import SettingsModal from './SettingsModal.svelte';
  import Button from './Button.svelte';
  import { Charts } from '../lib/chart-helpers';
  import { parse, supportedMimeTypes } from '../lib/parse';
  import { globalState } from '../lib/global.svelte';

  /** source of data*/
  let source = $state(DataSource.None);
  /** selected file */
  let file = $state<File | undefined>(import.meta.env.DEV ? demoFile : undefined);
  /** parsed csv data from Float Control */
  let rows = $state<RowWithIndex[]>(demoRows);
  /** selected index of `rows` */
  let selectedRowIndex = $state(0);
  /** entire view of gps points from `rows` */
  let { gpsPoints, gpsGaps } = $derived.by(() => {
    const gpsPoints: [number, number][] = [];
    // TODO: verify paused sessions from Floaty
    const gpsGaps: number[] = [0];
    for (let i = 0; i < rows.length; ++i) {
      const prev = rows[i - 1];
      const curr = rows[i]!;

      gpsPoints.push([curr.gps_latitude, curr.gps_longitude]);
      if (prev && curr.time - prev.time > 60) {
        gpsGaps.push(i);
      }
    }

    // When Float Control starts recording a ride, it appears that the first few data points
    // have incorrect GPS data. If it's the start of the ride, it's (0, 0), but if it's a resumed
    // ride, then it seems to be the last known point from the paused ride.
    // Either way, here we attempt to find the first "good" point and use that instead.
    if (source === DataSource.FloatControl) {
      for (let i = 0; i < gpsGaps.length; ++i) {
        const start = gpsGaps[i]!;
        const end = gpsGaps[i + 1];
        const curr = rows[start]!;
        const guessedGoodValue = rows.slice(start, end).find((row) => {
          const samePoint = curr.gps_latitude === row.gps_latitude && curr.gps_longitude === row.gps_longitude;
          return row.gps_accuracy > 0 && !samePoint;
        });

        if (guessedGoodValue) {
          for (let j = start; j < guessedGoodValue.index; ++j) {
            gpsPoints[j] = [guessedGoodValue.gps_latitude, guessedGoodValue.gps_longitude];
          }
        }
      }
    }

    return { gpsPoints, gpsGaps };
  });
  /** entire list of faults from `rows` */
  let faultPoints = $derived.by(() => {
    const points: FaultPoint[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;

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
      const { index } = visibleRows[i]!;
      if (prev < index - 1) {
        gaps.push(i);
      }

      prev = index;
    }

    return gaps;
  });
  /** selected index of `visibleRows` */
  let selectedIndex = $state(0);
  /** on small devices be able to swap map and details views */
  let swapMapAndDetails = $state(false);

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

          globalState.unitsFromData = results.units;
          source = results.source;
          // FIXME: handle parse errors
          if (results.error) {
            console.error(results.error, results.error.cause);
            alert(`An error occurred when parsing: ${results.error.message}`);
            return;
          }

          rows = results.data;
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
    if (e.key === ' ') {
      e.preventDefault();
      swapMapAndDetails = !swapMapAndDetails;
    }
  });

  /**
   * Allow dragging and dropping files to open them.
   */

  let draggingFile = $state(false);
  const filterSupported = (item: { type: string }) => supportedMimeTypes.includes(item.type);
  const ondragenter: DragEventHandler<HTMLElement> = (e) => {
    if (!e.dataTransfer) return;
    draggingFile = Array.from(e.dataTransfer.items).some(filterSupported);
  };
  const ondragleave: DragEventHandler<HTMLElement> = (_) => (draggingFile = false);
  const ondragover: DragEventHandler<HTMLElement> = (e) => {
    e.preventDefault();
    if (draggingFile && e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const ondrop: DragEventHandler<HTMLElement> = (e) => {
    e.preventDefault();
    if (!e.dataTransfer) return;

    const droppedFile = Array.from(e.dataTransfer.files).find(filterSupported);
    if (droppedFile) {
      file = droppedFile;
    }

    draggingFile = false;
  };

  const chartClass = 'bg-slate-950 flex overflow-hidden h-[--grid-width] wide:h-[unset]';
</script>

<Header bind:file />

<SettingsModal />

{#if !file}
  <Picker bind:file {ondragenter} />
{:else if loading}
  <Modal open closable={false} title="Loading...">
    <div>
      <h3 class="font-bold mb-4 animate-bounce">Parsing your ride...</h3>
      <div class="inline-block animate-spin">
        {@html riderSvg}
      </div>
    </div>
  </Modal>
{/if}

<main
  class="grid w-full bg-slate-600 gap-px grid-flow-dense
  h-[unset]
  grid-cols-[repeat(auto-fit,minmax(var(--grid-width),1fr))]
  wide:h-[calc(100vh-var(--header-height))]
  wide:grid-cols-[repeat(3,1fr)]"
  {ondragenter}
  {ondragover}
  {ondrop}
>
  {#if draggingFile}
    <Modal title="File drag detected!" open closable={false} {ondragleave}>
      <div class="h-full w-full flex flex-row justify-center items-center border border-dashed border-4 rounded-2xl">
        <div>{@html riderSvg}</div>
        <p>Drop your file to open it!</p>
        <div>{@html riderSvg}</div>
      </div>
    </Modal>
  {/if}
  <div
    class="sticky top-[--header-height] h-[--grid-width] z-50 border-b
    wide:relative wide:top-[unset] wide:h-[unset] wide:border-b-0"
    class:map-swapped={swapMapAndDetails}
  >
    <Map {setSelectedIdx} {setVisible} {selectedRowIndex} {visibleRows} {gpsPoints} {gpsGaps} {faultPoints} />
  </div>
  <div
    class="place-self-center w-full h-full overflow-hidden
    [grid-column:unset] [grid-row:span_2]
    wide:[grid-column:span_2] wide:[grid-row:unset]"
    class:details-swapped={swapMapAndDetails}
  >
    <Details data={visibleRows[selectedIndex]} batterySpecs={settings.batterySpecs} units={settings.units} />
  </div>

  <div class={chartClass}>
    <Chart {selectedIndex} {setSelectedIdx} {gapIndices} {...Charts.speed(visibleRows)} />
  </div>
  <div class={chartClass}>
    <Chart {selectedIndex} {setSelectedIdx} {gapIndices} {...Charts.duty(visibleRows)} />
  </div>
  <div class={chartClass}>
    <Chart {selectedIndex} {setSelectedIdx} {gapIndices} {...Charts.batteryVoltage(visibleRows)} />
  </div>
  <div class={chartClass}>
    <Chart {selectedIndex} {setSelectedIdx} {gapIndices} {...Charts.elevation(visibleRows)} />
  </div>
  <div class={chartClass}>
    <Chart {selectedIndex} {setSelectedIdx} {gapIndices} {...Charts.currentCombined(visibleRows)} />
  </div>
  <div class={chartClass}>
    <Chart {selectedIndex} {setSelectedIdx} {gapIndices} {...Charts.tempCombined(visibleRows)} />
  </div>
</main>

<div
  class="flex flex-row justify-between items-center wide:hidden
  select-none pointer-events-none fixed left-4 right-4 bottom-4 z-50"
  use:initButtons
>
  <div class="pointer-events-auto">
    <Button class="text-xl" onpointerdown={() => (swapMapAndDetails = !swapMapAndDetails)}>⟲</Button>
  </div>
  <div class="flex flex-rol gap-4 pointer-events-auto">
    <Button
      class="text-xl"
      onclick={stepPrev}
      ontouchstart={onInteractStart(stepPrev)}
      onmousedown={onInteractStart(stepPrev)}
      ontouchend={onInteractEnd}
      onmouseup={onInteractEnd}
    >
      ←
    </Button>
    <Button
      class="text-xl"
      onclick={stepNext}
      ontouchstart={onInteractStart(stepNext)}
      onmousedown={onInteractStart(stepNext)}
      ontouchend={onInteractEnd}
      onmouseup={onInteractEnd}
    >
      →
    </Button>
  </div>
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

  /* NOTE: must match up with `wide` breakpoint */
  @media (width < 640px) {
    .map-swapped {
      position: relative !important;
      top: unset !important;
      z-index: 40;
    }
    .details-swapped {
      z-index: 50;
      position: sticky;
      top: var(--header-height);
      grid-row: 1 / span 2 !important;
      border-bottom-width: 1px;
    }
  }
</style>
