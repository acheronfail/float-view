import csv from 'papaparse';
import { floatControlToRowMap, FloatControlRawHeader } from './float-control.types';
import demoCsv from '../../assets/demo.csv?raw';
import { attachIndex, createHeaderTransformer, parseFloatValue } from '../misc';
import { RowKey, State, type Row, type RowWithIndex, Units, DataSource } from './types';
import { ParseError, type ParseResult } from './index';

const transformHeader = createHeaderTransformer(floatControlToRowMap);

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

export function parseFloatControlCsv(input: string | File): Promise<ParseResult> {
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
        const data = attachIndex(results.data);
        resolve({
          source: DataSource.FloatControl,
          data,
          units,
          error:
            results.errors.length > 0
              ? new ParseError('Failed to parse Float Control CSV!', results.errors)
              : undefined,
        });
      },
    });
  });
}

export const demoFile = new File([demoCsv], 'demo.csv');
export const demoRows = attachIndex(csv.parse<RowWithIndex>(demoCsv, parseOptions).data);
