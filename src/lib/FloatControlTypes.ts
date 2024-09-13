import type { FloatControlRowWithIndex } from './Csv';

export enum FloatControlRawHeader {
  Adc1 = 'ADC1',
  Adc2 = 'ADC2',
  Ah = 'Ah',
  AhCharged = 'Ah Charged',
  Altitude = 'Altitude(m)',
  BmsFault = 'BMS-Fault',
  BmsTemp = 'T-BMS',
  BmsTempBattery = 'T-Battery',
  CurrentBattery = 'I-Battery',
  CurrentBooster = 'I-Booster',
  CurrentFieldWeakening = 'I-FldWeak',
  CurrentMotor = 'I-Motor',
  DistanceKm = 'Distance(km)',
  DistanceMi = 'Distance(mi)',
  Duty = 'Duty%',
  Erpm = 'ERPM',
  GpsAccuracy = 'GPS-Accuracy',
  GpsLatitude = 'GPS-Lat',
  GpsLongitude = 'GPS-Long',
  MotorFault = 'Motor-Fault',
  Pitch = 'Pitch',
  RequestedAmps = 'Requested Amps',
  Roll = 'Roll',
  Setpoint = 'Setpoint',
  SetpointAtr = 'SP-ATR',
  SetpointBreakTilt = 'SP-BrkTlt',
  SetpointCarve = 'SP-Carve',
  SetpointRemote = 'SP-Remote',
  SetpointTorqueTilt = 'SP-TrqTlt',
  SpeedKm = 'Speed(km/h)',
  SpeedMi = 'Speed(mph)',
  State = 'State',
  StateRaw = 'State(num)',
  TempBattery = 'T-Batt',
  TempMosfet = 'T-Mosfet',
  TempMotor = 'T-Mot',
  Time = 'Time(s)',
  TruePitch = 'True Pitch',
  Voltage = 'Voltage',
  Wh = 'Wh',
  WhCharged = 'Wh Charged',
}

export enum FloatControlHeader {
  Adc1 = 'adc1',
  Adc2 = 'adc2',
  Ah = 'ah',
  AhCharged = 'ah_charged',
  Altitude = 'altitude',
  BmsFault = 'bms_fault',
  BmsTemp = 'bms_temp',
  BmsTempBattery = 'bms_temp_battery',
  CurrentBattery = 'current_battery',
  CurrentBooster = 'current_booster',
  CurrentFieldWeakening = 'current_field_weakening',
  CurrentMotor = 'current_motor',
  Distance = 'distance',
  Duty = 'duty',
  Erpm = 'erpm',
  GpsAccuracy = 'gps_accuracy',
  GpsLatitude = 'gps_latitude',
  GpsLongitude = 'gps_longitude',
  MotorFault = 'motor_fault',
  Pitch = 'pitch',
  RequestedAmps = 'requested_amps',
  Roll = 'roll',
  Setpoint = 'setpoint',
  SetpointAtr = 'setpoint_atr',
  SetpointBreakTilt = 'setpoint_break_tilt',
  SetpointCarve = 'setpoint_carve',
  SetpointRemote = 'setpoint_remote',
  SetpointTorqueTilt = 'setpoint_torque_tilt',
  Speed = 'speed',
  State = 'state',
  StateRaw = 'state_raw',
  TempBattery = 'temp_battery',
  TempMosfet = 'temp_mosfet',
  TempMotor = 'temp_motor',
  Time = 'time',
  TruePitch = 'true_pitch',
  Voltage = 'voltage',
  Wh = 'wh',
  WhCharged = 'wh_charged',
}

