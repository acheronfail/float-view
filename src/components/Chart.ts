import { Units, type RowWithIndex } from '../lib/parse/types';
import type { Props as ChartProps } from './Chart';
import settings from '../lib/settings.svelte';
import { globalState } from '../lib/global.svelte';

export interface Props {
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
  showMax?: boolean | 'nonzero';
  showMin?: boolean | 'nonzero';
}

// https://tailwindcss.com/docs/customizing-colors
export enum ChartColours {
  Speed = '#fde68a',
  DutyCycle = '#f472b6',
  BatteryVoltage = '#34d399',
  BatteryWatts = '#eab308',
  Elevation = '#ea580c',
  CurrentMotor = '#67e8f9',
  CurrentBattery = '#a5b4fc',
  TempMotor = '#facc15',
  TempMosfet = '#fb7185',
}

export type ChartFactoryFn = (
  visibleRows: RowWithIndex[],
) => Omit<ChartProps, 'title' | 'selectedIndex' | 'setSelectedIdx' | 'gapIndices'>;

export const Charts = {
  Speed: (visibleRows) => ({
    data: [
      {
        values: visibleRows.map((x) => globalState.mapSpeed(x.speed)),
        color: ChartColours.Speed,
      },
    ],
    precision: 1,
    unit: settings.units === Units.Metric ? ' km/h' : ' mph',
    showMax: true,
    showMin: 'nonzero',
  }),
  'Duty Cycle': (visibleRows) => ({
    data: [{ values: visibleRows.map((x) => x.duty), color: ChartColours.DutyCycle }],
    unit: '%',
    showMax: true,
    showMin: 'nonzero',
  }),
  Elevation: (visibleRows) => ({
    data: [{ values: visibleRows.map((x) => x.altitude), color: ChartColours.Elevation }],
    unit: 'm',
    showMax: true,
    showMin: true,
  }),
  'Battery Voltage': (visibleRows) => ({
    data: [{ values: visibleRows.map((x) => x.voltage), color: ChartColours.BatteryVoltage }],
    unit: 'V',
    showMax: true,
    showMin: true,
    precision: 1,
    yAxis: { suggestedMin: settings.suggestedVMin, suggestedMax: settings.suggestedVMax },
  }),
  'Battery Watts': (visibleRows) => ({
    data: [{ values: visibleRows.map((x) => x.voltage * x.current_battery), color: ChartColours.BatteryWatts }],
    unit: 'W',
    showMax: true,
    showMin: true,
    precision: 1,
  }),
  'I-Motor / I-Battery': (visibleRows) => ({
    data: [
      { values: visibleRows.map((x) => x.current_motor), color: ChartColours.CurrentMotor, label: 'Motor current' },
      {
        values: visibleRows.map((x) => x.current_battery),
        color: ChartColours.CurrentBattery,
        label: 'Battery current',
      },
    ],
    unit: 'A',
    showMax: true,
    showMin: 'nonzero',
    precision: 1,
  }),
  'T-Motor / T-Controller': (visibleRows) => ({
    data: [
      { values: visibleRows.map((x) => x.temp_motor), color: ChartColours.TempMotor, label: 'Motor temp' },
      { values: visibleRows.map((x) => x.temp_mosfet), color: ChartColours.TempMosfet, label: 'Controller temp' },
    ],
    unit: '°C',
    showMax: true,
    showMin: true,
    precision: 1,
  }),
} satisfies Record<string, ChartFactoryFn>;
export type ChartKey = keyof typeof Charts;
export const chartKeys = Object.keys(Charts);

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
