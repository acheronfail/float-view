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