export const floatControlKeyMap: Record<FloatControlRawHeader, FloatControlHeader> = {
  [FloatControlRawHeader.Adc1]: FloatControlHeader.Adc1,
  [FloatControlRawHeader.Adc2]: FloatControlHeader.Adc2,
  [FloatControlRawHeader.Ah]: FloatControlHeader.Ah,
  [FloatControlRawHeader.AhCharged]: FloatControlHeader.AhCharged,
  [FloatControlRawHeader.Altitude]: FloatControlHeader.Altitude,
  [FloatControlRawHeader.BmsFault]: FloatControlHeader.BmsFault,
  [FloatControlRawHeader.BmsTemp]: FloatControlHeader.BmsTemp,
  [FloatControlRawHeader.BmsTempBattery]: FloatControlHeader.BmsTempBattery,
  [FloatControlRawHeader.CurrentBattery]: FloatControlHeader.CurrentBattery,
  [FloatControlRawHeader.CurrentBooster]: FloatControlHeader.CurrentBooster,
  [FloatControlRawHeader.CurrentFieldWeakening]: FloatControlHeader.CurrentFieldWeakening,
  [FloatControlRawHeader.CurrentMotor]: FloatControlHeader.CurrentMotor,
  [FloatControlRawHeader.DistanceKm]: FloatControlHeader.Distance,
  [FloatControlRawHeader.DistanceMi]: FloatControlHeader.Distance,
  [FloatControlRawHeader.Duty]: FloatControlHeader.Duty,
  [FloatControlRawHeader.Erpm]: FloatControlHeader.Erpm,
  [FloatControlRawHeader.GpsAccuracy]: FloatControlHeader.GpsAccuracy,
  [FloatControlRawHeader.GpsLatitude]: FloatControlHeader.GpsLatitude,
  [FloatControlRawHeader.GpsLongitude]: FloatControlHeader.GpsLongitude,
  [FloatControlRawHeader.MotorFault]: FloatControlHeader.MotorFault,
  [FloatControlRawHeader.Pitch]: FloatControlHeader.Pitch,
  [FloatControlRawHeader.RequestedAmps]: FloatControlHeader.RequestedAmps,
  [FloatControlRawHeader.Roll]: FloatControlHeader.Roll,
  [FloatControlRawHeader.Setpoint]: FloatControlHeader.Setpoint,
  [FloatControlRawHeader.SetpointAtr]: FloatControlHeader.SetpointAtr,
  [FloatControlRawHeader.SetpointBreakTilt]: FloatControlHeader.SetpointBreakTilt,
  [FloatControlRawHeader.SetpointCarve]: FloatControlHeader.SetpointCarve,
  [FloatControlRawHeader.SetpointRemote]: FloatControlHeader.SetpointRemote,
  [FloatControlRawHeader.SetpointTorqueTilt]: FloatControlHeader.SetpointTorqueTilt,
  [FloatControlRawHeader.SpeedKm]: FloatControlHeader.Speed,
  [FloatControlRawHeader.SpeedMi]: FloatControlHeader.Speed,
  [FloatControlRawHeader.State]: FloatControlHeader.State,
  [FloatControlRawHeader.StateRaw]: FloatControlHeader.StateRaw,
  [FloatControlRawHeader.TempBattery]: FloatControlHeader.TempBattery,
  [FloatControlRawHeader.TempMosfet]: FloatControlHeader.TempMosfet,
  [FloatControlRawHeader.TempMotor]: FloatControlHeader.TempMotor,
  [FloatControlRawHeader.Time]: FloatControlHeader.Time,
  [FloatControlRawHeader.TruePitch]: FloatControlHeader.TruePitch,
  [FloatControlRawHeader.Voltage]: FloatControlHeader.Voltage,
  [FloatControlRawHeader.Wh]: FloatControlHeader.Wh,
  [FloatControlRawHeader.WhCharged]: FloatControlHeader.WhCharged,
};

export interface FloatControlRow {
  [FloatControlHeader.Adc1]: number;
  [FloatControlHeader.Adc2]: number;
  [FloatControlHeader.Ah]: number;
  [FloatControlHeader.AhCharged]: number;
  [FloatControlHeader.Altitude]: number;
  [FloatControlHeader.BmsFault]?: number;
  [FloatControlHeader.BmsTemp]?: number;
  [FloatControlHeader.BmsTempBattery]?: number;
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
  Quickstop = 'quickstop',
  StopHalf = 'stop half',
  StopFull = 'stop full',
  StopAngle = 'stop angle',
  Wheelslip = 'wheelslip',
  Custom_OneFootpadAtSpeed = 'custom: one footpad at speed',
  Custom_NoFootpadsAtSpeed = 'custom: no footpads at speed',
}

export const empty: FloatControlRowWithIndex = {
  index: -1,
  adc1: 0,
  adc2: 0,
  ah_charged: 0,
  ah: 0,
  altitude: 0,
  bms_fault: 0,
  bms_temp: 0,
  bms_temp_battery: 0,
  current_battery: 0,
  current_booster: 0,
  current_field_weakening: 0,
  current_motor: 0,
  distance: 0,
  duty: 0,
  erpm: 0,
  gps_accuracy: 0,
  gps_latitude: 0,
  gps_longitude: 0,
  motor_fault: 0,
  pitch: 0,
  requested_amps: 0,
  roll: 0,
  setpoint_atr: 0,
  setpoint_break_tilt: 0,
  setpoint_carve: 0,
  setpoint_remote: 0,
  setpoint_torque_tilt: 0,
  setpoint: 0,
  speed: 0,
  state_raw: 0,
  state: 'STARTUP',
  temp_battery: 0,
  temp_mosfet: 0,
  temp_motor: 0,
  time: 0,
  true_pitch: 0,
  voltage: 0,
  wh_charged: 0,
  wh: 0,
};
