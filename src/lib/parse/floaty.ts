import { ParseError, type ParseResult } from './index';
import { attachIndex } from '../Utils';
import { FloatyJsonSchema, type ZFloatyJson, type ZLocation, type ZLog } from './floaty.types';
import { stateCodeMap, type Row } from './types';

function rowsFromFloatyJson(json: ZFloatyJson): Row[] {
  const rows: Row[] = [];
  const map = (log: ZLog, location: ZLocation) => ({
    adc1: log.adc1,
    adc2: log.adc2,
    ah_charged: NaN,
    ah: log.ampHours,
    altitude: location.altitude,
    bms_fault: NaN,
    bms_temp: NaN,
    bms_temp_battery: NaN,
    current_battery: log.batteryCurrent,
    current_booster: NaN,
    current_field_weakening: NaN,
    current_motor: log.motorCurrent,
    distance: log.tripDistance,
    duty: log.dutyCycle,
    erpm: NaN,
    gps_accuracy: location.accuracy,
    gps_latitude: location.latitude,
    gps_longitude: location.longitude,
    motor_fault: log.faultCode,
    pitch: log.pitchAngle,
    requested_amps: NaN,
    roll: log.rollAngle,
    setpoint_atr: NaN,
    setpoint_break_tilt: NaN,
    setpoint_carve: NaN,
    setpoint_remote: NaN,
    setpoint_torque_tilt: NaN,
    setpoint: NaN,
    speed: log.speed,
    state_raw: log.state,
    state: stateCodeMap[log.state],
    temp_battery: NaN,
    temp_mosfet: log.controllerTemp,
    temp_motor: log.motorTemp,
    time: (log.timestamp - json.startTime) / 1000,
    true_pitch: log.truePitchAngle,
    voltage: log.batteryVolts,
    wh_charged: NaN,
    wh: log.wattHours,
  });

  const { logs, locations } = json;
  let locationIdx = 0;
  for (let i = 0; i < logs.length; ++i) {
    const log = logs[i];
    let location = locations[locationIdx];
    if (location.timestamp < log.timestamp && locations[locationIdx + 1]) {
      location = locations[++locationIdx];
    }

    rows.push(map(log, location));
  }

  return rows;
}

// TODO: confirm if floaty always saves data in metric units
export async function parseFloatyJson(input: string | File): Promise<ParseResult> {
  try {
    const json = JSON.parse(typeof input === 'string' ? input : await input.text());
    const data = FloatyJsonSchema.parse(json);
    return {
      data: attachIndex(rowsFromFloatyJson(data)),
      units: 'metric',
      error: undefined,
    };
  } catch (error) {
    return {
      data: [],
      units: 'metric',
      error: new ParseError('Failed to parse Floaty JSON!', error),
    };
  }
}
