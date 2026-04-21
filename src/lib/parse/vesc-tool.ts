import csv, { type ParseResult as CsvParseResult } from 'papaparse';

import type { ParseResult } from './index';
import { ParseError } from './errors';
import { attachIndex } from '../misc';
import { DataSource, RowKey, State, stateCodeMap, Units, type Row } from './types';

const headerMap: Record<string, RowKey> = {
  amp_hours_used: RowKey.Ah,
  current_in: RowKey.CurrentBattery,
  current_motor: RowKey.CurrentMotor,
  duty_cycle: RowKey.Duty,
  erpm: RowKey.Erpm,
  fault_code: RowKey.StateRaw,
  gnss_alt: RowKey.Altitude,
  gnss_hAcc: RowKey.GpsAccuracy,
  gnss_lat: RowKey.GpsLatitude,
  gnss_lon: RowKey.GpsLongitude,
  input_voltage: RowKey.Voltage,
  ms_today: RowKey.Time,
  pitch: RowKey.Pitch,
  roll: RowKey.Roll,
  speed_meters_per_sec: RowKey.Speed,
  tacho_meters: RowKey.Distance,
  temp_mos_max: RowKey.TempMosfet,
  temp_motor: RowKey.TempMotor,
  watt_hours_used: RowKey.Wh,
};

const parseFloatValue = (input: string): number => {
  const trimmed = input.trim();
  if (trimmed === '') return 0;

  const float = parseFloat(trimmed);
  if (Number.isNaN(float)) {
    console.warn(`Failed to parse VESC Tool CSV! Expected a number, but got: '${input}'`);
    return 0;
  }

  return float;
};

const transformHeader = (header: string): string => {
  const trimmed = header.trim();
  return headerMap[trimmed] ?? trimmed;
};

const transform = <C extends RowKey>(value: string, column: C): Row[C] => {
  const parsed = parseFloatValue(value);

  switch (column) {
    case RowKey.Duty:
      // VESC Tool logs duty cycle as a fraction (0..1), while the app expects percent.
      return (parsed * 100) as Row[C];
    case RowKey.Speed:
      // VESC Tool speed is meters per second, convert to km/h for metric parity.
      return (parsed * 3.6) as Row[C];
    case RowKey.Distance:
      // VESC Tool tacho distance is in meters, convert to kilometers.
      return (parsed / 1000) as Row[C];
    case RowKey.Time:
      // VESC Tool timestamp is milliseconds.
      return (parsed / 1000) as Row[C];
    default:
      return parsed as Row[C];
  }
};

function normalizeRow(row: Partial<Row>): Row {
  const stateRaw = row.state_raw ?? 0;
  const state = stateRaw === 0 ? State.Riding : (stateCodeMap[stateRaw] ?? `fault ${stateRaw}`);

  return {
    [RowKey.Adc1]: row.adc1 ?? 0,
    [RowKey.Adc2]: row.adc2 ?? 0,
    [RowKey.Ah]: row.ah ?? 0,
    [RowKey.Altitude]: row.altitude ?? 0,
    [RowKey.CurrentBattery]: row.current_battery ?? 0,
    [RowKey.CurrentMotor]: row.current_motor ?? 0,
    [RowKey.Distance]: row.distance ?? 0,
    [RowKey.Duty]: row.duty ?? 0,
    [RowKey.Erpm]: row.erpm,
    [RowKey.GpsAccuracy]: row.gps_accuracy ?? 0,
    [RowKey.GpsLatitude]: row.gps_latitude ?? 0,
    [RowKey.GpsLongitude]: row.gps_longitude ?? 0,
    [RowKey.MotorFault]: row.motor_fault ?? stateRaw,
    [RowKey.Pitch]: row.pitch ?? 0,
    [RowKey.Roll]: row.roll ?? 0,
    [RowKey.Speed]: row.speed ?? 0,
    [RowKey.State]: state,
    [RowKey.StateRaw]: stateRaw,
    [RowKey.TempMosfet]: row.temp_mosfet ?? 0,
    [RowKey.TempMotor]: row.temp_motor ?? 0,
    [RowKey.Time]: row.time ?? 0,
    [RowKey.TruePitch]: row.true_pitch ?? row.pitch ?? 0,
    [RowKey.Voltage]: row.voltage ?? 0,
    [RowKey.Wh]: row.wh ?? 0,
  };
}

export async function parseVescToolCsv(input: string | File): Promise<ParseResult> {
  try {
    const text = typeof input === 'string' ? input : await input.text();

    return await new Promise((resolve) => {
      csv.parse<Row>(text, {
        delimiter: ';',
        header: true,
        skipEmptyLines: true,
        transformHeader,
        transform,
        complete: (results: CsvParseResult<Row>) => {
          const rows = results.data.map((row) => normalizeRow(row));

          const startTime = rows[0]?.time ?? 0;
          for (const row of rows) {
            row.time -= startTime;
          }

          const errors: Error[] = [];
          if (results.errors.length > 0) {
            errors.push(new ParseError('Failed to parse VESC Tool CSV properly!', results.errors));
          }

          resolve({
            source: DataSource.VescTool,
            data: attachIndex(rows),
            units: Units.Metric,
            errors,
          });
        },
      });
    });
  } catch (error) {
    return {
      source: DataSource.VescTool,
      data: [],
      units: Units.Metric,
      errors: [new ParseError('Failed to parse VESC Tool CSV!', error)],
    };
  }
}
