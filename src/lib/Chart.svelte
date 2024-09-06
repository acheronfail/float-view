<script lang="ts">
  import { onMount } from 'svelte';
  import { ticks } from './ChartUtils';

  interface Props {
    data: {
      color?: string;
      label?: string;
      values: number[]
    }[];
    selectedIndex: number;
    min?: number;
    max?: number;
    unit?: string;
    title?: string;
  }

  const getYValueHeight = (y: number, min: number, max: number) => ((y - min) / (max - min)) * 100;
  const indexToXPct = (i: number): number => (100 / dataPointsLen) * (i + 0.5);
  const valueToYPct = (y: number, min: number, max: number) => 100 - getYValueHeight(y, min, max);
  const aggMaxAbs = (acc: number, n: number) => (Math.abs(acc) > Math.abs(n) ? acc : n);

  let { data, selectedIndex = $bindable(0), unit = '', title = '', min, max }: Props = $props();
  let dataLen = $derived(data[0].values.length);
  if (!data.every(({values}) => values.length === dataLen)) {
    throw new Error('All input data lists must be the same length');
  }

  /** wrapper svg elemenet */
  let svg = $state<SVGElement | undefined>();
  let scaleFactor = $state(1);
  /** how many data-points map to a single coord in svg space */
  let chunkSize = $state(1);
  /** scaled points representing the data */
  let dataPoints = $state<number[][]>(data.map(() => []));
  let dataPointsLen = $derived(dataPoints[0].length);
  /** start and end coordinates of where 0 is on the x axis */
  let zeroPath = $state<[[number, number], [number, number]] | undefined>();
  /** x coordinate of where the vertical line indicator should be */
  let selectedDataPointIndex = $derived(Math.floor(selectedIndex / chunkSize));
  let selectedX = $derived(indexToXPct(selectedDataPointIndex) * scaleFactor);
  /** ticks for the y-axis */
  let yTicks: [number, string][] = $derived(ticks(dataPoints[0], { min, max }).map((n) => [n, `${n}${unit}`]));
  let yTickMin = $derived(Math.min(...yTicks.map(([n]) => n)));
  let yTickMax = $derived(Math.max(...yTicks.map(([n]) => n)));

  function renderChart(pixelWidth: number) {
    // TODO: what if dataLen is less than pixels?
    chunkSize = Math.floor(dataLen / pixelWidth);
    scaleFactor = pixelWidth / 100;

    data.forEach(({values}, dataIndex) => {
      for (let i = 0; i < values.length; i += chunkSize) {
        dataPoints[dataIndex].push(values.slice(i, i + chunkSize).reduce(aggMaxAbs));
      }
    });

    const yZero = valueToYPct(0, yTickMin, yTickMax);
    if (0 >= yTickMin && 0 <= yTickMax) {
      zeroPath = [
        [indexToXPct(0) * scaleFactor, yZero * scaleFactor],
        [indexToXPct(dataPointsLen) * scaleFactor, yZero * scaleFactor],
      ];
    }
  }

  onMount(() => {
    renderChart(svg!.getBoundingClientRect().width);
  });

  const MARGIN_TOP = '3rem';
  const MARGIN_RIGHT = '2rem';
  const MARGIN_LEFT = '6rem';
  const MARGIN_BOTTOM = '3rem';
</script>

<div
  style:background-color="#000"
  style:border="1px solid #444"
  style:box-sizing="border-box"
  style:display="flex"
  style:height="480px"
  style:width="640px"
