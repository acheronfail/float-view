import type { SessionLocationPoint } from '$lib/backend/contract';
import { describe, expect, it } from 'vitest';
import { elevationPath, elevationY, inspectElevation, visibleElevation } from './elevation-history';
import { recordingTimeline } from './recording-time';

const point = (elapsedMs: number, altitudeM: number | null): SessionLocationPoint => ({
  locationSequence: elapsedMs + 1,
  elapsedMs,
  altitudeM,
  latitude: 1,
  longitude: 2,
  accuracyM: null,
  observedAt: '2026-01-01T00:00:00.000Z',
});
const range = { startElapsedMs: 0, endElapsedMs: 10_000 };

describe('session elevation', () => {
  it('separates missing measurements and route gaps, including isolated points', () => {
    const axis = recordingTimeline(range);
    const elevation = visibleElevation(
      [[point(0, -5), point(1000, 0), point(2000, null), point(3000, 5)], [point(6000, 12)]],
      axis
    )!;
    expect(elevation.points.map((p) => p.startsRun)).toEqual([true, false, true, true]);
    expect(elevationPath(elevation, 320, 96).match(/M/g)).toHaveLength(3);
    expect(inspectElevation(elevation.points, 2000, 0.2, 320)).toBeNull();
    expect(inspectElevation(elevation.points, 3000, 0.3, 320)?.altitude).toBe(5);
    expect(visibleElevation([[point(10, null)]], axis)).toBeNull();
  });

  it('splits consecutive fixes across filtered intervals and scales to the visible measurements', () => {
    const axis = recordingTimeline(
      range,
      [],
      [
        { startElapsedMs: 1000, endElapsedMs: 2000 },
        { startElapsedMs: 5000, endElapsedMs: 7000 },
      ]
    );
    const elevation = visibleElevation([[point(0, 90), point(2000, 0), point(5000, -5)]], axis)!;
    expect(elevation.points.map((p) => p.startsRun)).toEqual([true, true]);
    expect(elevation).toMatchObject({ min: -5, max: 0 });
  });

  it('keeps the plot finite for the full range of accepted values', () => {
    expect(elevationY(0, -Number.MAX_VALUE, Number.MAX_VALUE, 96)).toBe(48);
    expect(elevationY(Number.MIN_VALUE, 0, Number.MIN_VALUE, 96)).toBe(4);
  });
});
