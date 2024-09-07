import csv, { type ParseResult } from 'papaparse';
import {
  FloatControlHeader,
  floatControlKeyMap,
  FloatControlRawHeader,
  type FloatControlRow,
} from './FloatControlTypes';

export function parse(input: string | File): Promise<ParseResult<FloatControlRow>> {
  return new Promise((resolve) => {
    csv.parse<FloatControlRow>(input, {
      complete: (results) => resolve(results),
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => floatControlKeyMap[header as FloatControlRawHeader],
      transform: <C extends FloatControlHeader>(value: string, column: C): FloatControlRow[C] => {
        switch (column) {
          case FloatControlHeader.Duty:
            return parseFloat(value.replace(/%/g, '')) as FloatControlRow[C];
          case FloatControlHeader.State:
            return value as FloatControlRow[C];
          default:
            return parseFloat(value) as FloatControlRow[C];
        }
      },
    });
  });
}
