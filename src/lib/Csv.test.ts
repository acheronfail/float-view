import { beforeEach, describe, expect, test, vi } from 'vitest';

import csvMetric from './__fixtures__/metric.csv?raw';
import csvMetricWithBms from './__fixtures__/metric_bms.csv?raw';
import csvImperial from './__fixtures__/imperial.csv?raw';
import csvImperialWithBms from './__fixtures__/imperial_bms.csv?raw';
import csvWithUnknownState from './__fixtures__/metric_unknown_state.csv?raw';
import csvWithBadtime from './__fixtures__/metric_bad_time.csv?raw';
import { parse } from './Csv';
import { defaultBms, defaultFixture } from './__fixtures__/csv';

describe(parse.name, () => {
  beforeEach(() => vi.restoreAllMocks());

  test('metric', async () => {
    const { units, csv } = await parse(csvMetric);
    expect(units).toBe('metric');
    expect(csv.errors).toEqual([]);
    expect(csv.data).toEqual([defaultFixture]);
  });

  test('metric with bms', async () => {
    const { units, csv } = await parse(csvMetricWithBms);
    expect(units).toBe('metric');
    expect(csv.errors).toEqual([]);
    expect(csv.data).toEqual([{ ...defaultFixture, ...defaultBms }]);
  });

  test('imperial', async () => {
    const { units, csv } = await parse(csvImperial);
    expect(units).toBe('imperial');
    expect(csv.errors).toEqual([]);
    expect(csv.data).toEqual([defaultFixture]);
  });

  test('imperial with bms', async () => {
    const { units, csv } = await parse(csvImperialWithBms);
    expect(units).toBe('imperial');
    expect(csv.errors).toEqual([]);
    expect(csv.data).toEqual([{ ...defaultFixture, ...defaultBms }]);
  });

  test('with unknown state', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockReturnValue();
    const { units, csv } = await parse(csvWithUnknownState);
    expect(units).toBe('metric');
    expect(csv.errors).toEqual([]);
    expect(csv.data).toEqual([{ ...defaultFixture, state: 'some_new_state' }]);
    expect(warnSpy).toHaveBeenCalledWith("Unknown state: 'SOME_NEW_STATE'");
  });

  test('with bad time', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockReturnValue();
    const { units, csv } = await parse(csvWithBadtime);
    expect(units).toBe('metric');
    expect(csv.errors).toEqual([]);
    expect(csv.data).toEqual([{ ...defaultFixture, time: 0 }]);
    expect(warnSpy).toHaveBeenCalledWith("Failed to parse CSV! Expected a number, but got: 'I am not a number'");
  });
});