>
  <div
    style:height="calc(100% - {MARGIN_BOTTOM} - {MARGIN_TOP})"
    style:width="100%"
    style:position="relative"
    style:margin-left={MARGIN_LEFT}
    style:margin-right={MARGIN_RIGHT}
    style:margin-top={MARGIN_TOP}
    style:margin-bottom={MARGIN_TOP}
  >
    <!-- svg line -->
    <svg
      bind:this={svg}
      version="1.1"
      viewBox="0 0 {100 * scaleFactor} {100 * scaleFactor}"
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      role="graphics-object"
      onmouseleave={e => {
        // it's hard to select the start and the end, since the mousemove events
        // are throttled and won't always fire at the edges, so handle that here
        const bounds = svg!.getBoundingClientRect();
        const pixelX = e.clientX - bounds.left;

        if (pixelX < 0) {
          // exited on left
          selectedIndex = 0;
        } else if (pixelX > bounds.width) {
          // exited on right
          selectedIndex = dataLen - 1;
        }
      }}
      onmousemove={(e) => {
          // because we scale the svg to a 1:1 pixel to viewbox point ratio, the
          // pixel coords ARE the viewbox points
          const bounds = svg!.getBoundingClientRect();
          const pixelX = e.clientX - bounds.left;

          selectedIndex = Math.min(Math.floor(pixelX * (dataLen / bounds.width)), dataLen - 1);
      }}
    >
      <g>
        <!-- horizontal grid lines -->
        <g>
          {#each yTicks as [value], i (i)}
            {@const y = valueToYPct(value, yTickMin, yTickMax) * scaleFactor}
            {#if value !== 0}
              <line style:stroke="#333" style:stroke-dasharray="3 3" x1={0} x2={100 * scaleFactor} y1={y} y2={y} />
            {/if}
          {/each}
        </g>

        <!-- zero path line -->
        {#if zeroPath}
          <path fill="none" stroke="grey" stroke-dasharray="5 3" d="M{zeroPath.map((pos) => pos.join(',')).join('L')}" />
        {/if}

        <!-- data point lines -->
        {#each dataPoints as values, i}
        <path
          fill="none"
          stroke="{data[i].color ?? 'red'}"
          d="M{values
            .map(
              (y, i) => `${indexToXPct(i) * scaleFactor},${valueToYPct(y, yTickMin, yTickMax) * scaleFactor}`
            )
            .join('L')}"
        />
        {/each}

        <!-- selected index vertical line -->
        <path
          fill="none"
          stroke="#aaa"
          d="M{[
            [selectedX, 0],
            [selectedX, 100 * scaleFactor],
          ]
            .map((pos) => pos.join(','))
            .join('L')}"
        />
      </g>
    </svg>

    <!-- title -->
    <div>
      <div
        style:position="absolute"
        style:top="-{MARGIN_TOP}"
        style:left="-{MARGIN_LEFT}"
        style:right="-{MARGIN_RIGHT}"
        style:padding="0.5rem"
        style:font-weight="bold"
        style:text-align="center"
      >
        {title}
      </div>
    </div>

    <!-- y-axis ticks -->
    <div>
      <div
        style:position="absolute"
        style:bottom="100%"
        style:right="100%"
        style:text-align="right"
        style:margin-bottom="1rem"
        style:margin-right="1rem"
        style:font-weight="bold"
      >
        <!-- tick title can go here -->
      </div>
      {#each yTicks as [value, label] (value)}
        <div
          style:position="absolute"
          style:width="1px"
          style:height="1px"
          style:line-height="1px"
          style:white-space="nowrap"
          style:font-size="0.8rem"
          style:transform="translateX(-1rem)"
          style:left="0"
          style:top="{valueToYPct(value, yTickMin, yTickMax)}%"
        >
          <div style:float="right">
            {label}
          </div>
        </div>
      {/each}
    </div>

    <!-- tooltip for vertical selected line -->
    <div>
      <div
        style:position="absolute"
        style:top="50%"
        style:left="{indexToXPct(selectedDataPointIndex)}%"
        style:transform="translateX(-50%)"
        style:white-space="nowrap"
        style:color="#000"
        style:background-color="#aaa"
        style:border-radius="6px"
        style:padding="3px"
        style:text-align="center"
      >
      {#each dataPoints as values, i}
      <div>
        {#if data[i].label}
          {data[i].label}:
        {/if}
          {values[selectedDataPointIndex]}{unit}
        </div>
        {/each}
      </div>
    </div>
  </div>
</div>
