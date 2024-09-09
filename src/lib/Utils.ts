export function assert(value: boolean, message: string) {
  if (!value) {
    throw new Error(`Failed assertion: ${message}`);
  }
}

export function filterMap<T, U>(arr: T[], fn: (t: T, i: number) => U | null): U[] {
  const result: U[] = [];
  for (let i = 0; i < arr.length; i++) {
    const mapped = fn(arr[i], i);
    if (mapped !== null) {
      result.push(mapped);
    }
  }

  return result;
}
