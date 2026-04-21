import { describe, expect, test } from 'vitest';

import csvMetric from './__fixtures__/vesc_metric.csv?raw';
import csvUnknownFault from './__fixtures__/vesc_fault_unknown.csv?raw';
import { parseVescToolCsv } from './vesc-tool';

describe(parseVescToolCsv.name, () => {
  test('maps VESC CSV fields', async () => {
    const parsed = await parseVescToolCsv(csvMetric);

    expect(parsed.source).toBe('vesc_tool');
    expect(parsed.units).toBe('metric');
    expect(parsed.errors).toEqual([]);

    const first = parsed.data[0]!;
    expect(first.time).toBe(0);
    expect(first.voltage).toBe(81.5);
    expect(first.temp_mosfet).toBe(18.8);
    expect(first.temp_motor).toBe(26.5);
    expect(first.current_motor).toBe(10);
    expect(first.current_battery).toBe(9);
    expect(first.duty).toBe(50);
    expect(first.speed).toBeCloseTo(7.2, 6);
    expect(first.distance).toBeCloseTo(1.71023, 6);
    expect(first.state).toBe('riding');
    expect(first.state_raw).toBe(0);
    expect(parsed.data).toHaveLength(3);

    const second = parsed.data[1]!;
    expect(second.time).toBeCloseTo(0.1, 8);
    expect(second.state_raw).toBe(3);
    expect(second.state).toBe('wheelslip');

    const third = parsed.data[2]!;
    expect(third.time).toBeCloseTo(0.3, 8);
  });

  test('keeps unknown fault codes as explicit state labels', async () => {
    const parsed = await parseVescToolCsv(csvUnknownFault);

    expect(parsed.errors).toEqual([]);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0]!.state_raw).toBe(99);
    expect(parsed.data[0]!.state).toBe('fault 99');
  });
});
