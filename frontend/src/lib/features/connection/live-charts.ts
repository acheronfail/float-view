import type { BmsState, LiveSample, LiveWidgetField, UnitPreference } from '$lib/backend/contract';
import { driveLoadComponents } from './gauge';
import { freshBmsSnapshot } from './bms';
import { liveValue, type LocationElevation } from './live-values';
export const liveChartWindowMs = 30_000;
export const liveChartPointLimit = 1_500;
export type LiveChartField = LiveWidgetField | 'bmsCircuitryTempC' | 'motorLoad' | 'batteryLoad';
export interface LiveChartPoint {
  time: number;
  sample: LiveSample;
  estimatedLevel?: number | null;
  bms?: BmsState | null;
  location?: LocationElevation;
  capturedAtMs?: number;
  bmsTemperatures?: { circuitryC: number | null; cellsC: number | null };
}
export function liveChartGroups(showBmsTemperatures: boolean): { title: string; fields: LiveChartField[] }[] {
  return [
    { title: 'Speed', fields: ['speedKph'] },
    { title: 'Load', fields: ['dutyCycle', 'motorLoad', 'batteryLoad'] },
    { title: 'Current', fields: ['motorCurrentA', 'batteryCurrentA'] },
    { title: 'Pack voltage', fields: ['packVoltageV'] },
    {
      title: 'Temperature',
      fields: [
        'controllerTempC',
        'motorTempC',
        ...(showBmsTemperatures ? (['bmsCircuitryTempC', 'bmsHighestCellTempC'] as const) : []),
      ],
    },
    { title: 'Board angles', fields: ['pitchDeg', 'rollDeg', 'setpointDeg'] },
    { title: 'Remote input', fields: ['remoteInput'] },
  ];
}
export function retainLivePoints(points: LiveChartPoint[], now: number): LiveChartPoint[] {
  return points.filter((point) => point.time >= now - liveChartWindowMs).slice(-liveChartPointLimit);
}
export function liveChartReading(
  field: LiveChartField,
  sample: LiveSample | null | undefined,
  units: UnitPreference,
  bms?: BmsState | null,
  nowMs: number = Date.now(),
  estimatedLevel?: number | null
) {
  if (field === 'dutyCycle' || field === 'motorLoad' || field === 'batteryLoad') {
    const source = field === 'dutyCycle' ? 'duty' : field === 'motorLoad' ? 'motor' : 'battery';
    return {
      name: 'Load',
      label: { duty: 'Duty', motor: 'Motor', battery: 'Battery' }[source],
      unit: '%',
      digits: 0,
      value: driveLoadComponents(sample)[source],
    };
  }
  if (field !== 'bmsCircuitryTempC') {
    const reading = liveValue(field, sample, units, estimatedLevel, bms, nowMs);
    return field === 'bmsHighestCellTempC' ? { ...reading, label: 'Cells' } : reading;
  }
  const celsius = freshBmsSnapshot(bms, nowMs)?.highestCircuitryTemperatureC;
  return {
    name: 'BMS circuitry temperature',
    label: 'BMS',
    unit: units === 'metric' ? '°C' : '°F',
    digits: 1,
    value: displayTemperature(celsius, units),
  };
}
export function liveChartGeometry(
  points: LiveChartPoint[],
  fields: LiveChartField[],
  units: UnitPreference,
  now: number,
  options: { rawReadings?: boolean } = {}
) {
  const visible = retainLivePoints(points, now);
  const series = fields.map((field) =>
    visible.map((point) => ({
      time: point.time,
      value: options.rawReadings
        ? liveValue(
            field as LiveWidgetField,
            point.sample,
            units,
            point.estimatedLevel,
            point.bms,
            point.capturedAtMs ?? Date.parse(point.sample.observedAt),
            point.location
          ).value
        : field === 'bmsCircuitryTempC'
          ? displayTemperature(point.bmsTemperatures?.circuitryC, units)
          : field === 'bmsHighestCellTempC'
            ? displayTemperature(point.bmsTemperatures?.cellsC, units)
            : liveChartReading(
                field,
                point.sample,
                units,
                point.bms,
                point.capturedAtMs ?? Date.parse(point.sample.observedAt),
                point.estimatedLevel
              ).value,
    }))
  );
  const values = series.flatMap((line) => line.flatMap((point) => (point.value === null ? [] : [point.value])));
  const minimum = Math.min(0, ...values);
  const upper = Math.max(options.rawReadings ? 0 : 1, ...values);
  const maximum = upper === minimum ? minimum + 1 : upper;
  const padding = (maximum - minimum) * 0.08;
  const isLoad =
    !options.rawReadings && fields.every((field) => ['dutyCycle', 'motorLoad', 'batteryLoad'].includes(field));
  const isRemoteInput = fields.length === 1 && fields[0] === 'remoteInput';
  const low = isRemoteInput ? -1 : isLoad ? 0 : minimum < 0 ? minimum - padding : 0;
  const high = isRemoteInput ? 1 : isLoad ? 100 : maximum + padding;
  return {
    low,
    high,
    paths: series.map((line) => {
      let previous: number | null = null;
      return line
        .map(({ time, value }) => {
          if (value === null) {
            previous = null;
            return '';
          }
          const command = previous === null || time - previous > 1_500 ? 'M' : 'L';
          previous = time;
          const x = ((time - (now - liveChartWindowMs)) / liveChartWindowMs) * 1000;
          const y = 100 - ((value - low) / (high - low)) * 100;
          return `${command}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(' ');
    }),
  };
}

function displayTemperature(celsius: number | null | undefined, units: UnitPreference) {
  if (celsius == null || !Number.isFinite(celsius)) return null;
  return units === 'metric' ? celsius : celsius * 1.8 + 32;
}

export function liveChartColor(field: LiveChartField, index: number): string {
  if (field === 'dutyCycle') return 'var(--app-duty)';
  if (field === 'motorLoad') return 'var(--app-danger)';
  if (field === 'batteryLoad') return 'var(--app-success)';
  return ['var(--color-accent)', '#f59e0b', '#a78bfa', '#2dd4bf'][index];
}
