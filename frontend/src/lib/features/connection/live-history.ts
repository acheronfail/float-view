import type { ActiveConnection } from '$lib/backend/contract';
import { freshBmsSnapshot } from './bms';
import { retainLivePoints, type LiveChartPoint } from './live-charts';

/** One admission owner for all visible live trends. No requests, persistence or timers. */
export class LiveHistoryBuffer {
  points: LiveChartPoint[] = [];
  private identity = '';
  private sequence: number | null = null;

  accept(connection: ActiveConnection | null | undefined, wallMs: number, now: number, transportReady = true) {
    const identity = connection ? `${connection.deviceId}:${connection.savedDeviceId}:${connection.trackingMode}` : '';
    const sample = connection?.latestSample;
    if (
      identity !== this.identity ||
      !transportReady ||
      connection?.state !== 'ready' ||
      (sample && this.sequence !== null && sample.sequence < this.sequence)
    ) {
      this.points = [];
      this.sequence = null;
      this.identity = identity;
    }
    if (
      !transportReady ||
      connection?.state !== 'ready' ||
      !sample ||
      sample.sequence === this.sequence ||
      !Number.isFinite(Date.parse(sample.observedAt)) ||
      wallMs - Date.parse(sample.observedAt) > 1500
    )
      return;
    this.sequence = sample.sequence;
    const snapshot = freshBmsSnapshot(connection.bms, wallMs);
    const fix = connection.latestLocation;
    this.points = retainLivePoints(
      [
        ...this.points,
        {
          time: now,
          sample,
          capturedAtMs: wallMs,
          estimatedLevel: connection.batteryEstimate?.level,
          bms: snapshot ? connection.bms : null,
          location: fix ? { altitudeM: fix.altitudeM, observedAt: fix.observedAt } : undefined,
          bmsTemperatures: snapshot
            ? { circuitryC: snapshot.highestCircuitryTemperatureC, cellsC: snapshot.highestCellTemperatureC }
            : undefined,
        },
      ],
      now
    );
  }
  prune(now: number) {
    this.points = retainLivePoints(this.points, now);
  }
}

export interface LiveHistory {
  readonly points: LiveChartPoint[];
  readonly now: number;
  readonly stale: boolean;
}
