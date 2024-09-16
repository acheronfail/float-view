<script lang="ts">
  /**
   * This is not the greatest chart in the world, no.
   * This is just a tribute.
   *
   * I COULD remember, the greatest chart in the world, yeah.
   * It's right here: https://jf.id.au/blog/how-i-built-the-best-chart-in-the-world
   */

  import { ticks, type TickOptions } from './ChartUtils';
  import type { MouseEventHandler, TouchEventHandler } from 'svelte/elements';
  import { assert } from './Utils';
  import { untrack } from 'svelte';

  const DEFAULT_COLOUR = 'red';

  const MARGIN_TOP = '3rem';
  const MARGIN_RIGHT = '2rem';
  const MARGIN_LEFT = '4rem';
  const MARGIN_BOTTOM = '3rem';

  const ZERO_LINE_COLOUR = '#aaa';
  const ZERO_LINE_DASHARRAY = '5 3';

  const GRID_LINE_COLOUR = '#555';
  const GRID_LINE_WIDTH = 1;
  const GRID_LINE_DASHARRAY = '3 3';

  const GAP_LINE_COLOUR = '#555';
  const GAP_LINE_WIDTH = 1;
  const GAP_LINE_DASHARRAY = '1 1';

  interface Props {
    data: {
      color?: string;
      label?: string;
      values: number[];
    }[];
    selectedIndex: number;
    setSelectedIdx: (index: number) => void;
    gapIndices: number[];

    yAxis?: TickOptions;
    unit?: string;
    title?: string;
    precision?: number;
  }

  const getYValueHeight = (y: number, min: number, max: number) => ((y - min) / (max - min)) * 100;
  const indexToXPct = (i: number): number => (100 / dataPointsLen) * (i + 0.5);
  const valueToYPct = (y: number, min: number, max: number) => 100 - getYValueHeight(y, min, max);
  const aggMaxAbs = (acc: number, n: number) => (Math.abs(acc) > Math.abs(n) ? acc : n);

  let { data, selectedIndex, setSelectedIdx, gapIndices, unit = '', title = '', precision, yAxis }: Props = $props();
  let dataLen = $derived(data[0].values.length);
  assert(
    data.every(({ values }) => values.length === dataLen),
    'All input data lists must be the same length',
  );

  /** wrapper svg element */
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
  let yTicks: [number, string][] = $derived(
    ticks(dataPoints.flat(), yAxis).map((n) => [n, `${Number.isInteger(n) ? n : n.toFixed(1)}${unit}`]),
  );
  let yTickMin = $derived(Math.min(...yTicks.map(([n]) => n)));
  let yTickMax = $derived(Math.max(...yTicks.map(([n]) => n)));
  let minTickY = $derived((valueToYPct(yTickMin, yTickMin, yTickMax) - 0.5) * scaleFactor);
  let maxTickY = $derived((valueToYPct(yTickMax, yTickMin, yTickMax) + 0.5) * scaleFactor);

  function renderChart(pixelWidth: number) {
    chunkSize = Math.max(1, Math.floor(dataLen / pixelWidth));
    scaleFactor = pixelWidth / 100;

    dataPoints = data.map(({ values }) => {
      const aggregated: number[] = [];
      for (let i = 0; i < values.length; i += chunkSize) {
        const chunk = values.slice(i, i + chunkSize);
        if (chunk.length) {
          aggregated.push(chunk.reduce(aggMaxAbs));
        }
      }

      return aggregated;
    });

    const yZero = valueToYPct(0, yTickMin, yTickMax);
    if (dataPointsLen && 0 >= yTickMin && 0 <= yTickMax) {
      zeroPath = [
        [indexToXPct(-1) * scaleFactor, yZero * scaleFactor],
        [indexToXPct(dataPointsLen) * scaleFactor, yZero * scaleFactor],
      ];
    } else {
      zeroPath = undefined;
    }
  }

  $effect(() => {
    yAxis; // re-render chart when this changes
    if (data) {
      untrack(() => renderChart(svg!.getBoundingClientRect().width));
    }
  });

  const onmouseleave: MouseEventHandler<SVGSVGElement> = (e) => {
    // it's hard to select the start and the end, since the mousemove events
    // are throttled and won't always fire at the edges, so handle that here
    const bounds = svg!.getBoundingClientRect();
    const pixelX = e.clientX - bounds.left;

    if (pixelX < 0) {
      // exited on left, find first visible index
      setSelectedIdx(0);
    } else if (pixelX > bounds.width) {
      // exited on right, find last visible index
      setSelectedIdx(dataLen - 1);
    }
  };

  const selectPoint = (clientX: number) => {
    // because we scale the svg to a 1:1 pixel to viewbox point ratio, the
    // pixel coords ARE the viewbox points
    const bounds = svg!.getBoundingClientRect();
    const pixelX = clientX - bounds.left;

    // translate from visible indices to real indices
    setSelectedIdx(Math.max(Math.min(Math.floor(pixelX * (dataLen / bounds.width)), dataLen - 1), 0));
  };

  const onmousemove: MouseEventHandler<SVGSVGElement> = (e) => selectPoint(e.clientX);

  const touchXThreshold = 15;
  let touchStartX = Infinity;
  const ontouchstart: TouchEventHandler<SVGSVGElement> = (e) => (touchStartX = e.touches[0].clientX);
  const ontouchmove: TouchEventHandler<SVGSVGElement> = (e) => {
    const { clientX } = e.touches[0];
    if (touchStartX === Infinity || Math.abs(touchStartX - clientX) > touchXThreshold) {
      selectPoint(clientX);
      touchStartX = Infinity;
    }
  };

  const formatValue = (value: number): string => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return '';
    }

    const n = precision ? value.toFixed(precision) : Number.isInteger(value) ? value.toString() : value.toFixed(1);
    return `${n}${unit}`;
  };

  let chartDiv: HTMLDivElement | undefined;
  const nodes: HTMLDivElement[] = [];
  const onCreateTooltip = (el: HTMLDivElement) => {
    nodes.push(el);
  };
  const onCreateContainer = (el: HTMLDivElement) => {
    chartDiv = el;
  };

  $effect(() => {
    if (selectedDataPointIndex > -1) {
      const tooltipEl = nodes[0];
      const container = chartDiv!.parentElement!;
      const halfWidth = tooltipEl.offsetWidth / 2;

      const containerRect = container.getBoundingClientRect();
      const chartRect = chartDiv!.getBoundingClientRect();
      const tooltipRect = tooltipEl.getBoundingClientRect();

      const leftGap = chartRect.left - containerRect.left;
      if (tooltipRect.left < containerRect.left) {
        tooltipEl.style.left = `${halfWidth - leftGap}px`;
      }

      const rightGap = containerRect.right - chartRect.right;
      if (tooltipRect.right > containerRect.right) {
        tooltipEl.style.left = `${chartRect.width + rightGap - halfWidth}px`;
      }
    }
  });
