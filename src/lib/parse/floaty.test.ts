import { describe, expect, test } from 'vitest';
import { parseFloatyJson } from './floaty';
import floatyJsonString from './__fixtures__/floaty.json?raw';
import floatyJson from './__fixtures__/floaty.json';

describe(parseFloatyJson.name, () => {
  test('maps gps locations to logs', async () => {
    const { data, units } = await parseFloatyJson(floatyJsonString);
    expect(units).toEqual('metric');
    expect(data).toHaveLength(3);

    expect(data[0]!.gps_latitude).toBe(-1.0);
    expect(data[0]!.gps_longitude).toBe(1.5);
    expect(data[1]!.gps_latitude).toBe(-1.1);
    expect(data[1]!.gps_longitude).toBe(1.6);
    expect(data[2]!.gps_latitude).toBe(-1.1);
    expect(data[2]!.gps_longitude).toBe(1.6);
  });

  test('handles missing data in logs', async () => {
    const { data } = await parseFloatyJson(floatyJsonString);

    // fields set to null

    expect(floatyJson.logs[2]!.batteryCurrent).toBe(null);
    expect(data[1]!.current_battery).toBe(0.4);
    expect(data[2]!.current_battery).toBe(data[1]!.current_battery);

    expect(floatyJson.logs[2]!.batteryVolts).toBe(null);
    expect(data[1]!.voltage).toBe(81.8);
    expect(data[2]!.voltage).toBe(data[1]!.voltage);

    expect(floatyJson.logs[2]!.dutyCycle).toBe(null);
    expect(data[1]!.duty).toBe(4);
    expect(data[2]!.duty).toBe(data[1]!.duty);

    expect(floatyJson.logs[2]!.motorCurrent).toBe(null);
    expect(data[1]!.current_motor).toBe(14);
    expect(data[2]!.current_motor).toBe(data[1]!.current_motor);

    expect(floatyJson.logs[2]!.speed).toBe(null);
    expect(data[1]!.speed).toBe(0.7);
    expect(data[2]!.speed).toBe(data[1]!.speed);

    // fields set to 0

    expect(floatyJson.logs[2]!.controllerTemp).toBe(0);
    expect(data[1]!.temp_mosfet).toBe(18);
    expect(data[2]!.temp_mosfet).toBe(data[1]!.temp_mosfet);

    expect(floatyJson.logs[2]!.motorTemp).toBe(0);
    expect(data[1]!.temp_motor).toBe(21);
    expect(data[2]!.temp_motor).toBe(data[1]!.temp_motor);

    expect(floatyJson.logs[2]!.tripDistance).toBe(0);
    expect(data[1]!.distance).toBe(0.5);
    expect(data[2]!.distance).toBe(data[1]!.distance);
  });
});
