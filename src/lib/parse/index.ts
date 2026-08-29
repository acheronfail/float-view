import * as fflate from 'fflate';

import { parseFloatControlCsv } from './float-control';
import { parseFloatyCsv, parseFloatyJson } from './floaty';
import { parseVescToolCsv } from './vesc-tool';
import { DataSource, Units, type RowWithIndex } from './types';
import { ParseError } from './errors';
import { CsvFormat, detectCsvFormat } from './csv-format';

export interface ParseResult {
  data: RowWithIndex[];
  units: Units;
  source: DataSource;
  errors: Error[];
}

export enum SupportedMimeTypes {
  /** Float Control's CSV */
  Csv = 'text/csv',
  /** Float Control's Zipped CSV */
  Zip1 = 'application/zip',
  Zip2 = 'application/x-zip-compressed',
  /** Floaty's JSON */
  Json = 'application/json',
}

export const supportedMimeTypes = Object.values<string>(SupportedMimeTypes);
export const supportedMimeTypeString = supportedMimeTypes.join(',');

export async function parse(file: File): Promise<ParseResult> {
  const lowerName = file.name.toLowerCase();
  if (file.type === SupportedMimeTypes.Zip1 || file.type === SupportedMimeTypes.Zip2 || lowerName.endsWith('.zip')) {
    const fileMap = fflate.unzipSync(new Uint8Array(await file.arrayBuffer()));
    const fileList = Object.keys(fileMap);
    if (fileList.length !== 1) {
      return {
        source: DataSource.None,
        data: [],
        units: Units.Metric,
        errors: [new ParseError('Expected a zip containing a single CSV file from Float Control!', file)],
      };
    }

    const unzippedBytes = fileMap[fileList[0]!]!;
    const parsed = await parseFloatControlCsv(new TextDecoder().decode(unzippedBytes));
    return {
      source: DataSource.FloatControl,
      data: parsed.csv.data,
      units: parsed.units,
      errors: parsed.errors,
    };
  }

  if (file.type === SupportedMimeTypes.Csv || lowerName.endsWith('.csv')) {
    const text = await file.text();
    switch (detectCsvFormat(text)) {
      case CsvFormat.Floaty:
        return await parseFloatyCsv(text);
      case CsvFormat.FloatControl: {
        const parsed = await parseFloatControlCsv(text);
        return {
          source: DataSource.FloatControl,
          data: parsed.csv.data,
          units: parsed.units,
          errors: parsed.errors,
        };
      }
      case CsvFormat.VescTool:
        return await parseVescToolCsv(text);
    }

    return {
      source: DataSource.None,
      data: [],
      units: Units.Metric,
      errors: [
        new ParseError('Unrecognised CSV headers. Expected a Float Control, Floaty, or VESC Tool export.', {
          header: text.split(/\r?\n/, 1)[0] ?? '',
        }),
      ],
    };
  }

  if (file.type === SupportedMimeTypes.Json || lowerName.endsWith('.json')) {
    return await parseFloatyJson(file);
  }

  return {
    source: DataSource.None,
    data: [],
    units: Units.Metric,
    errors: [new ParseError('Unrecognised file!', file)],
  };
}