</script>

<div
  use:onCreateContainer
  data-testid="chart_{title.toLowerCase().replace(/\s/g, '_')}"
  class="relative w-full"
  style:height="calc(100% - {MARGIN_BOTTOM} - {MARGIN_TOP})"
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
    {onmouseleave}
    {onmousemove}
    {ontouchstart}
    {ontouchmove}
  >
    <g>
      {#if dataPointsLen > 0}
        <!-- horizontal grid lines -->
        <g>
          <line
            style:stroke={GRID_LINE_COLOUR}
            style:stroke-width={GRID_LINE_WIDTH}
            style:stroke-dasharray={GRID_LINE_DASHARRAY}
            x1={0}
            x2={100 * scaleFactor}
            y1={maxTickY}
            y2={maxTickY}
          />
          <!-- only draw this line if the zero line isn't going to be drawn in the same place -->
          {#if yTickMin !== 0}
            <line
              style:stroke={GRID_LINE_COLOUR}
              style:stroke-width={GRID_LINE_WIDTH}
              style:stroke-dasharray={GRID_LINE_DASHARRAY}
              x1={0}
              x2={100 * scaleFactor}
              y1={minTickY}
              y2={minTickY}
            />
          {/if}
          {#each yTicks as [value], i (i)}
            {@const y = valueToYPct(value, yTickMin, yTickMax) * scaleFactor}
            {#if value !== 0}
              {#if i === 0 || i === yTicks.length - 1}{:else}
                <line
                  style:stroke={GRID_LINE_COLOUR}
                  style:stroke-width={GRID_LINE_WIDTH}
                  style:stroke-dasharray={GRID_LINE_DASHARRAY}
                  x1={0}
                  x2={100 * scaleFactor}
                  y1={y}
                  y2={y}
                />
              {/if}
            {/if}
          {/each}
        </g>

        <!-- zero path line -->
        {#if zeroPath}
          <path
            style:stroke={ZERO_LINE_COLOUR}
            style:stroke-width={GRID_LINE_WIDTH}
            style:stroke-dasharray={ZERO_LINE_DASHARRAY}
            d="M{zeroPath.map((pos) => pos.join(',')).join('L')}"
          />
        {/if}

        <!-- data point lines -->
        {#each dataPoints as values, i}
          <path
            fill="none"
            stroke={data[i].color ?? DEFAULT_COLOUR}
            d="M{values
              .map((y, i) => `${indexToXPct(i) * scaleFactor},${valueToYPct(y, yTickMin, yTickMax) * scaleFactor}`)
              .join('L')}"
          />
        {/each}

        <!-- lines indicating gaps in data -->
        {#each gapIndices as gapIndex}
          {@const x = indexToXPct(Math.floor(gapIndex / chunkSize)) * scaleFactor}
          <path
            fill="none"
            stroke={GAP_LINE_COLOUR}
            stroke-width={GAP_LINE_WIDTH}
            stroke-dasharray={GAP_LINE_DASHARRAY}
            d="M{[
              [x, 0],
              [x, 100 * scaleFactor],
            ]
              .map((pos) => pos.join(','))
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
      {/if}
    </g>
  </svg>

  <!-- title -->
  <div>
    <div
      class="absolute p-2 font-bold text-center"
      style:top="-{MARGIN_TOP}"
      style:left="-{MARGIN_LEFT}"
      style:right="-{MARGIN_RIGHT}"
    >
      {title}
    </div>
  </div>

  <!-- y-axis ticks -->
  <div>
    <div class="absolute bottom-full right-full text-right mb-4 mr-4 font-bold">
      <!-- tick title can go here -->
    </div>
    {#each yTicks as [value, label] (value)}
      <div
        class="absolute left-0 w-[1px] h-[1px] leading-[1px] whitespace-nowrap text-sm translate-x-[-0.5rem]"
        style:top="{valueToYPct(value, yTickMin, yTickMax)}%"
      >
        <div class="float-right">
          {label}
        </div>
      </div>
    {/each}
  </div>

  <!-- tooltip for vertical selected line -->
  <div
    use:onCreateTooltip
    class="absolute top-2/4 translate-x-[-50%] whitespace-nowrap text-xs
      text-slate-100 bg-slate-800 border rounded p-2 text-center font-mono
      flex flex-col justify-center items-center pointer-events-none"
    style:left="{dataPointsLen > 0 ? indexToXPct(selectedDataPointIndex) : 50}%"
  >
    {#if dataPointsLen > 0}
      {#if selectedDataPointIndex > -1}
        {#each data as _, i}
          <div
            class="w-full flex flex-rol justify-between items-center gap-4"
            style:color={data[i].color ?? DEFAULT_COLOUR}
          >
            {#if data[i].label}
              <span>{data[i].label + ':'}</span>
            {/if}
            <span>{formatValue(data[i].values[selectedIndex])}</span>
          </div>
        {/each}
      {/if}
    {:else}
      <div class="w-full flex flex-rol justify-between items-center gap-4" style:color="grey">
        <span>no data</span>
      </div>
    {/if}
  </div>
</div>
