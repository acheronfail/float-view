import csv, { type ParseResult } from 'papaparse';
import { floatControlKeyMap, FloatControlRawHeader } from './float-control.types';
import demoCsv from '../../assets/demo.csv?raw';
import { attachIndex } from '../misc';
import { RowKey, State, type Row, type RowWithIndex, Units } from './types';
import { FloatControlLimitedError, ParseError } from './errors';

export function looksLikeFloatControlCsv(headerLine: string): boolean {
  return headerLine
    .split(',')
    .map((header) => header.trim())
    .some((header) => header in floatControlKeyMap);
}

const transformHeader = (header: string) => {
  const key = floatControlKeyMap[header as FloatControlRawHeader];
  if (!key && !Object.values(RowKey).includes(header as RowKey)) {
    console.warn('Unknown header found in CSV file', { header });
  }

  return key ?? header;
};

const parseFloatValue = (input: string): number => {
  const float = parseFloat(input);
  if (Number.isNaN(float)) {
    console.warn(`Failed to parse CSV! Expected a number, but got: '${input}'`);
    return 0;
  }

  return float;
};

const transform = <C extends RowKey>(value: string, column: C): Row[C] => {
  switch (column) {
    case RowKey.State:
      const lower = value.toLowerCase();
      switch (lower) {
        case 'startup':
          return State.Startup as Row[C];
        case 'stop half':
          return State.StopHalf as Row[C];
        case 'stop full':
          return State.StopFull as Row[C];
        case 'stop angle':
          return State.StopAngle as Row[C];
        case 'wheelslip':
          return State.Wheelslip as Row[C];
        case 'quickstop':
          return State.Quickstop as Row[C];
        default:
          console.warn(`Unknown state: '${value}'`);
        case 'riding':
          return lower as Row[C];
      }
    case RowKey.Duty:
      return parseFloatValue(value.replace('%', '')) as Row[C];
    default:
      return parseFloatValue(value) as Row[C];
  }
};

const parseOptions = {
  header: true,
  skipEmptyLines: true,
  transformHeader,
  transform,
};

export interface FloatControlData {
  csv: ParseResult<RowWithIndex>;
  units: Units;
  errors: Error[];
}

export async function parseFloatControlCsv(input: string | File): Promise<FloatControlData> {
  let errors: Error[] = [];

  // Detect if the ride has been trimmed due to Float Control's recent update which requires payment for full ride logs.
  let text = typeof input === 'string' ? input : await input.text();
  const lastLineStart = text.trimEnd().lastIndexOf('\n');
  const lastLine = text.slice(lastLineStart);
  if (/upgrade/i.test(lastLine)) {
    text = text.slice(0, lastLineStart);
    errors.push(new FloatControlLimitedError());
  }

  let units = Units.Imperial;
  return new Promise((resolve) => {
    csv.parse<Row>(text, {
      ...parseOptions,
      transformHeader: (header: string) => {
        if (header === FloatControlRawHeader.SpeedKm || header === FloatControlRawHeader.DistanceKm) {
          units = Units.Metric;
        }

        return transformHeader(header);
      },

      complete: (results) => {
        results.data = attachIndex(results.data);

        if (results.errors.length > 0) {
          errors.push(new ParseError('Failed to parse Float Control CSV properly!', results.errors));
        }

        resolve({
          csv: results as ParseResult<RowWithIndex>,
          units,
          errors,
        });
      },
    });
  });
}

export const demoFile = new File([demoCsv], 'demo.csv');
export const demoRows = attachIndex(csv.parse<RowWithIndex>(demoCsv, parseOptions).data);
export const demoRow: RowWithIndex = {
  index: 0,
  [RowKey.Adc1]: 0.02,
  [RowKey.Adc2]: 3.08,
  [RowKey.Ah]: 20,
  [RowKey.Altitude]: 42,
  [RowKey.CurrentBattery]: -10.2,
  [RowKey.CurrentMotor]: 21.3,
  [RowKey.Distance]: 4.5,
  [RowKey.Duty]: 65,
  [RowKey.GpsAccuracy]: 0,
  [RowKey.GpsLatitude]: 0,
  [RowKey.GpsLongitude]: 0,
  [RowKey.MotorFault]: 0,
  [RowKey.Pitch]: 5,
  [RowKey.Setpoint]: 6,
  [RowKey.SetpointRemote]: 8,
  [RowKey.Roll]: 4,
  [RowKey.Speed]: -25.24,
  [RowKey.State]: State.Riding,
  [RowKey.StateRaw]: 0,
  [RowKey.TempMosfet]: 38.3,
  [RowKey.TempMotor]: 33.5,
  [RowKey.Time]: 120.5,
  [RowKey.TruePitch]: 3.5,
  [RowKey.Voltage]: 82,
  [RowKey.Wh]: 0,
};
