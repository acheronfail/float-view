import { describe, expect, test } from 'vitest';
import { DataSource, State, type RowWithIndex } from '../lib/parse/types';
import { extractGpsInformation, findPointsOfInterest } from './View';

const makeRow = (overrides: Partial<RowWithIndex> = {}): RowWithIndex => ({
  index: 0,
  adc1: 0,
  adc2: 0,
  ah: 0,
  altitude: 0,
  current_battery: 0,
  current_motor: 0,
  distance: 0,
  duty: 0,
  gps_accuracy: 0,
  gps_latitude: 0,
  gps_longitude: 0,
  motor_fault: 0,
  pitch: 0,
  roll: 0,
  speed: 0,
  state: State.Riding,
  state_raw: 0,
  temp_mosfet: 0,
  temp_motor: 0,
  time: 0,
  true_pitch: 0,
  voltage: 0,
  wh: 0,
  ...overrides,
});

describe(extractGpsInformation.name, () => {
  test('replaces leading (0,0) gps points with first non-zero coordinate for all sources', () => {
    const rows: RowWithIndex[] = [
      makeRow({ index: 0, time: 0, gps_latitude: 0, gps_longitude: 0 }),
      makeRow({ index: 1, time: 1, gps_latitude: 0, gps_longitude: 0 }),
      makeRow({ index: 2, time: 2, gps_latitude: -37.81, gps_longitude: 144.96 }),
      makeRow({ index: 3, time: 3, gps_latitude: -37.82, gps_longitude: 144.97 }),
    ];

    const sources = [DataSource.FloatControl, DataSource.Floaty, DataSource.VescTool];
    for (const source of sources) {
      const { gpsPoints } = extractGpsInformation(rows, source);

      expect(gpsPoints[0]).toEqual([-37.81, 144.96]);
      expect(gpsPoints[1]).toEqual([-37.81, 144.96]);
      expect(gpsPoints[2]).toEqual([-37.81, 144.96]);
      expect(gpsPoints[3]).toEqual([-37.82, 144.97]);
    }
  });
});

describe(findPointsOfInterest.name, () => {
  test('does not infer footpad faults when ADC telemetry is absent', () => {
    const rows: RowWithIndex[] = [
      makeRow({ index: 0, speed: 10, adc1: 0, adc2: 0 }),
      makeRow({ index: 1, speed: 15, adc1: 0, adc2: 0 }),
    ];

    const points = findPointsOfInterest(rows);
    expect(points).toEqual([]);
  });

  test('still infers footpad faults when ADC telemetry is present', () => {
    const rows: RowWithIndex[] = [
      makeRow({ index: 0, speed: 10, adc1: 0, adc2: 3 }),
      makeRow({ index: 1, speed: 10, adc1: 0, adc2: 1 }),
    ];

    const points = findPointsOfInterest(rows);
    expect(points).toEqual([
      { index: 0, state: State.Custom_OneFootpadAtSpeed },
      { index: 1, state: State.Custom_NoFootpadsAtSpeed },
    ]);
  });
});
