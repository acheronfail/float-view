export enum ChartColours {
  Speed = '#fde68a',
  DutyCycle = '#f472b6',
  BatteryVoltage = '#34d399',
  Elevation = '#ea580c',
  CurrentMotor = '#67e8f9',
  CurrentBattery = '#a5b4fc',
  TempMotor = '#facc15',
  TempMosfet = '#fb7185',
}

export interface TickOptions {
  min?: number;
  max?: number;
  suggestedMin?: number;
  suggestedMax?: number;
  maxTicks?: number;
}

export const ticks = (values: number[], opts: TickOptions = {}): number[] => {
  const valuesWithoutNan = values.filter((x) => !Number.isNaN(x));
  const min =
    opts.min ?? Math.min(...valuesWithoutNan, ...(opts.suggestedMin !== undefined ? [opts.suggestedMin] : []));
  const max =
    opts.max ?? Math.max(...valuesWithoutNan, ...(opts.suggestedMax !== undefined ? [opts.suggestedMax] : []));
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
  while (result[0] && min < result[0]) result.unshift(result[0] - tickSpacing);

  if (!result.length) {
    return [0, 100];
  }

  return result;
};
