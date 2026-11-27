import type { SessionLocationGap, SessionLocationPoint } from '$lib/backend/contract';

export const LOCATION_GAP_THRESHOLD_MS = 10_000;

export function splitLocationSegments(
  points: readonly SessionLocationPoint[],
  gaps: readonly SessionLocationGap[] = [],
  thresholdMs = LOCATION_GAP_THRESHOLD_MS
): SessionLocationPoint[][] {
  const segments: SessionLocationPoint[][] = [];
  let segment: SessionLocationPoint[] = [];
  const orderedGaps = [...gaps].sort((a, b) => a.startElapsedMs - b.startElapsedMs);
  let gapIndex = 0;
  let latestGapEnd = -1;
  for (const [index, point] of points.entries()) {
    const previous = points[index - 1];
    while (gapIndex < orderedGaps.length && orderedGaps[gapIndex]!.startElapsedMs < point.elapsedMs) {
      latestGapEnd = Math.max(latestGapEnd, orderedGaps[gapIndex++]!.endElapsedMs);
    }
    const gap =
      previous !== undefined &&
      (point.elapsedMs - previous.elapsedMs > thresholdMs || previous.elapsedMs < latestGapEnd);
    if (gap) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    segment.push(point);
  }
  if (segment.length) segments.push(segment);
  return segments;
}

export function travelledLocationSegments(
  points: readonly SessionLocationPoint[],
  gaps: readonly SessionLocationGap[],
  selectedElapsedMs: number,
  thresholdMs = LOCATION_GAP_THRESHOLD_MS
): SessionLocationPoint[][] {
  return splitLocationSegments(points, gaps, thresholdMs)
    .map((segment) => segment.filter((point) => point.elapsedMs <= selectedElapsedMs))
    .filter((segment) => segment.length > 0);
}

export function visibleLocationSegments(
  points: readonly SessionLocationPoint[],
  gaps: readonly SessionLocationGap[],
  startElapsedMs: number,
  endElapsedMs: number,
  thresholdMs = LOCATION_GAP_THRESHOLD_MS
): SessionLocationPoint[][] {
  const start = Math.min(startElapsedMs, endElapsedMs);
  const end = Math.max(startElapsedMs, endElapsedMs);
  return splitLocationSegments(points, gaps, thresholdMs)
    .map((segment) => clipLocationSegment(segment, start, end))
    .filter((segment) => segment.length > 0);
}

export function locationAtElapsed(
  segments: readonly (readonly SessionLocationPoint[])[],
  elapsedMs: number
): SessionLocationPoint | null {
  let nearest: SessionLocationPoint | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const segment of segments) {
    for (const [index, point] of segment.entries()) {
      const distance = Math.abs(point.elapsedMs - elapsedMs);
      if (distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
      if (point.elapsedMs === elapsedMs) return point;

      const next = segment[index + 1];
      if (next && point.elapsedMs < elapsedMs && elapsedMs < next.elapsedMs) {
        return interpolateLocationPoint(point, next, elapsedMs);
      }
    }
  }

  return nearest;
}

export function locationAtOrBefore(
  points: readonly SessionLocationPoint[],
  selectedElapsedMs: number
): SessionLocationPoint | null {
  return points.filter((point) => point.elapsedMs <= selectedElapsedMs).at(-1) ?? null;
}

function clipLocationSegment(
  segment: readonly SessionLocationPoint[],
  startElapsedMs: number,
  endElapsedMs: number
): SessionLocationPoint[] {
  if (!segment.length || segment[0]!.elapsedMs > endElapsedMs || segment.at(-1)!.elapsedMs < startElapsedMs) {
    return [];
  }

  const clipped: SessionLocationPoint[] = [];
  const append = (point: SessionLocationPoint) => {
    if (clipped.at(-1)?.elapsedMs !== point.elapsedMs) clipped.push(point);
  };

  for (const [index, point] of segment.entries()) {
    if (point.elapsedMs >= startElapsedMs && point.elapsedMs <= endElapsedMs) append(point);

    const next = segment[index + 1];
    if (!next) continue;
    if (point.elapsedMs < startElapsedMs && next.elapsedMs > startElapsedMs) {
      append(interpolateLocationPoint(point, next, startElapsedMs));
    }
    if (point.elapsedMs < endElapsedMs && next.elapsedMs > endElapsedMs) {
      append(interpolateLocationPoint(point, next, endElapsedMs));
    }
  }

  return clipped;
}

function interpolateLocationPoint(
  left: SessionLocationPoint,
  right: SessionLocationPoint,
  elapsedMs: number
): SessionLocationPoint {
  const span = right.elapsedMs - left.elapsedMs;
  const ratio = span > 0 ? (elapsedMs - left.elapsedMs) / span : 0;
  return {
    ...left,
    elapsedMs,
    latitude: left.latitude + (right.latitude - left.latitude) * ratio,
    longitude: left.longitude + (right.longitude - left.longitude) * ratio,
    accuracyM: left.accuracyM ?? right.accuracyM,
    altitudeM: null,
  };
}
