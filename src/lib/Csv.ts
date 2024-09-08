import csv, { type ParseResult } from 'papaparse';
import {
  FloatControlHeader,
  floatControlKeyMap,
  FloatControlRawHeader,
  type FloatControlRow,
} from './FloatControlTypes';
import demoCsv from '../assets/demo.csv?raw';

const transformHeader = (header: string) => floatControlKeyMap[header as FloatControlRawHeader];
const transform = <C extends FloatControlHeader>(value: string, column: C): FloatControlRow[C] => {
  switch (column) {
    case FloatControlHeader.Duty:
      return parseFloat(value.replace(/%/g, '')) as FloatControlRow[C];
    case FloatControlHeader.State:
      return value as FloatControlRow[C];
    default:
      return parseFloat(value) as FloatControlRow[C];
  }
};

export function parse(input: string | File): Promise<ParseResult<FloatControlRow>> {
  return new Promise((resolve) => {
    csv.parse<FloatControlRow>(input, {
      complete: (results) => resolve(results),
      header: true,
      skipEmptyLines: true,
      transformHeader,
      transform,
    });
  });
}

export function demoData(): FloatControlRow[] {
  return csv
    .parse<FloatControlRow>(demoCsv, {
      header: true,
      skipEmptyLines: true,
      transformHeader,
      transform,
    })
    .data.slice(1);
}
