import { ParseError, type ParseResult } from './index';
import { attachIndex } from '../misc';
import { FloatyJsonSchema, type ZFloatyJson, type ZLocation, type ZLog } from './floaty.types';
import { DataSource, stateCodeMap, Units, type Row } from './types';

function rowsFromFloatyJson(json: ZFloatyJson): Row[] {
  const rows: Row[] = [];
  // NOTE: sometimes Floaty doesn't record values, and seems to just put `null` in its logs.
  // When it does, we backtrack until we find the last known value for it.
  const findValue = (index: number, key: keyof ZLog, floatyEmptyValue?: unknown): number => {
    const current = json.logs[index]![key];
    if (current !== null && (floatyEmptyValue === undefined || current !== floatyEmptyValue)) {
      return current;
    }

    let i = index - 1;
    while (i > 0) {
      const value = json.logs[i]![key];
      if (value !== null && (floatyEmptyValue === undefined || value !== floatyEmptyValue)) {
        return value;
      }

      i--;
    }

    return 0;
  };

  const map = (log: ZLog, location: ZLocation, index: number): Row => {
    const state_raw = findValue(index, 'state');
    return {
      adc1: findValue(index, 'adc1'),
      adc2: findValue(index, 'adc2'),
      ah: findValue(index, 'ampHours'),
      altitude: location.altitude,
      current_battery: findValue(index, 'batteryCurrent'),
      current_motor: findValue(index, 'motorCurrent'),
      distance: findValue(index, 'tripDistance', 0),
      duty: findValue(index, 'dutyCycle') * 100,
      gps_accuracy: location.accuracy,
      gps_latitude: location.latitude,
      gps_longitude: location.longitude,
      motor_fault: findValue(index, 'faultCode'),
      pitch: findValue(index, 'pitchAngle'),
      roll: findValue(index, 'rollAngle'),
      speed: findValue(index, 'speed'),
      state_raw,
      state: stateCodeMap[state_raw] ?? '??',
      temp_mosfet: findValue(index, 'controllerTemp', 0),
      temp_motor: findValue(index, 'motorTemp', 0),
      time: (log.timestamp - json.startTime) / 1000,
      true_pitch: findValue(index, 'truePitchAngle'),
      voltage: findValue(index, 'batteryVolts'),
      wh: findValue(index, 'wattHours'),
    };
  };

  const { logs, locations } = json;
  let locationIdx = 0;
  for (let i = 0; i < logs.length; ++i) {
    const log = logs[i]!;
    let location = locations[locationIdx]!;
    if (location.timestamp < log.timestamp && locations[locationIdx + 1]) {
      location = locations[++locationIdx]!;
    }

    rows.push(map(log, location, i));
  }

  return rows;
}

export async function parseFloatyJson(input: string | File): Promise<ParseResult> {
  try {
    const json = JSON.parse(typeof input === 'string' ? input : await input.text());
    const data = FloatyJsonSchema.parse(json);
    return {
      source: DataSource.Floaty,
      data: attachIndex(rowsFromFloatyJson(data)),
      units: Units.Metric,
      error: undefined,
    };
  } catch (error) {
    return {
      source: DataSource.Floaty,
      data: [],
      units: Units.Metric,
      error: new ParseError('Failed to parse Floaty JSON!', error),
    };
  }
}
