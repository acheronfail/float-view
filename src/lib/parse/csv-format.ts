import csv from 'papaparse';

import { floatControlKeyMap, FloatControlRawHeader } from './float-control.types';
import { RowKey } from './types';

export enum CsvFormat {
  FloatControl = 'float_control',
  Floaty = 'floaty',
  VescTool = 'vesc_tool',
  Unknown = 'unknown',
}

const FLOATY_SIGNATURE = ['timestamp', 'dutyCycle', 'batteryVolts', 'tripDistance'] as const;
const FLOAT_CONTROL_SIGNATURE = [RowKey.Time, RowKey.Speed, RowKey.Duty] as const;
const VESC_TOOL_SIGNATURE = ['ms_today', 'input_voltage', 'duty_cycle'] as const;
const rowKeys = new Set<string>(Object.values(RowKey));

export const cleanCsvHeader = (header: string): string => header.replace(/^\uFEFF/, '').trim();

export function normalizeFloatControlHeader(header: string): string {
  const cleaned = cleanCsvHeader(header);
  if (Object.hasOwn(floatControlKeyMap, cleaned)) {
    return floatControlKeyMap[cleaned as FloatControlRawHeader];
  }

  return cleaned;
}

export const isNormalizedRowKey = (header: string): boolean => rowKeys.has(header);

const containsAll = (headers: Set<string>, signature: readonly string[]): boolean =>
  signature.every((header) => headers.has(header));

export function detectCsvFormat(text: string): CsvFormat {
  const parsed = csv.parse<string[]>(text, {
    preview: 1,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0 || parsed.data.length === 0) {
    return CsvFormat.Unknown;
  }

  const headers = parsed.data[0]!.map((header) => cleanCsvHeader(String(header)));
  const rawHeaders = new Set(headers);
  const normalizedHeaders = new Set(headers.map(normalizeFloatControlHeader));
  const matches = [
    containsAll(rawHeaders, FLOATY_SIGNATURE) && CsvFormat.Floaty,
    containsAll(normalizedHeaders, FLOAT_CONTROL_SIGNATURE) && CsvFormat.FloatControl,
    containsAll(rawHeaders, VESC_TOOL_SIGNATURE) && CsvFormat.VescTool,
  ].filter((format): format is CsvFormat => format !== false);

  return matches.length === 1 ? matches[0]! : CsvFormat.Unknown;
}
