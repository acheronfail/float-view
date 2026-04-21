import { describe, expect, test } from 'vitest';

import fcMetricCsv from './__fixtures__/fc_metric.csv?raw';
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
});
