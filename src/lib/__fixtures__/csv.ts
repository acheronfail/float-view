import type { FloatControlRowWithIndex } from '../Csv';
import type { FloatControlHeader } from '../FloatControlTypes';

export const defaultBms: Pick<
  FloatControlRowWithIndex,
  FloatControlHeader.BmsFault | FloatControlHeader.BmsTemp | FloatControlHeader.BmsTempBattery
> = {
  bms_fault: 0,
  bms_temp: 36.5,
  bms_temp_battery: 29.0,
};

export const defaultFixture: FloatControlRowWithIndex = {
  adc1: 3.04,
  adc2: 3.06,
  ah: 0,
  ah_charged: 0,
  altitude: 135,
  current_battery: 0.1,
  current_booster: 0,
  current_field_weakening: 0,
  current_motor: 7.3,
  distance: 0,
  duty: 2,
  erpm: 0,
  gps_accuracy: 9,
  gps_latitude: -1.091225,
  gps_longitude: 1.566577,
  index: 0,
  motor_fault: 0,
  pitch: -0.1,
  requested_amps: 8.1,
  roll: 3.4,
  setpoint: 0,
  setpoint_atr: 0,
  setpoint_break_tilt: 0,
  setpoint_carve: 0,
  setpoint_remote: 0,
  setpoint_torque_tilt: 0,
  speed: 0,
  state: 'riding',
  state_raw: 1,
  temp_battery: 0,
  temp_mosfet: 25.2,
  temp_motor: 21.7,
  time: 0.12,
  true_pitch: -0.1,
  voltage: 76,
  wh: 0.14,
  wh_charged: 0.02,
};
