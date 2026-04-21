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
  if (allowInt && Number.isInteger(n)) return formatInt(n);
  return n.toFixed(1);
};

export const formatInt = (n: number | undefined, allowInt = false) => {
  if (typeof n !== 'number' || Number.isNaN(n)) return '??';
  return n.toString();
};

// formats seconds into "[__h] [__m] __s"
export const formatTime = (seconds: number) => {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return '??';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h > 0 ? `${h}h ` : ''}${m > 0 ? `${m}m ` : ''}${s}s`;
};
