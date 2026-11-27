import { describe, expect, it } from 'vitest';
import { splitLocationSegments } from './location-geometry';
import { intervalBuckets, mapIntervals, timeline } from './map-filter';
import type { SessionLocationPoint } from '$lib/backend/contract';
const point = (elapsedMs: number, longitude: number, latitude = 0): SessionLocationPoint => ({
  elapsedMs,
  longitude,
  latitude,
  locationSequence: elapsedMs,
  observedAt: '2026-01-01T00:00:00Z',
  accuracyM: null,
  altitudeM: null,
});
const bounds = { west: -1, east: 1, south: -1, north: 1 };
describe('map intervals', () => {
  it('clips crossings and preserves separate visits', () => {
    expect(mapIntervals([[point(0, -2), point(4000, 2), point(8000, -2)]], bounds)).toEqual([
      { startElapsedMs: 1000, endElapsedMs: 3000 },
      { startElapsedMs: 5000, endElapsedMs: 7000 },
    ]);
  });
  it('merges visible edges and gaps held at the last known location', () => {
    expect(
      mapIntervals(
        [
          [point(0, 0), point(1000, 0), point(2000, 0)],
          [point(4000, 0), point(5000, 0)],
        ],
        bounds
      )
    ).toEqual([{ startElapsedMs: 0, endElapsedMs: 5000 }]);
    expect(mapIntervals([[point(0, 0)]], bounds)).toEqual([]);
  });
  it('keeps provider and sparse GPS gaps on the full chart axis, including the trailing gap', () => {
    const points = [point(1000, 0), point(2000, 0.5), point(4000, 0), point(20_000, 0.5)];
    const segments = splitLocationSegments(points, [{ startElapsedMs: 2500, endElapsedMs: 3500, reason: 'noFix' }]);
    const intervals = mapIntervals(segments, bounds, 30_000);
    expect(intervals).toEqual([{ startElapsedMs: 1000, endElapsedMs: 30_000 }]);
    expect(timeline(intervals).separators).toEqual([]);
    expect(timeline(intervals).elapsedAt(0.5)).toBe(15_500);
  });
  it('uses the previous fix rather than interpolating across gaps or using the next fix', () => {
    expect(mapIntervals([[point(1000, 0)], [point(4000, 2)], [point(8000, 0)]], bounds, 10_000)).toEqual([
      { startElapsedMs: 1000, endElapsedMs: 4000 },
      { startElapsedMs: 8000, endElapsedMs: 10_000 },
    ]);
    expect(mapIntervals([[point(0, -2)], [point(4000, 2)]], bounds, 5000)).toEqual([]);
  });
  it('handles isolated fixes, empty tracks and wrapped boundary fixes', () => {
    expect(mapIntervals([[point(1000, 0)]], bounds, 3000)).toEqual([{ startElapsedMs: 1000, endElapsedMs: 3000 }]);
    expect(mapIntervals([], bounds, 3000)).toEqual([]);
    expect(mapIntervals([[point(0, -179.5)]], { ...bounds, west: 179.5, east: -179.5 }, 3000)).toEqual([
      { startElapsedMs: 0, endElapsedMs: 3000 },
    ]);
  });
  it('ignores outside and zero duration crossings and includes boundary edges', () => {
    expect(mapIntervals([[point(0, 2), point(1000, 2)]], bounds)).toEqual([]);
    expect(mapIntervals([[point(0, -2, 0), point(1000, 0, 3)]], bounds)).toEqual([]);
    expect(mapIntervals([[point(0, 1), point(1000, 1)]], bounds)).toHaveLength(1);
  });
  it('wraps antimeridian routes to equivalent worlds', () => {
    const route = [[point(0, 179), point(4000, -179)]];
    const a = mapIntervals(route, { ...bounds, west: 179.5, east: 180.5 });
    expect(a).toEqual([{ startElapsedMs: 1000, endElapsedMs: 3000 }]);
    expect(mapIntervals(route, { ...bounds, west: -180.5, east: -179.5 })).toEqual(a);
  });
  it('reports excessive visits instead of truncating', () => {
    expect(() =>
      mapIntervals(
        Array.from({ length: 129 }, (_, i) => [point(i * 4000, -2), point(i * 4000 + 2000, 2)]),
        bounds
      )
    ).toThrow('Too many');
  });
});
describe('included duration axis', () => {
  const ranges = [
    { startElapsedMs: 100, endElapsedMs: 200 },
    { startElapsedMs: 500, endElapsedMs: 800 },
  ];
  it('maps unequal durations, joins and original timestamps', () => {
    const axis = timeline(ranges);
    expect(axis.separators).toEqual([0.25]);
    expect(axis.elapsedAt(0.25)).toBe(500);
    expect(axis.elapsedAt(1)).toBe(800);
    expect(axis.ratioAt(300)).toBeNull();
    for (const t of [100, 150, 500, 650, 800]) expect(axis.elapsedAt(axis.ratioAt(t)!)).toBe(t);
  });
  it('handles empty and ordinary axes', () => {
    expect(timeline([]).elapsedAt(0)).toBeNull();
    expect(timeline([{ startElapsedMs: 0, endElapsedMs: 100 }]).elapsedAt(0.5)).toBe(50);
  });
  it('bounds proportional buckets and gives small visits a bucket', () => {
    expect(intervalBuckets(ranges, 10)).toEqual([3, 7]);
    expect(intervalBuckets(ranges, 1)).toEqual([1, 1]);
    expect(intervalBuckets(ranges, 5000).reduce((a, b) => a + b, 0)).toBe(1024);
  });
});
