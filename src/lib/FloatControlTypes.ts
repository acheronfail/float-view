import type { FloatControlRowWithIndex } from './Csv';

export enum FloatControlRawHeader {
  Time = 'Time(s)',
  State = 'State',
  Distance = 'Distance(km)',
  Speed = 'Speed(km/h)',
  Duty = 'Duty%',
  Voltage = 'Voltage',
  CurrentBattery = 'I-Battery',
  CurrentMotor = 'I-Motor',
  CurrentFieldWeakening = 'I-FldWeak',
  RequestedAmps = 'Requested Amps',
  Pitch = 'Pitch',
  Roll = 'Roll',
  Setpoint = 'Setpoint',
  SetpointAtr = 'SP-ATR',
  SetpointCarve = 'SP-Carve',
  TempMosfet = 'T-Mosfet',
  TempMotor = 'T-Mot',
  Adc1 = 'ADC1',
  Adc2 = 'ADC2',
  MotorFault = 'Motor-Fault',
  Ah = 'Ah',
  AhCharged = 'Ah Charged',
  Wh = 'Wh',
  WhCharged = 'Wh Charged',
  Erpm = 'ERPM',
  Altitude = 'Altitude(m)',
  StateRaw = 'State(num)',
  TruePitch = 'True Pitch',
  SetpointTorqueTilt = 'SP-TrqTlt',
  SetpointBreakTilt = 'SP-BrkTlt',
  SetpointRemote = 'SP-Remote',
  TempBattery = 'T-Batt',
  CurrentBooster = 'I-Booster',
  GpsLatitude = 'GPS-Lat',
  GpsLongitude = 'GPS-Long',
  GpsAccuracy = 'GPS-Accuracy',
}

export enum FloatControlHeader {
  Time = 'time',
  State = 'state',
  Distance = 'distance',
  Speed = 'speed',
  Duty = 'duty',
  Voltage = 'voltage',
  CurrentBattery = 'current_battery',
  CurrentMotor = 'current_motor',
  CurrentFieldWeakening = 'current_field_weakening',
  RequestedAmps = 'requested_amps',
  Pitch = 'pitch',
  Roll = 'roll',
  Setpoint = 'setpoint',
  SetpointAtr = 'setpoint_atr',
  SetpointCarve = 'setpoint_carve',
  TempMosfet = 'temp_mosfet',
  TempMotor = 'temp_motor',
  Adc1 = 'adc1',
  Adc2 = 'adc2',
  MotorFault = 'motor_fault',
  Ah = 'ah',
  AhCharged = 'ah_charged',
  Wh = 'wh',
  WhCharged = 'wh_charged',
  Erpm = 'erpm',
  Altitude = 'altitude',
  StateRaw = 'state_raw',
  TruePitch = 'true_pitch',
  SetpointTorqueTilt = 'setpoint_torque_tilt',
  SetpointBreakTilt = 'setpoint_break_tilt',
  SetpointRemote = 'setpoint_remote',
  TempBattery = 'temp_battery',
  CurrentBooster = 'current_booster',
  GpsLatitude = 'gps_latitude',
  GpsLongitude = 'gps_longitude',
  GpsAccuracy = 'gps_accuracy',
}

export const floatControlKeyMap: Record<FloatControlRawHeader, FloatControlHeader> = {
  [FloatControlRawHeader.Time]: FloatControlHeader.Time,
  [FloatControlRawHeader.State]: FloatControlHeader.State,
  [FloatControlRawHeader.Distance]: FloatControlHeader.Distance,
  [FloatControlRawHeader.Speed]: FloatControlHeader.Speed,
  [FloatControlRawHeader.Duty]: FloatControlHeader.Duty,
  [FloatControlRawHeader.Voltage]: FloatControlHeader.Voltage,
  [FloatControlRawHeader.CurrentBattery]: FloatControlHeader.CurrentBattery,
  [FloatControlRawHeader.CurrentMotor]: FloatControlHeader.CurrentMotor,
  [FloatControlRawHeader.CurrentFieldWeakening]: FloatControlHeader.CurrentFieldWeakening,
  [FloatControlRawHeader.RequestedAmps]: FloatControlHeader.RequestedAmps,
  [FloatControlRawHeader.Pitch]: FloatControlHeader.Pitch,
  [FloatControlRawHeader.Roll]: FloatControlHeader.Roll,
  [FloatControlRawHeader.Setpoint]: FloatControlHeader.Setpoint,
  [FloatControlRawHeader.SetpointAtr]: FloatControlHeader.SetpointAtr,
  [FloatControlRawHeader.SetpointCarve]: FloatControlHeader.SetpointCarve,
  [FloatControlRawHeader.TempMosfet]: FloatControlHeader.TempMosfet,
  [FloatControlRawHeader.TempMotor]: FloatControlHeader.TempMotor,
  [FloatControlRawHeader.Adc1]: FloatControlHeader.Adc1,
  [FloatControlRawHeader.Adc2]: FloatControlHeader.Adc2,
  [FloatControlRawHeader.MotorFault]: FloatControlHeader.MotorFault,
  [FloatControlRawHeader.Ah]: FloatControlHeader.Ah,
  [FloatControlRawHeader.AhCharged]: FloatControlHeader.AhCharged,
  [FloatControlRawHeader.Wh]: FloatControlHeader.Wh,
  [FloatControlRawHeader.WhCharged]: FloatControlHeader.WhCharged,
  [FloatControlRawHeader.Erpm]: FloatControlHeader.Erpm,
  [FloatControlRawHeader.Altitude]: FloatControlHeader.Altitude,
  [FloatControlRawHeader.StateRaw]: FloatControlHeader.StateRaw,
  [FloatControlRawHeader.TruePitch]: FloatControlHeader.TruePitch,
  [FloatControlRawHeader.SetpointTorqueTilt]: FloatControlHeader.SetpointTorqueTilt,
  [FloatControlRawHeader.SetpointBreakTilt]: FloatControlHeader.SetpointBreakTilt,
  [FloatControlRawHeader.SetpointRemote]: FloatControlHeader.SetpointRemote,
  [FloatControlRawHeader.TempBattery]: FloatControlHeader.TempBattery,
  [FloatControlRawHeader.CurrentBooster]: FloatControlHeader.CurrentBooster,
  [FloatControlRawHeader.GpsLatitude]: FloatControlHeader.GpsLatitude,
  [FloatControlRawHeader.GpsLongitude]: FloatControlHeader.GpsLongitude,
  [FloatControlRawHeader.GpsAccuracy]: FloatControlHeader.GpsAccuracy,
};

