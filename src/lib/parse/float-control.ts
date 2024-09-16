import csv, { type ParseResult } from 'papaparse';
import { floatControlKeyMap, FloatControlRawHeader } from './float-control.types';
import demoCsv from '../../assets/demo.csv?raw';
import { attachIndex } from '../misc';
import { RowKey, State, type Row, type RowWithIndex, Units } from './types';

const transformHeader = (header: string) => {
  const key = floatControlKeyMap[header as FloatControlRawHeader];
  if (!key) console.warn('Unknown header found in CSV file', { header });
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
}

export function parseFloatControlCsv(input: string | File): Promise<FloatControlData> {
  let units = Units.Imperial;
  return new Promise((resolve) => {
    csv.parse<Row>(input, {
      ...parseOptions,
      transformHeader: (header: string) => {
        if (header === FloatControlRawHeader.SpeedKm || header === FloatControlRawHeader.DistanceKm) {
          units = Units.Metric;
        }

        return transformHeader(header);
      },
      complete: (results) => {
        results.data = attachIndex(results.data);
        resolve({
          csv: results as ParseResult<RowWithIndex>,
          units,
        });
      },
    });
  });
}

export const demoFile = new File([demoCsv], 'demo.csv');
export const demoRows = attachIndex(csv.parse<RowWithIndex>(demoCsv, parseOptions).data);
