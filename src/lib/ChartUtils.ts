export interface TickOptions {
  min?: number;
  max?: number;
  suggestedMin?: number;
  suggestedMax?: number;
  maxTicks?: number;
}

export const ticks = (values: number[], opts: TickOptions = {}) => {
  const min = opts.min ?? Math.min(...values, ...(opts.suggestedMin !== undefined ? [opts.suggestedMin] : []));
  const max = opts.max ?? Math.max(...values, ...(opts.suggestedMax !== undefined ? [opts.suggestedMax] : []));
  const maxTicks = opts.maxTicks ?? 10;

  const niceNum = (range: number, round: boolean) => {
    const magnitude = 10 ** Math.floor(Math.log10(range));
    const fraction = range / magnitude;
    const roundFactor = round ? 1.5 : 1;
    const niceFraction =
      fraction < 1 * roundFactor ? 1 : fraction < 2 * roundFactor ? 2 : fraction < 5 * roundFactor ? 5 : 10;
    return niceFraction * magnitude;
  };

  const range = niceNum(max - min, false);
  const tickSpacing = niceNum(range / (maxTicks - 1), true);
  const niceMin = Math.floor(min / tickSpacing) * tickSpacing;
  const niceMax = Math.ceil(max / tickSpacing) * tickSpacing;

  const result: number[] = [];
  let n = niceMin;
  while (n <= niceMax) {
    if ((opts.min === undefined || n >= opts.min) && (opts.max === undefined || n <= opts.max)) result.push(n);
    n += tickSpacing;
  }
  if (max > niceMax) result.push(n);
  while (min < result[0]) result.unshift(result[0] - tickSpacing);
  return result;
};
