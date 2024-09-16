import { beforeEach, describe, expect, test, vi } from 'vitest';

import csvMetric from './__fixtures__/fc_metric.csv?raw';
import csvMetricWithBms from './__fixtures__/fc_metric_bms.csv?raw';
import csvImperial from './__fixtures__/fc_imperial.csv?raw';
import csvImperialWithBms from './__fixtures__/fc_imperial_bms.csv?raw';
import csvWithUnknownState from './__fixtures__/fc_metric_unknown_state.csv?raw';
import csvWithBadtime from './__fixtures__/fc_metric_bad_time.csv?raw';
import { parseFloatControlCsv } from './float-control';
import { defaultBms, defaultFixture } from './__fixtures__/fixture';

describe(parseFloatControlCsv.name, () => {
  beforeEach(() => vi.restoreAllMocks());

  test('metric', async () => {
    const { units, csv } = await parseFloatControlCsv(csvMetric);
    expect(units).toBe('metric');
    expect(csv.errors).toEqual([]);
    expect(csv.data).toEqual([defaultFixture]);
  });

  test('metric with bms', async () => {
    const { units, csv } = await parseFloatControlCsv(csvMetricWithBms);
    expect(units).toBe('metric');
    expect(csv.errors).toEqual([]);
    expect(csv.data).toEqual([{ ...defaultFixture, ...defaultBms }]);
  });

  test('imperial', async () => {
    const { units, csv } = await parseFloatControlCsv(csvImperial);
    expect(units).toBe('imperial');
    expect(csv.errors).toEqual([]);
    expect(csv.data).toEqual([defaultFixture]);
  });

  test('imperial with bms', async () => {
    const { units, csv } = await parseFloatControlCsv(csvImperialWithBms);
    expect(units).toBe('imperial');
    expect(csv.errors).toEqual([]);
    expect(csv.data).toEqual([{ ...defaultFixture, ...defaultBms }]);
  });

  test('with unknown state', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockReturnValue();
    const { units, csv } = await parseFloatControlCsv(csvWithUnknownState);
    expect(units).toBe('metric');
    expect(csv.errors).toEqual([]);
    expect(csv.data).toEqual([{ ...defaultFixture, state: 'some_new_state' }]);
    expect(warnSpy).toHaveBeenCalledWith("Unknown state: 'SOME_NEW_STATE'");
  });

  test('with bad time', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockReturnValue();
    const { units, csv } = await parseFloatControlCsv(csvWithBadtime);
    expect(units).toBe('metric');
    expect(csv.errors).toEqual([]);
    expect(csv.data).toEqual([{ ...defaultFixture, time: 0 }]);
    expect(warnSpy).toHaveBeenCalledWith("Failed to parse CSV! Expected a number, but got: 'I am not a number'");
  });
});
