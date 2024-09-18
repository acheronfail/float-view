import { ParseError, type ParseResult } from './index';
import { attachIndex } from '../misc';
import { FloatyJsonSchema, type ZFloatyJson, type ZLocation, type ZLog } from './floaty.types';
import { DataSource, stateCodeMap, Units, type Row } from './types';

function rowsFromFloatyJson(json: ZFloatyJson): Row[] {
  const rows: Row[] = [];
  // NOTE: sometimes Floaty doesn't record values, and seems to just put `null` in its logs.
  // When it does, we backtrack until we find the last known value for it.
  const findValue = (index: number, key: keyof ZLog): number => {
    const current = json.logs[index]![key];
    if (current !== null) {
      return current;
    }

    let i = index - 1;
    while (i > 0) {
      const value = json.logs[i]![key];
      if (value !== null) {
        return value;
      }

      i--;
    }

    return 0;
  };
  const FLOATY_UNSUPPORTED = NaN;
  const map = (log: ZLog, location: ZLocation, index: number): Row => {
    const state_raw = findValue(index, 'state');
    return {
      adc1: findValue(index, 'adc1'),
      adc2: findValue(index, 'adc2'),
      ah_charged: FLOATY_UNSUPPORTED,
      ah: findValue(index, 'ampHours'),
      altitude: location.altitude,
      bms_fault: FLOATY_UNSUPPORTED,
      bms_temp: FLOATY_UNSUPPORTED,
      bms_temp_battery: FLOATY_UNSUPPORTED,
      current_battery: findValue(index, 'batteryCurrent'),
      current_booster: FLOATY_UNSUPPORTED,
      current_field_weakening: FLOATY_UNSUPPORTED,
      current_motor: findValue(index, 'motorCurrent'),
      distance: findValue(index, 'tripDistance'),
      duty: findValue(index, 'dutyCycle') * 100,
      erpm: FLOATY_UNSUPPORTED,
      gps_accuracy: location.accuracy,
      gps_latitude: location.latitude,
      gps_longitude: location.longitude,
      motor_fault: findValue(index, 'faultCode'),
      pitch: findValue(index, 'pitchAngle'),
      requested_amps: FLOATY_UNSUPPORTED,
      roll: findValue(index, 'rollAngle'),
      setpoint_atr: FLOATY_UNSUPPORTED,
      setpoint_break_tilt: FLOATY_UNSUPPORTED,
      setpoint_carve: FLOATY_UNSUPPORTED,
      setpoint_remote: FLOATY_UNSUPPORTED,
      setpoint_torque_tilt: FLOATY_UNSUPPORTED,
      setpoint: FLOATY_UNSUPPORTED,
      speed: findValue(index, 'speed'),
      state_raw,
      state: stateCodeMap[state_raw] ?? '??',
      temp_battery: FLOATY_UNSUPPORTED,
      temp_mosfet: findValue(index, 'controllerTemp'),
      temp_motor: findValue(index, 'motorTemp'),
      time: (log.timestamp - json.startTime) / 1000,
      true_pitch: findValue(index, 'truePitchAngle'),
      voltage: findValue(index, 'batteryVolts'),
      wh_charged: FLOATY_UNSUPPORTED,
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
