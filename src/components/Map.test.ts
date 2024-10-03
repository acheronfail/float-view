import { describe, expect, test } from 'vitest';
import type { LatLngExpression } from 'leaflet';
import { getBaseLine, getTravelledLine } from './Map';

const lineFixture = (): LatLngExpression[] => [
  [0, 0],
  [1, 1],
  [2, 2],
  [3, 3],
];

describe(getBaseLine.name, () => {
  test('builds the base line', () => {
    const line = getBaseLine(lineFixture(), [{ index: 0, secondsElapsed: 0 }], new Set());
    expect(line.getLatLngs()).toEqual([
      [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
        { lat: 2, lng: 2 },
        { lat: 3, lng: 3 },
      ],
    ]);
  });

  test('builds the base line, with gap', () => {
    const line = getBaseLine(
      lineFixture(),
      [
        { index: 0, secondsElapsed: 0 },
        { index: 2, secondsElapsed: 120 },
      ],

      new Set(),
    );
    expect(line.getLatLngs()).toEqual([
      [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ],
      [
        { lat: 2, lng: 2 },
        { lat: 3, lng: 3 },
      ],
    ]);
  });
});

describe(getTravelledLine.name, () => {
  test('builds the travelled line', () => {
    const line = getTravelledLine(lineFixture(), [{ index: 0, secondsElapsed: 0 }], 2, new Set());
    expect(line.getLatLngs()).toEqual([
      [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ],
    ]);
  });

  test('builds the travelled line, with gap', () => {
    const line = getTravelledLine(
      lineFixture(),
      [
        { index: 0, secondsElapsed: 0 },
        { index: 2, secondsElapsed: 120 },
      ],
      3,
      new Set(),
    );
    expect(line.getLatLngs()).toEqual([
      [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ],
      [{ lat: 2, lng: 2 }],
    ]);
  });
});
