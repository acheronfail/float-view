import { describe, expect, it } from 'vitest';
import {
  SessionDataProtocolError,
  readBoundedJson,
  validateSessionDataRequest,
  validateSessionDataResult,
} from './session-data';
import { MAX_SESSION_DATA_RESPONSE_BYTES } from './contract';

const snapshot = {
  historyRevision: 0,
  committedSampleSequence: 10,
  committedEventSequence: 2,
  committedElapsedMs: 1_000,
  committedLocationSequence: 0,
  committedLocationElapsedMs: 0,
};
const range = { startElapsedMs: 0, endElapsedMs: 1_000 };

describe('session-data protocol', () => {
  it('validates bounded discriminated requests', () => {
    expect(
      validateSessionDataRequest({
        kind: 'series',
        sessionId: 'session-1',
        snapshot,
        range,
        fields: ['packVoltageV'],
        buckets: 32,
        gapPolicy: { thresholdSeconds: null },
      })
    ).toMatchObject({ kind: 'series', buckets: 32 });
    expect(() =>
      validateSessionDataRequest({
        kind: 'series',
        sessionId: 'session-1',
        snapshot,
        range,
        fields: Array.from({ length: 17 }, (_, index) => `field${index}`),
        buckets: 1,
        gapPolicy: { thresholdSeconds: null },
      })
    ).toThrow(SessionDataProtocolError);
  });

  it('rejects mismatched parallel arrays and identity', () => {
    const request = validateSessionDataRequest({
      kind: 'samples',
      sessionId: 'session-1',
      snapshot,
      range,
      fields: ['packVoltageV'],
      mode: 'window',
      limit: 2,
    });
    expect(() =>
      validateSessionDataResult(
        {
          kind: 'samples',
          sessionId: 'other',
          snapshot,
          range,
          mode: 'window',
          fields: [{ name: 'packVoltageV', source: 'stable' }],
          elapsedMs: [0, 1],
          sequence: [1],
          values: { packVoltageV: [60, 59] },
          nextCursor: null,
        },
        request
      )
    ).toThrow(SessionDataProtocolError);
  });

  it('accepts a validated columnar series result', () => {
    const request = validateSessionDataRequest({
      kind: 'series',
      sessionId: 'session-1',
      snapshot,
      range,
      fields: ['packVoltageV'],
      buckets: 2,
      gapPolicy: { thresholdSeconds: 1 },
    });
    const result = validateSessionDataResult(
      {
        kind: 'series',
        sessionId: 'session-1',
        snapshot,
        range,
        gapPolicy: { thresholdSeconds: 1 },
        fields: [{ name: 'packVoltageV', source: 'stable' }],
        columns: { packVoltageV: { elapsedMs: [0], sequence: [1], values: [60], generations: [0] } },
      },
      request
    );
    expect(result.kind).toBe('series');
  });

  it('validates optional fault details without guessing times for older event pages', () => {
    const request = validateSessionDataRequest({ kind: 'events', sessionId: 'session-1', snapshot, range, limit: 100 });
    const value = {
      kind: 'events',
      sessionId: 'session-1',
      snapshot,
      range,
      nextCursor: null,
      page: {
        elapsedMs: [1000],
        sequence: [1],
        sourceSampleSequence: [0],
        kinds: ['firmwareFaultHistory'],
        values: ['unknown'],
      },
    };
    expect(validateSessionDataResult(value, request).kind).toBe('events');
    expect(
      validateSessionDataResult(
        { ...value, page: { ...value.page, faults: [{ rawCode: 255, occurredElapsedMs: 900 }] } },
        request
      ).kind
    ).toBe('events');
    for (const faults of [[], [{ rawCode: 256, occurredElapsedMs: null }], [{ rawCode: 4, occurredElapsedMs: 1001 }]]) {
      expect(() => validateSessionDataResult({ ...value, page: { ...value.page, faults } }, request)).toThrow(
        SessionDataProtocolError
      );
    }
  });

  it('validates timeout detail kinds, bounds and nullable occurrence time', () => {
    const request = validateSessionDataRequest({ kind: 'events', sessionId: 'session-1', snapshot, range, limit: 100 });
    const page = {
      elapsedMs: [1000],
      sequence: [1],
      sourceSampleSequence: [0],
      kinds: ['imuTimeoutHistory'],
      values: [''],
      timeouts: [{ active: true, sourceTicks: 100, occurredElapsedMs: null }],
    };
    const value = { kind: 'events', sessionId: 'session-1', snapshot, range, nextCursor: null, page };
    expect(validateSessionDataResult(value, request).kind).toBe('events');
    for (const timeouts of [
      [],
      [{ active: true, sourceTicks: 0x100000000, occurredElapsedMs: null }],
      [{ active: true, sourceTicks: 100, occurredElapsedMs: 1001 }],
      [{ active: 1, sourceTicks: 100, occurredElapsedMs: null }],
    ]) {
      expect(() => validateSessionDataResult({ ...value, page: { ...page, timeouts } }, request)).toThrow(
        SessionDataProtocolError
      );
    }
    expect(() =>
      validateSessionDataResult({ ...value, page: { ...page, kinds: ['firmwareFaultHistory'] } }, request)
    ).toThrow(SessionDataProtocolError);
  });

  it('validates bounded location pages and explicit gaps', () => {
    const request = validateSessionDataRequest({
      kind: 'locations',
      sessionId: 'session-1',
      snapshot,
      range,
      limit: 2,
      cursor: null,
    });
    const result = validateSessionDataResult(
      {
        kind: 'locations',
        sessionId: 'session-1',
        snapshot,
        range,
        points: [
          {
            locationSequence: 1,
            elapsedMs: 100,
            latitude: -33.8,
            longitude: 151.2,
            accuracyM: null,
            altitudeM: null,
            observedAt: '2026-01-01T00:00:00.100Z',
          },
          {
            locationSequence: 2,
            elapsedMs: 900,
            latitude: -33.9,
            longitude: 151.3,
            accuracyM: 5,
            altitudeM: -8,
            observedAt: '2026-01-01T00:00:00.900Z',
          },
        ],
        gaps: [{ startElapsedMs: 101, endElapsedMs: 899, reason: 'noFix' }],
        nextCursor: 'cursor',
        locationBoundary: { lastSequence: 2, lastElapsedMs: 900 },
      },
      request
    );
    if (result.kind !== 'locations') throw new Error('Expected location result');
    expect(result.points).toHaveLength(2);
    expect(result.points.map((point) => point.altitudeM)).toEqual([null, -8]);
    expect(result.gaps[0]?.reason).toBe('noFix');
    expect(() =>
      validateSessionDataRequest({ kind: 'locations', sessionId: 'session-1', snapshot, range, limit: 0 })
    ).toThrow(SessionDataProtocolError);
    expect(() =>
      validateSessionDataResult(
        {
          ...result,
          snapshot: { ...snapshot, committedLocationSequence: 99 },
        },
        request
      )
    ).toThrow(SessionDataProtocolError);
  });

  it('counts decoded streamed bytes before parsing', async () => {
    const payload = JSON.stringify({ ok: true });
    await expect(
      readBoundedJson(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(payload.slice(0, 3)));
              controller.enqueue(new TextEncoder().encode(payload.slice(3)));
              controller.close();
            },
          })
        )
      )
    ).resolves.toEqual({ ok: true });
    const oversized = new Uint8Array(MAX_SESSION_DATA_RESPONSE_BYTES + 1);
    await expect(readBoundedJson(new Response(oversized))).rejects.toThrow(SessionDataProtocolError);
  });
});
