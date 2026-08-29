import csv from 'papaparse';

import { type ParseResult } from './index';
import { attachIndex } from '../misc';
import { FloatyJsonSchema, type ZFloatyJson, type ZLocation, type ZLog } from './floaty.types';
import { DataSource, stateCodeMap, Units, type Row } from './types';
import { ParseError } from './errors';

/** Headers that uniquely identify a Floaty CSV export (vs Float Control / VESC Tool). */
const FLOATY_CSV_MARKERS = ['dutyCycle', 'batteryVolts', 'tripDistance'] as const;

export function looksLikeFloatyCsv(headerLine: string): boolean {
  const headers = new Set(headerLine.split(',').map((header) => header.trim()));
  return FLOATY_CSV_MARKERS.every((marker) => headers.has(marker));
}

/**
 * NOTE: sometimes Floaty doesn't record values, and seems to just put `null` (or 0) in its logs.
 * When it does, we backtrack until we find the last known value for it.
 */
function findValue(logs: ZLog[], index: number, key: keyof ZLog, floatyEmptyValue?: unknown): number {
  const current = logs[index]![key];
  if (current !== null && (floatyEmptyValue === undefined || current !== floatyEmptyValue)) {
    return current as number;
  }

  let i = index - 1;
  while (i >= 0) {
    const value = logs[i]![key];
    if (value !== null && (floatyEmptyValue === undefined || value !== floatyEmptyValue)) {
      return value as number;
    }

    i--;
  }

  return 0;
}

function mapFloatyLog(logs: ZLog[], location: ZLocation, index: number, startTime: number): Row {
  const log = logs[index]!;
  const state_raw = findValue(logs, index, 'state');
  return {
    adc1: findValue(logs, index, 'adc1'),
    adc2: findValue(logs, index, 'adc2'),
    ah: findValue(logs, index, 'ampHours'),
    altitude: location.altitude,
    current_battery: findValue(logs, index, 'batteryCurrent'),
    current_motor: findValue(logs, index, 'motorCurrent'),
    distance: findValue(logs, index, 'tripDistance', 0),
    duty: findValue(logs, index, 'dutyCycle') * 100,
    gps_accuracy: location.accuracy,
    gps_latitude: location.latitude,
    gps_longitude: location.longitude,
    motor_fault: findValue(logs, index, 'faultCode'),
    pitch: findValue(logs, index, 'pitchAngle'),
    roll: findValue(logs, index, 'rollAngle'),
    speed: findValue(logs, index, 'speed'),
    state_raw,
    state: stateCodeMap[state_raw] ?? '??',
    temp_mosfet: findValue(logs, index, 'controllerTemp', 0),
    temp_motor: findValue(logs, index, 'motorTemp', 0),
    time: (log.timestamp - startTime) / 1000,
    true_pitch: findValue(logs, index, 'truePitchAngle'),
    voltage: findValue(logs, index, 'batteryVolts'),
    wh: findValue(logs, index, 'wattHours'),
  };
}

function rowsFromFloatyJson(json: ZFloatyJson): Row[] {
  const rows: Row[] = [];
  const { logs, locations } = json;
  let locationIdx = 0;
  for (let i = 0; i < logs.length; ++i) {
    const log = logs[i]!;
    let location = locations[locationIdx]!;
    if (location.timestamp < log.timestamp && locations[locationIdx + 1]) {
      location = locations[++locationIdx]!;
    }

    rows.push(mapFloatyLog(logs, location, i, json.startTime));
  }

  return rows;
}

