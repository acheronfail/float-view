import type { SessionLocationPoint } from '$lib/backend/contract';
import type { recordingTimeline } from './recording-time';

type ElevationPoint = { elapsedMs: number; ratio: number; altitude: number; startsRun: boolean };

export function visibleElevation(
  track: readonly (readonly SessionLocationPoint[])[],
  axis: ReturnType<typeof recordingTimeline>
) {
  const points: ElevationPoint[] = [];
  let min = Infinity;
  let max = -Infinity;
  for (const segment of track) {
    let previousInterval = -1;
    for (const { elapsedMs, altitudeM } of segment) {
      const ratio = axis.ratioAt(elapsedMs);
      if (altitudeM === null || ratio === null || ratio < 0 || ratio > 1) {
        previousInterval = -1;
        continue;
      }
      const interval = axis.indexAt(elapsedMs);
      points.push({ elapsedMs, ratio, altitude: altitudeM, startsRun: interval !== previousInterval });
      previousInterval = interval;
      min = Math.min(min, altitudeM);
      max = Math.max(max, altitudeM);
    }
  }
  return points.length ? { points, min, max } : null;
}

export function elevationY(value: number, min: number, max: number, height: number) {
  if (min === max) return height / 2;
  const span = max - min;
  const ratio = Number.isFinite(span) ? (value - min) / span : (value / 2 - min / 2) / (max / 2 - min / 2);
  return height - 4 - ratio * (height - 8);
}

export function elevationPath(
  elevation: NonNullable<ReturnType<typeof visibleElevation>>,
  width: number,
  height: number
) {
  return elevation.points
    .map((point, index, points) => {
      const x = (point.ratio * width).toFixed(2);
      const y = elevationY(point.altitude, elevation.min, elevation.max, height).toFixed(2);
      const dot = point.startsRun && (points[index + 1]?.startsRun ?? true);
      return `${point.startsRun ? 'M' : 'L'}${x},${y}${dot ? (point.ratio === 1 ? 'h-.01' : 'h.01') : ''}`;
    })
    .join('');
}

export function inspectElevation(points: readonly ElevationPoint[], elapsedMs: number, ratio: number, width: number) {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid]!.elapsedMs < elapsedMs) lo = mid + 1;
    else hi = mid;
  }
  const prior = points[lo - 1];
  const next = points[lo];
  if (next?.elapsedMs === elapsedMs) return next;
  const closest = !prior || (next && elapsedMs - prior.elapsedMs > next.elapsedMs - elapsedMs) ? next : prior;
  if (closest && ((prior && next && !next.startsRun) || Math.abs(closest.ratio - ratio) * width <= 5)) return closest;
  return null;
}