export interface FloatControlRow {
  [FloatControlHeader.Adc1]: number;
  [FloatControlHeader.Adc2]: number;
  [FloatControlHeader.Ah]: number;
  [FloatControlHeader.AhCharged]: number;
  [FloatControlHeader.Altitude]: number;
  [FloatControlHeader.CurrentBattery]: number;
  [FloatControlHeader.CurrentBooster]: number;
  [FloatControlHeader.CurrentFieldWeakening]: number;
  [FloatControlHeader.CurrentMotor]: number;
  [FloatControlHeader.Distance]: number;
  [FloatControlHeader.Duty]: number;
  [FloatControlHeader.Erpm]: number;
  [FloatControlHeader.GpsAccuracy]: number;
  [FloatControlHeader.GpsLatitude]: number;
  [FloatControlHeader.GpsLongitude]: number;
  [FloatControlHeader.MotorFault]: number;
  [FloatControlHeader.Pitch]: number;
  [FloatControlHeader.RequestedAmps]: number;
  [FloatControlHeader.Roll]: number;
  [FloatControlHeader.Setpoint]: number;
  [FloatControlHeader.SetpointAtr]: number;
  [FloatControlHeader.SetpointBreakTilt]: number;
  [FloatControlHeader.SetpointCarve]: number;
  [FloatControlHeader.SetpointRemote]: number;
  [FloatControlHeader.SetpointTorqueTilt]: number;
  [FloatControlHeader.Speed]: number;
  [FloatControlHeader.State]: string;
  [FloatControlHeader.StateRaw]: number;
  [FloatControlHeader.TempBattery]: number;
  [FloatControlHeader.TempMosfet]: number;
  [FloatControlHeader.TempMotor]: number;
  [FloatControlHeader.Time]: number;
  [FloatControlHeader.TruePitch]: number;
  [FloatControlHeader.Voltage]: number;
  [FloatControlHeader.Wh]: number;
  [FloatControlHeader.WhCharged]: number;
}

/**
 * NOTE: non-exhaustive for faults reported by VESC Tool
 * NOTE: also includes our custom faults
 */
export enum State {
  Startup = 'startup',
  StopHalf = 'stop half',
  StopFull = 'stop full',
  StopAngle = 'stop angle',
  Wheelslip = 'wheelslip',
  Custom_OneFootpadAtSpeed = 'custom: one footpad at speed',
  Custom_NoFootpadsAtSpeed = 'custom: no footpads at speed',
}

export const empty: FloatControlRowWithIndex = {
  index: -1,
  time: 0,
  state: 'STARTUP',
  distance: 0,
  speed: 0,
  duty: 0,
  voltage: 0,
  current_battery: 0,
  current_motor: 0,
  current_field_weakening: 0,
  requested_amps: 0,
  pitch: 0,
  roll: 0,
  setpoint: 0,
  setpoint_atr: 0,
  setpoint_carve: 0,
  temp_mosfet: 0,
  temp_motor: 0,
  adc1: 0,
  adc2: 0,
  motor_fault: 0,
  ah: 0,
  ah_charged: 0,
  wh: 0,
  wh_charged: 0,
  erpm: 0,
  altitude: 0,
  state_raw: 0,
  true_pitch: 0,
  setpoint_torque_tilt: 0,
  setpoint_break_tilt: 0,
  setpoint_remote: 0,
  temp_battery: 0,
  current_booster: 0,
  gps_latitude: 0,
  gps_longitude: 0,
  gps_accuracy: 0,
};
