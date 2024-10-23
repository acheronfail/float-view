import { Units } from './parse/types';

export function assert(value: boolean, message: string) {
  if (!value) {
    throw new Error(`Failed assertion: ${message}`);
  }
}

export function attachIndex<T>(rows: T[]): (T & { index: number })[] {
  return rows.map((t, index) => {
    (t as T & { index: number }).index = index;
    return t as T & { index: number };
  });
}

export const kmToMi = (km: number): number => km / 1.609344;
export const miToKm = (mi: number): number => mi * 1.609344;
export const speedMapper = (inUnit: Units, outUnit: Units): ((input: number) => number) => {
  if (inUnit === outUnit) return (x) => x;
  if (outUnit === Units.Imperial) return kmToMi;
  return miToKm;
};

export const formatFloat = (n: number | undefined, allowInt = false) => {
  if (typeof n !== 'number' || Number.isNaN(n)) return '??';
  if (allowInt && Number.isInteger(n)) return n.toString();
  return n.toFixed(1);
};

const loggedHeaders = new Set<string>();
export const createHeaderTransformer = (mapper: Record<string, string | undefined>) => (header: string) => {
  const key = mapper[header];
  if (key === undefined && !loggedHeaders.has(header)) {
    console.warn('Unknown header found in CSV file', { header });
    loggedHeaders.add(header);
  }

  return key ?? header;
};

export const parseFloatValue = (input: string): number => {
  const float = parseFloat(input);
  if (Number.isNaN(float)) {
    console.warn(`Failed to parse CSV! Expected a number, but got: '${input}'`);
    return 0;
  }

  return float;
};