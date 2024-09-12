import csv, { type ParseResult } from 'papaparse';
import {
  FloatControlHeader,
  floatControlKeyMap,
  FloatControlRawHeader,
  State,
  type FloatControlRow,
} from './FloatControlTypes';
import demoCsv from '../assets/demo.csv?raw';

export interface FloatControlRowWithIndex extends FloatControlRow {
  index: number;
}

function map(rows: FloatControlRow[]): FloatControlRowWithIndex[] {
  return rows.map((row, index) => {
    (row as FloatControlRowWithIndex).index = index;
    return row as FloatControlRowWithIndex;
  });
}

const transformHeader = (header: string) => {
  const key = floatControlKeyMap[header as FloatControlRawHeader];
  if (!key) console.warn('Unknown header found in CSV file', { header });
  return key ?? header;
};

const transform = <C extends FloatControlHeader>(value: string, column: C): FloatControlRow[C] => {
  switch (column) {
    case FloatControlHeader.Duty:
      return parseFloat(value.replace(/%/g, '')) as FloatControlRow[C];
    case FloatControlHeader.State:
      const lower = value.toLowerCase();
      switch (lower) {
        case 'startup':
          return State.Startup as FloatControlRow[C];
        case 'stop half':
          return State.StopHalf as FloatControlRow[C];
        case 'stop full':
          return State.StopFull as FloatControlRow[C];
        case 'stop angle':
          return State.StopAngle as FloatControlRow[C];
        case 'wheelslip':
          return State.Wheelslip as FloatControlRow[C];
        case 'quickstop':
          return State.Quickstop as FloatControlRow[C];
        default:
          console.warn(`Unknown state: '${value}'`);
        case 'riding':
          return lower as FloatControlRow[C];
      }
    default:
      return parseFloat(value) as FloatControlRow[C];
  }
};

const parseOptions = {
  header: true,
  skipEmptyLines: true,
  transformHeader,
  transform,
};

export type Units = 'imperial' | 'metric';
export interface FloatControlData {
  csv: ParseResult<FloatControlRowWithIndex>;
  units: Units;
}

export function parse(input: string | File): Promise<FloatControlData> {
  let units: Units = 'imperial';
  return new Promise((resolve) => {
    csv.parse<FloatControlRow>(input, {
      ...parseOptions,
      transformHeader: (header: string) => {
        if (header === FloatControlRawHeader.SpeedKm || header === FloatControlRawHeader.DistanceKm) {
          units = 'metric';
        }

        return transformHeader(header);
      },
      complete: (results) => {
        results.data = map(results.data);
        resolve({
          csv: results as ParseResult<FloatControlRowWithIndex>,
          units,
        });
      },
    });
  });
}

export const demoFile = new File([demoCsv], 'demo.csv');
export const demoRows = map(csv.parse<FloatControlRowWithIndex>(demoCsv, parseOptions).data);