const optionalNumber = (value: string | undefined): number | null => {
  if (value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const requiredNumber = (value: string | undefined, fallback = 0): number => {
  const parsed = optionalNumber(value);
  return parsed === null ? fallback : parsed;
};

type FloatyCsvRow = Record<string, string>;

function csvRowToLog(row: FloatyCsvRow): ZLog {
  return {
    adc1: optionalNumber(row.adc1),
    adc2: optionalNumber(row.adc2),
    ampHours: optionalNumber(row.ampHours),
    batteryCurrent: optionalNumber(row.batteryCurrent),
    batteryPercent: optionalNumber(row.batteryPercent),
    batteryVolts: optionalNumber(row.batteryVolts),
    controllerTemp: optionalNumber(row.controllerTemp),
    dutyCycle: optionalNumber(row.dutyCycle),
    faultCode: optionalNumber(row.faultCode),
    inputTilt: optionalNumber(row.inputTilt),
    lifeDistance: optionalNumber(row.lifeDistance),
    motorCurrent: optionalNumber(row.motorCurrent),
    motorTemp: optionalNumber(row.motorTemp),
    pitchAngle: optionalNumber(row.pitchAngle),
    remainingDistance: optionalNumber(row.remainingDistance),
    rollAngle: optionalNumber(row.rollAngle),
    setpointAdjustmentType: optionalNumber(row.setpointAdjustmentType),
    speed: optionalNumber(row.speed),
    state: optionalNumber(row.state),
    switchState: optionalNumber(row.switchState),
    throttle: optionalNumber(row.throttle),
    timestamp: requiredNumber(row.timestamp),
    tripDistance: optionalNumber(row.tripDistance),
    truePitchAngle: optionalNumber(row.truePitchAngle),
    wattHours: optionalNumber(row.wattHours),
  };
}

function csvRowToLocation(row: FloatyCsvRow): ZLocation {
  return {
    timestamp: requiredNumber(row.gpsTimestamp ?? row.timestamp),
    altitude: requiredNumber(row.altitude),
    latitude: requiredNumber(row.latitude),
    longitude: requiredNumber(row.longitude),
    accuracy: requiredNumber(row.accuracy),
    speed: requiredNumber(row.gpsSpeed),
  };
}

function rowsFromFloatyCsv(rawRows: FloatyCsvRow[]): Row[] {
  const logs = rawRows.map(csvRowToLog);
  const startTime = logs[0]?.timestamp ?? 0;
  return rawRows.map((raw, index) => mapFloatyLog(logs, csvRowToLocation(raw), index, startTime));
}

export async function parseFloatyCsv(input: string | File): Promise<ParseResult> {
  const text = typeof input === 'string' ? input : await input.text();

  return new Promise((resolve) => {
    csv.parse<FloatyCsvRow>(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          if (results.data.length === 0) {
            resolve({
              source: DataSource.Floaty,
              data: [],
              units: Units.Metric,
              errors: [new ParseError('Floaty CSV contained no rows!', results.errors)],
            });
            return;
          }

          resolve({
            source: DataSource.Floaty,
            data: attachIndex(rowsFromFloatyCsv(results.data)),
            units: Units.Metric,
            errors: results.errors.length
              ? [new ParseError('Failed to parse Floaty CSV properly!', results.errors)]
              : [],
          });
        } catch (error) {
          resolve({
            source: DataSource.Floaty,
            data: [],
            units: Units.Metric,
            errors: [new ParseError('Failed to parse Floaty CSV!', error)],
          });
        }
      },
      error: (error: Error) => {
        resolve({
          source: DataSource.Floaty,
          data: [],
          units: Units.Metric,
          errors: [new ParseError('Failed to parse Floaty CSV!', error)],
        });
      },
    });
  });
}

export async function parseFloatyJson(input: string | File): Promise<ParseResult> {
  try {
    const json = JSON.parse(typeof input === 'string' ? input : await input.text());
    const data = FloatyJsonSchema.parse(json);
    return {
      source: DataSource.Floaty,
      data: attachIndex(rowsFromFloatyJson(data)),
      units: Units.Metric,
      errors: [],
    };
  } catch (error) {
    return {
      source: DataSource.Floaty,
      data: [],
      units: Units.Metric,
      errors: [new ParseError('Failed to parse Floaty JSON!', error)],
    };
  }
}
