import { describe, expect, test } from 'vitest';

import fcMetricCsv from './__fixtures__/fc_metric.csv?raw';
import floatyCsv from './__fixtures__/floaty.csv?raw';
import vescMetricCsv from './__fixtures__/vesc_metric.csv?raw';
import { parse } from './index';

class MockFile extends File {
  constructor(
    private fileParts: BlobPart[],
    fileName: string,
    options?: FilePropertyBag,
  ) {
    super(fileParts, fileName, options);
  }

  async text() {
    return this.fileParts.map((part) => part.toString()).join('');
  }
}

describe(parse.name, () => {
  test('routes semicolon-delimited CSV to VESC Tool parser', async () => {
    const result = await parse(new MockFile([vescMetricCsv], 'vesc.csv', { type: 'text/csv' }));
    expect(result.source).toBe('vesc_tool');
  });

  test('routes comma-delimited CSV to Float Control parser', async () => {
    const result = await parse(new MockFile([fcMetricCsv], 'fc.csv', { type: 'text/csv' }));
    expect(result.source).toBe('float_control');
  });

  test('routes Floaty CSV to Floaty parser', async () => {
    const result = await parse(new MockFile([floatyCsv], 'floaty.csv', { type: 'text/csv' }));
    expect(result.source).toBe('floaty');
    expect(result.errors).toEqual([]);
    expect(result.data).toHaveLength(3);
  });

  test('routes normalized Float Control headers to the Float Control parser', async () => {
    const normalizedCsv = 'time,state,distance,speed,duty\n0,riding,0,1,2\n';
    const result = await parse(new MockFile([normalizedCsv], 'normalized.csv', { type: 'text/csv' }));
    expect(result.source).toBe('float_control');
    expect(result.data).toHaveLength(1);
  });

  test('handles quoted Floaty headers with a byte-order mark', async () => {
    const quotedFloatyCsv = `\uFEFF"timestamp","speed","dutyCycle","batteryVolts","tripDistance"\n1000,1,0.1,80,1\n`;
    const result = await parse(new MockFile([quotedFloatyCsv], 'quoted-floaty.csv', { type: 'text/csv' }));
    expect(result.source).toBe('floaty');
    expect(result.errors).toEqual([]);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ time: 0, speed: 1, duty: 10, voltage: 80, distance: 1 });
  });

  test('does not classify a CSV from one coincidentally matching header', async () => {
    const result = await parse(new MockFile(['State,foo\nriding,1\n'], 'coincidental.csv', { type: 'text/csv' }));
    expect(result.source).toBe('none');
    expect(result.data).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  test('rejects unrecognised semicolon-delimited CSV headers', async () => {
    const result = await parse(new MockFile(['foo;bar\n1;2\n'], 'unknown.csv', { type: 'text/csv' }));
    expect(result.source).toBe('none');
    expect(result.data).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  test('rejects headers that ambiguously match multiple formats', async () => {
    const ambiguousCsv =
      'timestamp,dutyCycle,batteryVolts,tripDistance,ms_today,input_voltage,duty_cycle\n1,0.1,80,1,1,80,0.1\n';
    const result = await parse(new MockFile([ambiguousCsv], 'ambiguous.csv', { type: 'text/csv' }));
    expect(result.source).toBe('none');
    expect(result.data).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  test('rejects unrecognised CSV headers with a parse error', async () => {
    const result = await parse(new MockFile(['foo,bar\n1,2\n'], 'unknown.csv', { type: 'text/csv' }));
    expect(result.source).toBe('none');
    expect(result.data).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/Unrecognised CSV headers/);
  });
});
