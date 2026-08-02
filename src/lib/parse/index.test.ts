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

  test('rejects unrecognised CSV headers with a parse error', async () => {
    const result = await parse(new MockFile(['foo,bar\n1,2\n'], 'unknown.csv', { type: 'text/csv' }));
    expect(result.source).toBe('none');
    expect(result.data).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/Unrecognised CSV headers/);
  });
});
