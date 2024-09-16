import { parseFloatControlCsv } from './float-control';
import { parseFloatyJson } from './floaty';
import { Units, type RowWithIndex } from './types';

export class ParseError extends Error {
  constructor(
    public readonly message: string,
    public readonly cause: unknown,
  ) {
    super(message);
  }
}

export interface ParseResult {
  data: RowWithIndex[];
  units: Units;
  error?: Error;
}

export enum SupportedMimeTypes {
  Csv = 'text/csv',
  Json = 'application/json',
}

export const supportedMimeTypes = Object.values(SupportedMimeTypes).join(',');

export async function parse(file: File): Promise<ParseResult> {
  const lowerName = file.name.toLowerCase();
  if (file.type === 'text/csv' || lowerName.endsWith('.csv')) {
    const parsed = await parseFloatControlCsv(file);
    return {
      data: parsed.csv.data,
      units: parsed.units,
      error:
        parsed.csv.errors.length > 0
          ? new ParseError('Failed to parse Float Control CSV properly!', parsed.csv.errors)
          : undefined,
    };
  }

  if (file.type === 'application/json' || lowerName.endsWith('.json')) {
    return await parseFloatyJson(file);
  }

  return {
    data: [],
    units: Units.Metric,
    error: new ParseError('Unrecognised file!', file),
  };
}
