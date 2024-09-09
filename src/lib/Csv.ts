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

const parseOptions = {
  header: true,
  skipEmptyLines: true,
  transformHeader,
  transform,
};

export function parse(input: string | File): Promise<ParseResult<FloatControlRow>> {
  return new Promise((resolve) => {
    csv.parse<FloatControlRow>(input, {
      ...parseOptions,
      complete: (results) => {
        // TODO: is the first GPS value from FloatControl always (0, 0)?
        results.data = results.data.slice(1);
        resolve(results);
      },
    });
  });
}

export const demoFile = new File([demoCsv], 'demo.csv');
export const demoRows = csv.parse<FloatControlRow>(demoCsv, parseOptions).data.slice(1);
