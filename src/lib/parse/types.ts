export enum DataSource {
  None = 'none',
  FloatControl = 'float_control',
  Floaty = 'floaty',
  VescTool = 'vesc_tool',
}

export enum Units {
  Metric = 'metric',
  Imperial = 'imperial',
}

/**
 * This enum is a merged map of faults reported by VESC Tool, some custom footpad
 * faults created by us, as well as some other points of interest.
 */
export enum State {
  Riding = 'riding',
  Startup = 'startup',
  Quickstop = 'quickstop',
  StopHalf = 'stop half',
  StopFull = 'stop full',
  StopAngle = 'stop angle',
  Wheelslip = 'wheelslip',
  Custom_OneFootpadAtSpeed = 'custom: one footpad at speed',
  Custom_NoFootpadsAtSpeed = 'custom: no footpads at speed',
  Custom_ChargePoint = 'custom: charge point',
}

export const stateCodeMap: Record<number, State> = {
  1: State.Riding,
  3: State.Wheelslip,
  7: State.StopAngle,
  8: State.StopHalf,
  9: State.StopFull,
  11: State.Startup,
  13: State.Quickstop,
};

export const empty: RowWithIndex = {
  index: -1,
  adc1: 0,
  adc2: 0,
  ah: 0,
  altitude: 0,
  current_battery: 0,
  current_motor: 0,
  distance: 0,
  duty: 0,
  gps_accuracy: 0,
  gps_latitude: 0,
  gps_longitude: 0,
  motor_fault: 0,
  pitch: 0,
  roll: 0,
  speed: 0,
  state_raw: 0,
  state: 'STARTUP',
  temp_mosfet: 0,
  temp_motor: 0,
  time: 0,
  true_pitch: 0,
  voltage: 0,
  wh: 0,
};

// TODO: make keyof
export enum RowKey {
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

export interface Row {
  [RowKey.Adc1]: number;
  [RowKey.Adc2]: number;
  [RowKey.Ah]: number;
  [RowKey.AhCharged]?: number;
  [RowKey.Altitude]: number;
  [RowKey.BmsFault]?: number;
  [RowKey.BmsTemp]?: number;
  [RowKey.BmsTempBattery]?: number;
  [RowKey.CurrentBattery]: number;
  [RowKey.CurrentBooster]?: number;
  [RowKey.CurrentFieldWeakening]?: number;
  [RowKey.CurrentMotor]: number;
  [RowKey.Distance]: number;
  [RowKey.Duty]: number;
  [RowKey.Erpm]?: number;
  [RowKey.GpsAccuracy]: number;
  [RowKey.GpsLatitude]: number;
  [RowKey.GpsLongitude]: number;
  [RowKey.MotorFault]: number;
  [RowKey.Pitch]: number;
  [RowKey.RequestedAmps]?: number;
  [RowKey.Roll]: number;
  [RowKey.Setpoint]?: number;
  [RowKey.SetpointAtr]?: number;
  [RowKey.SetpointBreakTilt]?: number;
  [RowKey.SetpointCarve]?: number;
  [RowKey.SetpointRemote]?: number;
  [RowKey.SetpointTorqueTilt]?: number;
  [RowKey.Speed]: number;
  [RowKey.State]: string;
  [RowKey.StateRaw]: number;
  [RowKey.TempBattery]?: number;
  [RowKey.TempMosfet]: number;
  [RowKey.TempMotor]: number;
  [RowKey.Time]: number;
  [RowKey.TruePitch]: number;
  [RowKey.Voltage]: number;
  [RowKey.Wh]: number;
  [RowKey.WhCharged]?: number;
}

export interface RowWithIndex extends Row {
  index: number;
}
