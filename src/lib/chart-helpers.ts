import { Units, type RowWithIndex } from './parse/types';
import type { Props as ChartProps } from '../components/Chart';
import settings from './settings.svelte';
import { globalState } from './global.svelte';

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

export type ChartFactoryFn = (
  visibleRows: RowWithIndex[],
) => Omit<ChartProps, 'selectedIndex' | 'setSelectedIdx' | 'gapIndices'>;

export type ChartKey = keyof typeof Charts;
export const Charts = {
  speed: (visibleRows) => ({
    data: [
      {
        values: visibleRows.map((x) => globalState.mapSpeed(x.speed)),
        color: ChartColours.Speed,
      },
    ],
    title: 'Speed',
    precision: 1,
    unit: settings.units === Units.Metric ? ' km/h' : ' mph',
    showMax: true,
    showMin: 'nonzero',
  }),
  duty: (visibleRows) => ({
    data: [{ values: visibleRows.map((x) => x.duty), color: ChartColours.DutyCycle }],
    title: 'Duty Cycle',
    unit: '%',
    showMax: true,
    showMin: 'nonzero',
  }),
  elevation: (visibleRows) => ({
    data: [{ values: visibleRows.map((x) => x.altitude), color: ChartColours.Elevation }],
    title: 'Elevation',
    unit: 'm',
    showMax: true,
    showMin: true,
  }),
  batteryVoltage: (visibleRows) => ({
    data: [{ values: visibleRows.map((x) => x.voltage), color: ChartColours.BatteryVoltage }],
    title: 'Battery Voltage',
    unit: 'V',
    showMax: true,
    showMin: true,
    precision: 1,
    yAxis: { suggestedMin: settings.suggestedVMin, suggestedMax: settings.suggestedVMax },
  }),
  currentCombined: (visibleRows) => ({
    data: [
      { values: visibleRows.map((x) => x.current_motor), color: ChartColours.CurrentMotor, label: 'Motor current' },
      {
        values: visibleRows.map((x) => x.current_battery),
        color: ChartColours.CurrentBattery,
        label: 'Battery current',
      },
    ],
    title: 'I-Motor / I-Battery',
    unit: 'A',
    showMax: true,
    showMin: 'nonzero',
    precision: 1,
  }),
  tempCombined: (visibleRows) => ({
    data: [
      { values: visibleRows.map((x) => x.temp_motor), color: ChartColours.TempMotor, label: 'Motor temp' },
      { values: visibleRows.map((x) => x.temp_mosfet), color: ChartColours.TempMosfet, label: 'Controller temp' },
    ],
    title: 'T-Motor / T-Controller',
    unit: '°C',
    showMax: true,
    showMin: true,
    precision: 1,
  }),
} satisfies Record<string, ChartFactoryFn>;

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
