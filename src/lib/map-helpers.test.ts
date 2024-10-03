import { describe, expect, test } from 'vitest';
import { getPolyline, MapLine } from './map-helpers';
import type { LatLngExpression } from 'leaflet';

const lineFixture = (): LatLngExpression[] => [
  [0, 0],
  [1, 1],
  [2, 2],
  [3, 3],
];

describe(getPolyline.name, () => {
  test('builds the base line', () => {
    const line = getPolyline(lineFixture(), [{ index: 0, secondsElapsed: 0 }], 2, MapLine.Base);
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
    const line = getPolyline(
      lineFixture(),
      [
        { index: 0, secondsElapsed: 0 },
        { index: 2, secondsElapsed: 120 },
      ],
      3,
      MapLine.Base,
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

  test('builds the travelled line', () => {
    const line = getPolyline(lineFixture(), [{ index: 0, secondsElapsed: 0 }], 2, MapLine.Travelled);
    expect(line.getLatLngs()).toEqual([
      [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ],
    ]);
  });

  test('builds the travelled line, with gap', () => {
    const line = getPolyline(
      lineFixture(),
      [
        { index: 0, secondsElapsed: 0 },
        { index: 2, secondsElapsed: 120 },
      ],
      3,
      MapLine.Travelled,
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
