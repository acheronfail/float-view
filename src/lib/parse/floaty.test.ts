import { describe, expect, test } from 'vitest';
import { parseFloatyJson } from './floaty';
import floatyJson from './__fixtures__/floaty.json?raw';

describe(parseFloatyJson.name, () => {
  test('can parse json', async () => {
    const { data, units } = await parseFloatyJson(floatyJson);
    expect(units).toEqual('metric');
    expect(data).toHaveLength(3);

    expect(data[0]!.gps_latitude).toBe(-1.0);
    expect(data[0]!.gps_longitude).toBe(1.5);
    expect(data[1]!.gps_latitude).toBe(-1.1);
    expect(data[1]!.gps_longitude).toBe(1.6);
    expect(data[2]!.gps_latitude).toBe(-1.1);
    expect(data[2]!.gps_longitude).toBe(1.6);
  });
});
