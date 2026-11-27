import { describe, expect, it } from 'vitest';
import type { SessionLocationPoint } from '$lib/backend/contract';
import {
  locationAtElapsed,
  locationAtOrBefore,
  splitLocationSegments,
  travelledLocationSegments,
  visibleLocationSegments,
} from './location-geometry';

const point = (locationSequence: number, elapsedMs: number): SessionLocationPoint => ({
  locationSequence,
  elapsedMs,
  latitude: -33.86 + locationSequence / 1000,
  longitude: 151.2 + locationSequence / 1000,
  accuracyM: null,
  altitudeM: null,
  observedAt: `2026-01-01T00:00:0${locationSequence}Z`,
});

describe('session location geometry', () => {
  it('keeps sparse points in one route until the explicit gap threshold', () => {
    const points = [point(1, 0), point(2, 10_000), point(3, 20_001), point(4, 30_000)];
    expect(splitLocationSegments(points)).toEqual([
      [points[0], points[1]],
      [points[2], points[3]],
    ]);
  });

  it('honours provider gaps even when adjacent points are close', () => {
    const points = [point(1, 0), point(2, 5_000), point(3, 8_000)];
    expect(splitLocationSegments(points, [{ startElapsedMs: 2_000, endElapsedMs: 4_000, reason: 'noFix' }])).toEqual([
      [points[0]],
      [points[1], points[2]],
    ]);
  });

  it('does not fabricate travelled points across a gap and selects the last observed marker', () => {
    const points = [point(1, 1_000), point(2, 2_000), point(3, 20_000)];
    expect(travelledLocationSegments(points, [], 10_000)).toEqual([[points[0], points[1]]]);
    expect(locationAtOrBefore(points, 19_000)).toEqual(points[1]);
    expect(locationAtOrBefore(points, 500)).toBeNull();
  });

  it('clips route segments to a chart viewport and interpolates its edges', () => {
    const points = [point(1, 0), point(2, 10_000), point(3, 20_000)];
    const visible = visibleLocationSegments(points, [], 5_000, 15_000);

    expect(visible).toHaveLength(1);
    expect(visible[0]?.map((value) => value.elapsedMs)).toEqual([5_000, 10_000, 15_000]);
    expect(visible[0]?.[0]?.latitude).toBeCloseTo(points[0]!.latitude + 0.5 / 1_000);
    expect(visible[0]?.at(-1)?.longitude).toBeCloseTo(points[1]!.longitude + 0.5 / 1_000);
  });

  it('selects an interpolated center location or the nearest visible point across a gap', () => {
    const points = [point(1, 0), point(2, 10_000), point(3, 30_000)];
    const visible = visibleLocationSegments(points, [], 5_000, 25_000);

    expect(locationAtElapsed(visible, 7_500)?.elapsedMs).toBe(7_500);
    expect(locationAtElapsed(visible, 20_000)?.elapsedMs).toBe(10_000);
  });
});
