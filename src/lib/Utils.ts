export function assert(value: boolean, message: string) {
  if (!value) {
    throw new Error(`Failed assertion: ${message}`);
  }
}
