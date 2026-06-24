<script lang="ts">
  /**
   * This is not the greatest chart in the world, no.
   * This is just a tribute.
   *
   * I COULD remember, the greatest chart in the world, yeah.
   * It's right here: https://jf.id.au/blog/how-i-built-the-best-chart-in-the-world
   */

  import type { MouseEventHandler, TouchEventHandler } from 'svelte/elements';
  import { assert, formatFloat } from '../lib/misc';
  import { untrack } from 'svelte';
  import { type Props, ticks } from './Chart';

  const DEFAULT_COLOUR = 'white';

  const MARGIN_TOP = '4rem';
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

  const getYValueHeight = (y: number, min: number, max: number) => ((y - min) / (max - min)) * 100;
  const valueToYPct = (y: number, min: number, max: number) => 100 - getYValueHeight(y, min, max);
  // FIXME: better aggregation for this one? e.g., can't see lowest battery voltage value...
  const aggMaxAbs = (acc: number, n: number) => (Math.abs(acc) > Math.abs(n) ? acc : n);
  const avg = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;

  const getUniformXPcts = (len: number): number[] => {
    if (len <= 0) return [];
    return new Array(len).fill(0).map((_, i) => (100 / len) * (i + 0.5));
  };

  const createTimeToXPct = (values: number[]): ((value: number) => number) | undefined => {
    if (!values.length || values.some((value) => !Number.isFinite(value))) return undefined;
    const min = values[0]!;
    const max = values[values.length - 1]!;
    if (max <= min) return undefined;
    const range = max - min;
    return (value: number) => ((value - min) / range) * 100;
  };

  const findClosestIndex = (xPct: number, xPcts: number[]): number => {
    if (!xPcts.length) return 0;
    if (xPct <= xPcts[0]!) return 0;
    if (xPct >= xPcts[xPcts.length - 1]!) return xPcts.length - 1;

    let low = 0;
    let high = xPcts.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midValue = xPcts[mid]!;
      if (midValue < xPct) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const right = Math.min(low, xPcts.length - 1);
    const left = Math.max(right - 1, 0);
    return Math.abs(xPcts[left]! - xPct) <= Math.abs(xPcts[right]! - xPct) ? left : right;
  };

  type ReduceWithIndex<T> = { index: number; value: T } | null;
  const reduceWithIndex = <T,>(arr: T[], cmp: (curr: T, next: T) => boolean): ReduceWithIndex<T> =>
    arr.reduce<ReduceWithIndex<T>>((result, value, index) => {
      if (!result) return { index, value };
      if (cmp(result!.value, value)) return { index, value };
      return result!;
    }, null);

  let {
    data,
    xValues,
    spacingByTime = false,
    selectedIndex,
    setSelectedIdx,
    gapIndices,
    unit = '',
    title = '',
    precision,
    yAxis,
    showMax,
    showMin,
  }: Props = $props();
  let dataLen = $derived(data[0]?.values.length ?? 0);
  $effect(() =>
    assert(
      data.every(({ values }) => values.length === dataLen),
      'All input data lists must be the same length',
    ),
  );
  $effect(() =>
    assert(!xValues || xValues.length === dataLen, 'xValues must be omitted or have the same length as chart data'),
  );

  /** wrapper svg element */
  let svg = $state<SVGElement | undefined>();
  let scaleFactor = $state(1);
  /** how many data-points map to a single coord in svg space */
  let chunkSize = $state(1);
  /** scaled points representing the data */
  let dataPoints = $derived<number[][]>(data.map(() => []));
  let dataPointsLen = $derived(dataPoints[0]?.length ?? 0);
  /** x-axis positions for each aggregated chart point */
  let pointXPcts = $state<number[]>([]);
  /** x-axis positions for each visible row */
  let indexXPcts = $state<number[]>([]);
  /** start and end coordinates of where 0 is on the x axis */
  let zeroPath = $state<[[number, number], [number, number]] | undefined>();
  /** x coordinate of where the vertical line indicator should be */
  let selectedDataPointIndex = $derived(Math.floor(selectedIndex / chunkSize));
  let selectedXPct = $derived(pointXPcts[selectedDataPointIndex] ?? 50);
  let selectedX = $derived(selectedXPct * scaleFactor);
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

    const canUseTimeSpacing = spacingByTime && xValues && xValues.length === dataLen;
    const aggregatedLen = dataPoints[0]?.length ?? 0;
    if (canUseTimeSpacing) {
      const toXPct = createTimeToXPct(xValues!);
      if (toXPct) {
        indexXPcts = xValues!.map((value) => toXPct(value));
        pointXPcts = [];
        for (let i = 0; i < dataLen; i += chunkSize) {
          const chunkTimes = xValues!.slice(i, i + chunkSize).filter((value) => Number.isFinite(value));
          const chunkTime = chunkTimes.length ? avg(chunkTimes) : xValues![i]!;
          pointXPcts.push(toXPct(chunkTime));
        }
      } else {
        indexXPcts = getUniformXPcts(dataLen);
        pointXPcts = getUniformXPcts(aggregatedLen);
      }
    } else {
      indexXPcts = getUniformXPcts(dataLen);
      pointXPcts = getUniformXPcts(aggregatedLen);
    }

    const yZero = valueToYPct(0, yTickMin, yTickMax);
    if (dataPointsLen && 0 >= yTickMin && 0 <= yTickMax) {
      const leftX = canUseTimeSpacing ? 0 : (100 / dataPointsLen) * -0.5;
      const rightX = canUseTimeSpacing ? 100 : (100 / dataPointsLen) * (dataPointsLen + 0.5);
      zeroPath = [
        [leftX * scaleFactor, yZero * scaleFactor],
        [rightX * scaleFactor, yZero * scaleFactor],
      ];
    } else {
      zeroPath = undefined;
    }
  }

  $effect(() => {
    yAxis; // re-render chart when this changes
    spacingByTime;
    xValues;
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
    const xPct = Math.max(Math.min((pixelX / bounds.width) * 100, 100), 0);

    // translate from visible indices to real indices
    setSelectedIdx(
      spacingByTime ? findClosestIndex(xPct, indexXPcts) : findClosestIndex(xPct, getUniformXPcts(dataLen)),
    );
  };

  const onmousemove: MouseEventHandler<SVGSVGElement> = (e) => selectPoint(e.clientX);

  const touchXThreshold = 15;
  let touchStartX = Infinity;
  const ontouchstart: TouchEventHandler<SVGSVGElement> = (e) => e.touches[0] && (touchStartX = e.touches[0].clientX);
  const ontouchmove: TouchEventHandler<SVGSVGElement> = (e) => {
    if (e.touches[0]) {
      const { clientX } = e.touches[0];
      if (touchStartX === Infinity || Math.abs(touchStartX - clientX) > touchXThreshold) {
        selectPoint(clientX);
        touchStartX = Infinity;
      }
    }
  };

  const formatValue = (value: number | undefined): string => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return '';
    }

    const n = precision ? value.toFixed(precision) : Number.isInteger(value) ? value.toString() : value.toFixed(1);
    return `${n}${unit}`;
  };

  let chartEl: HTMLDivElement | undefined;
  let tooltipEl: HTMLDivElement | undefined;
  const onCreateTooltip = (el: HTMLDivElement) => {
    tooltipEl = el;
  };
  const onCreateContainer = (el: HTMLDivElement) => {
    chartEl = el;
  };
  $effect(() => {
    if (!chartEl || !tooltipEl) return;
    if (selectedDataPointIndex == -1) return;

    const container = chartEl!.parentElement!;
    const halfWidth = tooltipEl.offsetWidth / 2;

    const containerRect = container.getBoundingClientRect();
    const chartRect = chartEl!.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();

    const leftGap = chartRect.left - containerRect.left;
    if (tooltipRect.left < containerRect.left) {
      tooltipEl.style.left = `${halfWidth - leftGap}px`;
    }

    const rightGap = containerRect.right - chartRect.right;
    if (tooltipRect.right > containerRect.right) {
      tooltipEl.style.left = `${chartRect.width + rightGap - halfWidth}px`;
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
            stroke={data[i]?.color ?? DEFAULT_COLOUR}
            d="M{values
              .map((y, i) => {
                const pixelX = (pointXPcts[i] ?? 50) * scaleFactor;
                const pixelY = valueToYPct(Number.isNaN(y) ? 0 : y, yTickMin, yTickMax) * scaleFactor;
                return `${pixelX},${pixelY}`;
              })
              .join('L')}"
          />
        {/each}

        <!-- lines indicating gaps in data -->
        {#each gapIndices as gapIndex}
          {@const x = (pointXPcts[Math.floor(gapIndex / chunkSize)] ?? 50) * scaleFactor}
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
      class="absolute py-1 font-bold text-center"
      style:top="-{MARGIN_TOP}"
      style:left="-{MARGIN_LEFT}"
      style:right="-{MARGIN_RIGHT}"
    >
      {title}
      <div class="flex flex-row gap-2 justify-center items-center font-mono text-xs">
        {#each data as line, i}
          {#if line.values.length > 0}
            {@const min = reduceWithIndex(line.values, (curr, next) => next < curr)}
            {@const max = reduceWithIndex(line.values, (curr, next) => next > curr)}
            {@const minShown = showMin === 'nonzero' ? min?.value !== 0 : showMin}
            {@const maxShown = showMax === 'nonzero' ? max?.value !== 0 : showMax}
            {#if i}
              <span class="text-slate-500">|</span>
            {/if}
            {#if min !== null && minShown}
              <div class="flex flex-row gap-2">
                <span
                  class="cursor-pointer select-none"
                  style:color={line.color}
                  role="button"
                  tabindex="0"
                  onclick={() => setSelectedIdx(min!.index)}
                  onkeydown={(e) => e.code === 'Space' && setSelectedIdx(min!.index)}
                >
                  min: {formatFloat(min.value, true)}{unit}
                </span>
              </div>
            {/if}
            {#if maxShown && minShown}
              <span class="text-slate-500">-</span>
            {/if}
            {#if max !== null && maxShown}
              <div class="flex flex-row gap-2">
                <span
                  class="cursor-pointer select-none"
                  style:color={line.color}
                  role="button"
                  tabindex="0"
                  onclick={() => setSelectedIdx(max!.index)}
                  onkeydown={(e) => e.code === 'Space' && setSelectedIdx(max!.index)}
                >
                  max: {formatFloat(max.value, true)}{unit}
                </span>
              </div>
            {/if}
          {/if}
        {/each}
      </div>
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
    style:left="{selectedXPct}%"
  >
    {#if dataPointsLen > 0}
      {#if selectedDataPointIndex > -1}
        {#each data as _, i}
          <div
            class="w-full flex flex-rol justify-between items-center gap-4"
            style:color={data[i]?.color ?? DEFAULT_COLOUR}
          >
            {#if data[i]?.label}
              <span>{data[i]?.label + ':'}</span>
            {/if}
            <span>{formatValue(data[i]?.values[selectedIndex])}</span>
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
