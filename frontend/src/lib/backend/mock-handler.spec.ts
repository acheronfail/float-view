import { describe, expect, it, vi } from 'vitest';
import { MockBackend } from '../../../backend-mock/api-v1';
import { defaultBoardAppearance } from './contract';
import type { AppState, BmsSnapshot, RefloatConfigurationValues, RefloatEditorDraft } from './contract';

const bmsSnapshot: BmsSnapshot = {
  observedAt: '2026-01-01T00:00:01Z',
  totalVoltageV: 75.6,
  chargeVoltageV: 84,
  inputCurrentA: 4.2,
  inputIcCurrentA: 4.1,
  sessionAmpHoursAh: 1.25,
  sessionWattHoursWh: 94.5,
  cellVoltagesV: [4.19, 4.2],
  balancing: [false, true],
  temperaturesC: [24.5, 25],
  icTemperatureC: 28,
  humiditySensorTemperatureC: 24,
  humidityPercent: 42,
  highestCellTemperatureC: 25,
  highestCircuitryTemperatureC: 28,
  stateOfCharge: 0.9,
  stateOfHealth: 0.98,
  reportedCanId: 42,
  lifetimeChargeAmpHoursAh: 120,
  lifetimeChargeWattHoursWh: 9_000,
  lifetimeDischargeAmpHoursAh: 110,
  lifetimeDischargeWattHoursWh: 8_250,
  pressurePa: 101_325,
  dataVersion: 1,
  status: 'OK',
};

describe('custom dashboard profiles', () => {
  it('persists atomically, preserves unrelated values and rejects conflicts and invalid shapes', () => {
    const backend = new MockBackend(() => {}, { safetyDisclaimerAccepted: true });
    const request = (method: string, params: object) => backend.handle({ id: 1, method, params });
    const savedDeviceId = 'saved-board';
    const profile = request('boardProfile.get', { savedDeviceId }) as { result: { revision: number; values: object } };
    const customDashboard = {
      version: 1,
      widgets: [{ id: 'a', kind: 'action', action: 'rideMarker', size: 'compact' }],
    };
    expect(
      request('boardProfile.update', {
        savedDeviceId,
        expectedRevision: profile.result.revision,
        patch: { customDashboard },
      })
    ).toMatchObject({ result: { values: { ...profile.result.values, customDashboard } } });
    expect(
      request('boardProfile.update', {
        savedDeviceId,
        expectedRevision: profile.result.revision,
        patch: { customDashboard: null },
      })
    ).toMatchObject({ error: { code: 'conflict' } });
    expect(
      request('boardProfile.update', {
        savedDeviceId,
        expectedRevision: profile.result.revision + 1,
        patch: { customDashboard: { ...customDashboard, version: 2 } },
      })
    ).toMatchObject({ error: { code: 'invalid_request' } });
    expect(request('boardProfile.get', { savedDeviceId })).toMatchObject({
      result: { revision: profile.result.revision + 1, values: { customDashboard } },
    });
    expect(
      request('boardProfile.update', { savedDeviceId: 'missing', expectedRevision: 0, patch: { customDashboard } })
    ).toMatchObject({ error: { code: 'not_found' } });
  });
});

describe('deterministic mock backend', () => {
  it('distinguishes automatic recovery from deliberate pause and preserves pause precedence', () => {
    for (const deliberate of [false, true]) {
      const backend = new MockBackend();
      const connect = () =>
        backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'saved' } });
      backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
      connect();
      const state = backend.handle({ id: 3, method: 'state.get', params: {} }) as { result: AppState };
      const sessionId = state.result.activeConnection!.activeSession!.sessionId;
      backend.simulateConnectionState('reconnecting');
      if (deliberate) {
        backend.handle({ id: 4, method: 'device.disconnect', params: {} });
        connect();
      } else backend.simulateConnectionState('ready');
      expect(backend.handle({ id: 5, method: 'session.get', params: { sessionId } })).toMatchObject({
        result: {
          recordingBreaks: [[expect.any(Number), expect.any(Number), deliberate ? 'pause' : 'connectionLoss']],
        },
      });
    }
  });

  it('authorizes confirmed controls independently of aggregate loading state', () => {
    for (const control of ['package', 'flywheel', 'leds', 'headlights'] as const) {
      const backend = new MockBackend();
      backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
      backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'saved' } });
      backend.simulateRideState('idle');
      backend.simulateRefloatControls({
        status: 'loading',
        ledsEnabled: null,
        headlightsEnabled: null,
        fatalErrorLatched: null,
        fatalErrorActive: null,
        fatalErrorClearable: null,
      });
      const request = { id: 3, method: 'refloat.control.set', params: { control, enabled: control === 'flywheel' } };
      if (control === 'leds' || control === 'headlights') {
        expect(backend.handle(request)).toMatchObject({ error: { code: 'invalid_state' } });
        backend.simulateRefloatControls({ ledsEnabled: true, headlightsEnabled: true });
      }
      expect(backend.handle(request)).toHaveProperty('result');
    }
  });

  it('persists validated appearance and publishes it on the owning saved board', () => {
    const backend = new MockBackend();
    const appearance = { ...defaultBoardAppearance, rail: 4, leftTop: '#ed5555' };
    const result = backend.handle({
      id: 1,
      method: 'boardProfile.update',
      params: { savedDeviceId: 'saved-board', expectedRevision: 0, patch: { appearance } },
    });
    expect(result).toMatchObject({ result: { values: { appearance } } });
    expect(backend.handle({ id: 2, method: 'state.get', params: {} })).toMatchObject({
      result: { savedDevices: [expect.objectContaining({ appearance })] },
    });
    expect(
      backend.handle({
        id: 3,
        method: 'boardProfile.update',
        params: {
          savedDeviceId: 'saved-board',
          expectedRevision: 1,
          patch: { appearance: { ...appearance, rail: 7 } },
        },
      })
    ).toMatchObject({ error: { code: 'invalid_request' } });
    expect(
      backend.handle({ id: 4, method: 'boardProfile.get', params: { savedDeviceId: 'saved-board' } })
    ).toMatchObject({ result: { revision: 1, values: { appearance } } });
  });
  it('implements state and publishes full monotonic state changes', () => {
    const events: unknown[] = [];
    const backend = new MockBackend((event) => events.push(event));
    expect(backend.handle({ id: 1, method: 'state.get', params: {} })).toMatchObject({
      id: 1,
      result: { revision: 0 },
    });
    expect(backend.handle({ id: 2, method: 'bluetooth.scan', params: {} })).toEqual({
      id: 2,
      result: { accepted: true },
    });
    expect(events).toEqual([
      expect.objectContaining({
        event: 'state.changed',
        data: expect.objectContaining({ revision: 1 }),
      }),
    ]);
  });

  it('rejects malformed, unknown, and stale mutations with stable errors', () => {
    const backend = new MockBackend();
    expect(backend.handlePayload('{')).toMatchObject({
      error: { code: 'invalid_request' },
    });
    expect(backend.handle({ id: 1, method: 'other', params: {} })).toMatchObject({
      error: { code: 'invalid_request' },
    });
    expect(
      backend.handle({
        id: 2,
        method: 'settings.update',
        params: { expectedRevision: 9, patch: {} },
      })
    ).toMatchObject({ error: { code: 'conflict' } });
  });

  it('rejects control payloads that exceed 65,536 UTF-8 bytes', () => {
    const backend = new MockBackend();
    expect(backend.handlePayload('😀'.repeat(16_385))).toMatchObject({
      error: { code: 'invalid_request', message: 'Message is too large' },
    });
  });

  it('accumulates ride time independently of idle time for saved and guest boards', () => {
    for (const trackingMode of ['saved', 'guest']) {
      const backend = new MockBackend();
      backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
      backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode } });
      const sample = () =>
        (backend.handle({ id: 3, method: 'state.get', params: {} }) as { result: AppState }).result.activeConnection!
          .latestSample!;
      backend.publishTelemetry();
      backend.publishTelemetry();
      const riding = sample().ridingElapsedMs;
      expect(riding).toBeGreaterThan(0);
      for (const state of ['idle', 'unknown'] as const) {
        backend.simulateRideState(state);
        backend.publishTelemetry();
        expect(sample().ridingElapsedMs).toBe(riding);
      }
      backend.publishTelemetry();
      expect(sample().ridingElapsedMs).toBeGreaterThan(riding);
      expect(sample().elapsedMs).toBeGreaterThan(sample().ridingElapsedMs);
    }
  });

  it('keeps guest telemetry and controller selection out of durable state', () => {
    const backend = new MockBackend();
    backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
    backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'guest' } });
    const before = (backend.handle({ id: 3, method: 'state.get', params: {} }) as { result: AppState }).result;
    expect(before.activeConnection).toMatchObject({
      trackingMode: 'guest',
      batteryEstimate: { level: null, mode: 'unavailable', unavailableReason: 'not_applicable' },
      savedDeviceId: null,
      activeSession: null,
    });

    backend.publishTelemetry();
    backend.simulateControllerSelection([
      { canId: 7, hardwareName: 'VESC 7', firmwareName: 'Refloat', vescVersion: '6.06', vescSupported: true },
      { canId: 42, hardwareName: 'VESC 42', firmwareName: 'Refloat', vescVersion: '6.06', vescSupported: true },
    ]);
    expect(
      backend.handle({
        id: 4,
        method: 'device.selectController',
        params: { deviceId: 'mock-board', canId: 7 },
      })
    ).toMatchObject({ result: { accepted: true } });
    const live = (backend.handle({ id: 5, method: 'state.get', params: {} }) as { result: AppState }).result;
    expect(live.activeConnection).toMatchObject({
      trackingMode: 'guest',
      batteryEstimate: { level: null, mode: 'unavailable', unavailableReason: 'not_applicable' },
      savedDeviceId: null,
      activeSession: null,
      latestSample: expect.any(Object),
      latestLocation: null,
    });
    expect(live.sessionCatalogRevision).toBe(before.sessionCatalogRevision);
    expect(live.savedDevices[0]?.summary).toEqual(before.savedDevices[0]?.summary);
    expect(backend.profiles.get('saved-board')?.revision).toBe(0);
  });

  it('requires board scope, merges imported identities, and creates empty configurable boards', () => {
    const backend = new MockBackend();
    expect(backend.handle({ id: 1, method: 'session.list', params: { limit: 1 } })).toMatchObject({
      error: { code: 'invalid_request' },
    });

    const mergedSessionId = backend.importSession(
      new TextEncoder().encode(
        JSON.stringify({ sessionId: 'imported-1', deviceHistoryId: 'history-board', displayName: 'Renamed board' })
      )
    );
    const mergedBoard = (backend.handle({ id: 2, method: 'state.get', params: {} }) as { result: AppState }).result
      .savedDevices[0];
    expect(mergedBoard?.summary.sessionCount).toBe(3);
    expect(
      (
        backend.handle({ id: 3, method: 'session.list', params: { savedDeviceId: 'saved-board', limit: 100 } }) as {
          result: { items: Array<{ sessionId: string }> };
        }
      ).result.items.some((item) => item.sessionId === mergedSessionId)
    ).toBe(true);

    const createdSessionId = backend.importSession(
      new TextEncoder().encode(
        JSON.stringify({ sessionId: 'imported-2', deviceHistoryId: 'history-imported', displayName: 'Imported board' })
      )
    );
    const afterImport = (backend.handle({ id: 4, method: 'state.get', params: {} }) as { result: AppState }).result;
    const importedBoard = afterImport.savedDevices.find((value) => value.deviceHistoryId === 'history-imported');
    expect(importedBoard).toMatchObject({ displayName: 'Imported board', summary: { sessionCount: 1 } });
    expect(
      (
        backend.handle({
          id: 5,
          method: 'session.list',
          params: { savedDeviceId: importedBoard?.savedDeviceId, limit: 100 },
        }) as {
          result: { items: Array<{ sessionId: string }> };
        }
      ).result.items.map((item) => item.sessionId)
    ).toContain(createdSessionId);
    expect(() => backend.importSession(new Uint8Array([1, 2, 3]))).toThrow('valid board identity');
  });

  it('forgets a board only after disconnect and removes its history', () => {
    const backend = new MockBackend();
    backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
    backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'saved' } });
    expect(
      backend.handle({ id: 3, method: 'savedDevice.delete', params: { savedDeviceId: 'saved-board' } })
    ).toMatchObject({
      error: { code: 'invalid_state' },
    });
    backend.handle({ id: 4, method: 'device.disconnect', params: {} });
    expect(
      backend.handle({ id: 5, method: 'savedDevice.delete', params: { savedDeviceId: 'saved-board' } })
    ).toMatchObject({
      result: { accepted: true },
    });
    expect(
      (backend.handle({ id: 6, method: 'state.get', params: {} }) as { result: AppState }).result.savedDevices
    ).toEqual([]);
    expect(
      backend.handle({ id: 7, method: 'session.list', params: { savedDeviceId: 'saved-board', limit: 100 } })
    ).toMatchObject({ error: { code: 'not_found' } });
  });

  it('publishes prune and reclamation phases and allows cancellation during cleanup', () => {
    vi.useFakeTimers();
    try {
      const states: AppState[] = [];
      const backend = new MockBackend((event) => states.push(event.data));
      const response = backend.handle({
        id: 1,
        method: 'session.prune.start',
        params: {
          scope: 'one',
          sessionId: 'session-1',
          targetResolutionSeconds: 5,
        },
      });
      expect(response).toHaveProperty('result');
      vi.advanceTimersByTime(10);
      expect(states.at(-1)?.sessionOperation?.status).toBe('running');
      vi.advanceTimersByTime(10);
      expect(states.at(-1)?.sessionOperation?.status).toBe('reclaiming');
      const operationId = states.at(-1)!.sessionOperation!.operationId;
      backend.handle({ id: 2, method: 'session.prune.cancel', params: { operationId } });
      vi.runAllTimers();
      expect(states.at(-1)?.sessionOperation?.status).toBe('cancelled');
      expect(states.every((state, i) => i === 0 || state.revision > states[i - 1]!.revision)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('correlates export progress and treats cancellation as idempotent', () => {
    const backend = new MockBackend();
    const call = (method: string, operationId: string) => backend.handle({ id: 1, method, params: { operationId } });
    expect(backend.beginBoardExportProgress('first-export', 'saved-board')).toBe(true);
    expect(call('session.export.status', 'first-export')).toHaveProperty('result.phase', 'exporting');
    expect(call('session.export.cancel', 'unknown-export')).toHaveProperty('error.code', 'not_found');
    expect(call('session.export.cancel', 'first-export')).toHaveProperty('result.phase', 'cancelled');
    expect(call('session.export.cancel', 'first-export')).toHaveProperty('result.phase', 'cancelled');
    expect(backend.advanceBoardExport('first-export', 1)).toBe(false);
    expect(backend.beginBoardExportProgress('next-export', 'saved-board')).toBe(true);
    backend.advanceBoardExport('next-export', backend.boardExportSessions('saved-board')!.length);
    expect(call('session.export.cancel', 'next-export')).toHaveProperty('result.phase', 'ready');
    expect(call('session.export.status', 'first-export')).toHaveProperty('error.code', 'not_found');
  });

  it('validates board export selectors and excludes active sessions', () => {
    const backend = new MockBackend();
    const request = (params: Record<string, unknown>) => backend.handle({ id: 1, method: 'session.export', params });
    expect(request({ savedDeviceId: 'saved-board', format: 'csv' })).toHaveProperty('result.fileName');
    expect(request({ savedDeviceId: 'missing', format: 'csv' })).toHaveProperty('error.code', 'not_found');
    for (const params of [
      { format: 'csv' },
      { savedDeviceId: 'saved-board', sessionId: 'session-1', format: 'csv' },
      { savedDeviceId: 'saved-board', format: 'bad' },
    ])
      expect(request(params)).toHaveProperty('error.code', 'invalid_request');
    expect(backend.boardExportSessions('saved-board')).toContain('session-1');
  });

  it('covers every mandatory method', () => {
    const backend = new MockBackend();
    const request = (id: number, method: string, params: Record<string, unknown> = {}) =>
      backend.handle({ id, method, params });
    request(1, 'bluetooth.scan');
    request(2, 'device.connect', { deviceId: 'mock-board', trackingMode: 'saved' });
    expect(request(3, 'device.disconnect')).toMatchObject({ result: { accepted: true } });
    expect(request(4, 'boardProfile.get', { savedDeviceId: 'saved-board' })).toHaveProperty('result');
    expect(request(5, 'session.get', { sessionId: 'session-1' })).toHaveProperty('result');
    expect(
      request(6, 'session.prune.preview', { scope: 'one', sessionId: 'session-1', targetResolutionSeconds: 10 })
    ).toHaveProperty('result');
    const prune = request(7, 'session.prune.start', {
      scope: 'one',
      sessionId: 'session-1',
      targetResolutionSeconds: 10,
    }) as { result: { operationId: string } };
    expect(prune).toHaveProperty('result');
    expect(request(8, 'session.prune.cancel', { operationId: prune.result.operationId })).toHaveProperty('result');
    expect(request(9, 'session.export', { sessionId: 'session-1', format: 'csv' })).toHaveProperty('result');
    expect(
      request(10, 'savedDevice.update', {
        savedDeviceId: 'saved-board',
        expectedRevision: 0,
        customDisplayName: 'My board',
      })
    ).toMatchObject({ result: { displayName: 'My board', revision: 1 } });
    expect(request(11, 'session.list', { savedDeviceId: 'saved-board', limit: 1 })).toMatchObject({
      result: { items: expect.any(Array), catalogRevision: expect.any(Number) },
    });
    expect(request(12, 'sessionGroup.unlink', { sessionGroupId: 'group-1' })).toMatchObject({
      error: { code: 'invalid_request' },
    });
  });

  it('pages one saved board beyond fifty sessions without offset state', () => {
    const backend = new MockBackend();
    for (let index = 0; index < 51; index += 1) {
      backend.handle({ id: index * 3 + 1, method: 'bluetooth.scan', params: {} });
      backend.handle({
        id: index * 3 + 2,
        method: 'device.connect',
        params: { deviceId: 'mock-board', trackingMode: 'saved' },
      });
      const current = (backend.handle({ id: 999, method: 'state.get', params: {} }) as { result: AppState }).result;
      backend.handle({
        id: index * 3 + 3,
        method: 'session.end',
        params: { sessionId: current.activeConnection!.activeSession!.sessionId },
      });
    }
    const items: string[] = [];
    const revisions = new Set<number>();
    let cursor: string | null = null;
    do {
      const response = backend.handle({
        id: items.length + 100,
        method: 'session.list',
        params: { savedDeviceId: 'saved-board', limit: 25, cursor },
      }) as {
        result: { items: Array<{ sessionId: string }>; catalogRevision: number; nextCursor: string | null };
      };
      expect(response.result.items.length).toBeLessThanOrEqual(25);
      items.push(...response.result.items.map((item) => item.sessionId));
      revisions.add(response.result.catalogRevision);
      cursor = response.result.nextCursor;
    } while (cursor);
    expect(items.length).toBeGreaterThan(50);
    expect(new Set(items).size).toBe(items.length);
    expect(revisions.size).toBe(1);
  });

  it('keeps telemetry-only state changes out of catalog revision invalidation', () => {
    const backend = new MockBackend();
    backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
    backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'saved' } });
    const before = (backend.handle({ id: 3, method: 'state.get', params: {} }) as { result: AppState }).result;
    backend.publishTelemetry();
    const after = (backend.handle({ id: 4, method: 'state.get', params: {} }) as { result: AppState }).result;
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.sessionCatalogRevision).toBe(before.sessionCatalogRevision);
    const sessionId = after.activeConnection!.activeSession!.sessionId;
    expect(backend.handle({ id: 5, method: 'session.get', params: { sessionId } })).toMatchObject({
      result: {
        summary: after.activeConnection!.activeSession,
        snapshot: { committedElapsedMs: after.activeConnection!.activeSession!.totalElapsedMs },
      },
    });
    expect(after).not.toHaveProperty('recentSessions');
    expect(after).not.toHaveProperty('sessionGroups');
  });

  it('rejects a catalog cursor after a visible mutation', () => {
    const backend = new MockBackend();
    const first = backend.handle({
      id: 1,
      method: 'session.list',
      params: { savedDeviceId: 'saved-board', limit: 1 },
    }) as {
      result: { nextCursor: string | null };
    };
    expect(first.result.nextCursor).not.toBeNull();
    backend.handle({ id: 2, method: 'session.delete', params: { sessionId: 'session-1' } });
    expect(
      backend.handle({
        id: 3,
        method: 'session.list',
        params: { savedDeviceId: 'saved-board', limit: 1, cursor: first.result.nextCursor },
      })
    ).toMatchObject({ error: { code: 'conflict' } });
  });

  it('publishes complete live snapshots at the configured persistence cadence', () => {
    const events: {
      data: {
        activeConnection: {
          latestSample: { packageState: string };
          latestLocation: {
            latitude: number;
            longitude: number;
            accuracyM: number | null;
            altitudeM: number | null;
            observedAt: string;
          };
        };
      };
    }[] = [];
    const backend = new MockBackend((event) => events.push(event as (typeof events)[number]));
    backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
    backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'saved' } });
    backend.publishTelemetry();
    const liveSample = events.at(-1)?.data.activeConnection.latestSample;
    backend.simulateConnectionState('reconnecting');
    expect(backend.telemetryCadenceMs).toBe(100);
    expect(liveSample).toMatchObject({
      rideState: 'riding',
      packageState: 'running',
      footpadState: 'both',
    });
    const liveLocation = events.at(-1)?.data.activeConnection.latestLocation;
    expect(liveLocation).toEqual({
      latitude: -33.8688,
      longitude: 151.2093,
      accuracyM: 12,
      altitudeM: null,
      observedAt: expect.any(String),
    });
    expect(events.at(-1)?.data.activeConnection).toMatchObject({
      state: 'reconnecting',
      latestSample: liveSample,
      latestLocation: liveLocation,
    });
  });

  it('sorts bounded controller choices and persists one supported CAN selection', () => {
    const backend = new MockBackend();
    backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
    backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'saved' } });
    backend.simulateControllerSelection([
      {
        canId: 42,
        hardwareName: 'THOR300',
        firmwareName: 'Refloat',
        vescVersion: '6.06',
        vescSupported: true,
      },
      {
        canId: 7,
        hardwareName: 'Other VESC',
        firmwareName: null,
        vescVersion: '5.03',
        vescSupported: false,
      },
    ]);
    expect(
      (
        backend.handle({ id: 3, method: 'state.get', params: {} }) as { result: AppState }
      ).result.activeConnection?.controllerCandidates.map((candidate) => candidate.canId)
    ).toEqual([7, 42]);
    expect(
      backend.handle({
        id: 4,
        method: 'device.selectController',
        params: { deviceId: 'mock-board', canId: 7 },
      })
    ).toMatchObject({ error: { code: 'invalid_state' } });
    expect(
      backend.handle({
        id: 5,
        method: 'device.selectController',
        params: { deviceId: 'mock-board', canId: 42 },
      })
    ).toMatchObject({ result: { accepted: true } });
    expect(
      backend.handle({
        id: 6,
        method: 'device.selectController',
        params: { deviceId: 'mock-board', canId: 42 },
      })
    ).toMatchObject({ error: { code: 'invalid_state' } });
    expect(
      backend.handle({
        id: 7,
        method: 'device.selectController',
        params: { deviceId: 'mock-board', canId: 254 },
      })
    ).toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('never publishes a partial controller prompt beyond the contract bound', () => {
    const backend = new MockBackend();
    backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
    backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'saved' } });
    backend.simulateControllerSelection(
      Array.from({ length: 17 }, (_, canId) => ({
        canId,
        hardwareName: `Controller ${canId}`,
        firmwareName: 'Refloat',
        vescVersion: '6.06',
        vescSupported: true,
      }))
    );

    expect(
      (backend.handle({ id: 3, method: 'state.get', params: {} }) as { result: AppState }).result.activeConnection
    ).toMatchObject({
      state: 'ready',
      controllerCandidates: [],
    });
  });

  it('publishes complete bounded BMS lifecycle states without durable history', () => {
    const backend = new MockBackend();
    backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
    backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'saved' } });
    const initial = (backend.handle({ id: 3, method: 'state.get', params: {} }) as { result: AppState }).result;
    expect(initial.activeConnection?.bms).toEqual({
      status: 'discovering',
      connection: null,
      candidates: [],
      latestSnapshot: null,
    });

    backend.simulateBmsState({ status: 'not_found', connection: null, candidates: [], latestSnapshot: null });
    expect(
      (backend.handle({ id: 4, method: 'state.get', params: {} }) as { result: AppState }).result.activeConnection?.bms
        .status
    ).toBe('not_found');

    backend.simulateBmsAttached(bmsSnapshot, { kind: 'can', canId: 42 });
    const attached = (backend.handle({ id: 5, method: 'state.get', params: {} }) as { result: AppState }).result;
    expect(attached.activeConnection?.bms).toMatchObject({
      status: 'attached',
      connection: { kind: 'can', canId: 42 },
      latestSnapshot: bmsSnapshot,
    });

    backend.simulateBmsState({
      status: 'unavailable',
      connection: { kind: 'can', canId: 42 },
      candidates: [],
      latestSnapshot: bmsSnapshot,
    });
    expect(
      (backend.handle({ id: 6, method: 'state.get', params: {} }) as { result: AppState }).result.activeConnection?.bms
    ).toMatchObject({ status: 'unavailable', latestSnapshot: { observedAt: bmsSnapshot.observedAt } });

    backend.simulateBmsAmbiguous([
      { connection: { kind: 'can', canId: 42 }, hardwareName: 'VBMS', vescVersion: '6.00' },
      { connection: { kind: 'can', canId: 7 }, hardwareName: 'VBMS', vescVersion: '6.00' },
    ]);
    const ambiguous = (backend.handle({ id: 7, method: 'state.get', params: {} }) as { result: AppState }).result;
    expect(ambiguous.activeConnection?.bms.candidates.map((item) => item.connection)).toEqual([
      { kind: 'can', canId: 7 },
      { kind: 'can', canId: 42 },
    ]);
    expect(ambiguous.activeConnection?.bms).toMatchObject({
      status: 'ambiguous',
      connection: null,
      latestSnapshot: null,
    });
    expect(ambiguous.sessionCatalogRevision).toBe(initial.sessionCatalogRevision);
  });

  it('models a standalone direct BMS without board-only state or a ride session', () => {
    const backend = new MockBackend();
    backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
    backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'saved' } });
    backend.simulateStandaloneBms(bmsSnapshot);

    const state = (backend.handle({ id: 3, method: 'state.get', params: {} }) as { result: AppState }).result;
    expect(state.activeConnection).toMatchObject({
      state: 'ready',
      deviceKind: 'bms',
      batteryEstimate: { level: null, mode: 'unavailable', unavailableReason: 'not_applicable' },
      firmware: null,
      transportFirmware: { hardwareName: 'VBMS', vescVersion: '6.00', testVersion: 0 },
      controllerConnection: null,
      controllerCandidates: [],
      refloatControls: null,
      controllerActions: { shutdownAvailable: false, pendingAction: null },
      activeSession: null,
      latestSample: null,
      latestLocation: null,
      currentLimits: null,
      bms: { status: 'attached', connection: { kind: 'direct' }, latestSnapshot: bmsSnapshot },
    });
    expect(state.savedDevices[0]?.summary.sessionCount).toBe(2);
  });

  it('revision-checks an independent nullable preferred BMS CAN ID', () => {
    const backend = new MockBackend();
    expect(
      backend.handle({
        id: 1,
        method: 'boardProfile.update',
        params: { savedDeviceId: 'saved-board', expectedRevision: 0, patch: { preferredBmsCanId: 42 } },
      })
    ).toMatchObject({ result: { revision: 1, values: { preferredBmsCanId: 42 } } });
    expect(
      backend.handle({
        id: 2,
        method: 'boardProfile.update',
        params: { savedDeviceId: 'saved-board', expectedRevision: 0, patch: { preferredBmsCanId: null } },
      })
    ).toMatchObject({ error: { code: 'conflict' } });
    expect(
      backend.handle({
        id: 3,
        method: 'boardProfile.update',
        params: { savedDeviceId: 'saved-board', expectedRevision: 1, patch: { preferredBmsCanId: 254 } },
      })
    ).toMatchObject({ error: { code: 'invalid_request' } });
    expect(
      backend.handle({
        id: 4,
        method: 'boardProfile.update',
        params: { savedDeviceId: 'saved-board', expectedRevision: 1, patch: { preferredBmsCanId: null } },
      })
    ).toMatchObject({ result: { revision: 2, values: { preferredBmsCanId: null } } });
  });

  it('validates Refloat control envelopes and confirms complete state without optimistic results', () => {
    const events: Array<{ data: AppState }> = [];
    const backend = new MockBackend((event) => events.push(event));
    backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
    backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'saved' } });
    const before = (backend.handle({ id: 3, method: 'state.get', params: {} }) as { result: AppState }).result;

    expect(
      backend.handle({ id: 4, method: 'refloat.control.set', params: { control: 'tune', enabled: true } })
    ).toMatchObject({ error: { code: 'invalid_request' } });
    expect(
      backend.handle({
        id: 5,
        method: 'refloat.control.set',
        params: { control: 'leds', enabled: false, extra: true },
      })
    ).toMatchObject({ error: { code: 'invalid_request' } });
    expect(backend.handle({ id: 6, method: 'refloat.fatalError.clear', params: { force: true } })).toMatchObject({
      error: { code: 'invalid_request' },
    });

    const changed = backend.handle({
      id: 7,
      method: 'refloat.control.set',
      params: { control: 'leds', enabled: false },
    });
    expect(changed).toMatchObject({
      result: { status: 'ready', ledsEnabled: false, pendingAction: null },
    });
    const actionEvents = events.slice(-2).map((event) => event.data.activeConnection?.refloatControls);
    expect(actionEvents[0]).toMatchObject({ ledsEnabled: true, pendingAction: 'leds' });
    expect(actionEvents[1]).toMatchObject({ ledsEnabled: false, pendingAction: null });
    expect(events.at(-1)?.data.revision).toBe(before.revision + 2);

    const idempotentRevision = events.at(-1)!.data.revision;
    expect(
      backend.handle({ id: 8, method: 'refloat.control.set', params: { control: 'leds', enabled: false } })
    ).toMatchObject({ result: { ledsEnabled: false, pendingAction: null } });
    expect((backend.handle({ id: 9, method: 'state.get', params: {} }) as { result: AppState }).result.revision).toBe(
      idempotentRevision
    );
  });

  it('models every boolean control, fatal clearing, flywheel exclusion, and one-action bounds', () => {
    const backend = new MockBackend();
    backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
    backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'guest' } });

    for (const [id, control, enabled] of [
      [3, 'package', false],
      [4, 'package', true],
      [5, 'headlights', false],
      [6, 'flywheel', true],
    ] as const) {
      expect(backend.handle({ id, method: 'refloat.control.set', params: { control, enabled } })).toMatchObject({
        result: { pendingAction: null },
      });
    }
    expect(
      backend.handle({ id: 7, method: 'refloat.control.set', params: { control: 'package', enabled: false } })
    ).toMatchObject({ error: { code: 'invalid_state' } });
    expect(
      backend.handle({ id: 8, method: 'refloat.control.set', params: { control: 'leds', enabled: true } })
    ).toMatchObject({ error: { code: 'invalid_state' } });
    expect(backend.handle({ id: 9, method: 'refloat.fatalError.clear', params: {} })).toMatchObject({
      error: { code: 'invalid_state' },
    });
    backend.simulateRideState('riding');
    expect(
      backend.handle({ id: 10, method: 'refloat.control.set', params: { control: 'flywheel', enabled: false } })
    ).toMatchObject({ result: { flywheelEnabled: false } });

    backend.simulateRefloatControls({ pendingAction: 'package' });
    expect(
      backend.handle({ id: 11, method: 'refloat.control.set', params: { control: 'leds', enabled: true } })
    ).toMatchObject({ error: { code: 'invalid_state' } });
    backend.simulateRefloatControls({ pendingAction: null });
    expect(backend.handle({ id: 12, method: 'refloat.fatalError.clear', params: {} })).toMatchObject({
      result: { fatalErrorLatched: false, fatalErrorActive: false, fatalErrorClearable: false },
    });
  });

  it('retains confirmed values on timeout and resets live-only controls across reconnect', () => {
    const backend = new MockBackend();
    backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
    backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'saved' } });
    backend.simulateRefloatTimeout();
    expect(
      backend.handle({ id: 3, method: 'refloat.control.set', params: { control: 'headlights', enabled: false } })
    ).toMatchObject({ error: { code: 'unavailable' } });
    expect(
      (backend.handle({ id: 4, method: 'state.get', params: {} }) as { result: AppState }).result.activeConnection
        ?.refloatControls
    ).toMatchObject({ headlightsEnabled: true, pendingAction: null });

    backend.simulateExternalLighting(false, false);
    expect(
      (backend.handle({ id: 5, method: 'state.get', params: {} }) as { result: AppState }).result.activeConnection
        ?.refloatControls
    ).toMatchObject({ ledsEnabled: false, headlightsEnabled: false });
    backend.simulateConnectionState('reconnecting');
    expect(
      (backend.handle({ id: 6, method: 'state.get', params: {} }) as { result: AppState }).result.activeConnection
        ?.refloatControls
    ).toMatchObject({ status: 'loading', writable: false, packageEnabled: null, pendingAction: null });
    backend.simulateConnectionState('ready');
    expect(
      (backend.handle({ id: 7, method: 'state.get', params: {} }) as { result: AppState }).result.activeConnection
        ?.refloatControls
    ).toMatchObject({ status: 'ready', writable: true, packageEnabled: true });
  });

  it('keeps guest and saved control semantics equal and restores native pending state to a recreated frontend', () => {
    const connect = (trackingMode: 'saved' | 'guest') => {
      const backend = new MockBackend();
      backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
      backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode } });
      return backend;
    };
    const saved = connect('saved');
    const guest = connect('guest');
    const controls = (backend: MockBackend, id: number) =>
      (backend.handle({ id, method: 'state.get', params: {} }) as { result: AppState }).result.activeConnection
        ?.refloatControls;
    expect(controls(saved, 3)).toEqual(controls(guest, 3));

    saved.simulateRefloatControls({ pendingAction: 'flywheel' });
    expect(controls(saved, 4)).toMatchObject({ pendingAction: 'flywheel' });
    expect(controls(saved, 5)).toMatchObject({ pendingAction: 'flywheel' });
    saved.simulateRefloatControls({ pendingAction: null, writable: false });
    expect(
      saved.handle({ id: 6, method: 'refloat.control.set', params: { control: 'leds', enabled: false } })
    ).toMatchObject({ error: { code: 'invalid_state' } });
  });

  it('models accepted-only shutdown, unsupported no-op, expected loss, and exact revisions', () => {
    const events: Array<{ data: AppState }> = [];
    const backend = new MockBackend((event) => events.push(event));
    backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
    backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'guest' } });

    expect(backend.handle({ id: 3, method: 'controller.shutdown', params: { force: true } })).toMatchObject({
      error: { code: 'invalid_request' },
    });
    expect(backend.handle({ id: 4, method: 'controller.shutdown', params: {} })).toMatchObject({
      error: { code: 'invalid_state' },
    });

    backend.publishTelemetry();
    backend.simulateRideState('idle');
    const beforeNoOp = events.at(-1)!.data.revision;
    expect(backend.handle({ id: 5, method: 'controller.shutdown', params: {} })).toEqual({
      id: 5,
      result: { accepted: true },
    });
    expect(events.at(-2)?.data.activeConnection?.controllerActions).toEqual({
      shutdownAvailable: false,
      pendingAction: 'shutdown',
    });
    expect(events.at(-1)?.data.activeConnection?.controllerActions).toEqual({
      shutdownAvailable: true,
      pendingAction: null,
    });
    expect(events.at(-1)?.data.revision).toBe(beforeNoOp + 2);

    backend.simulateShutdownOutcome('disconnect');
    const beforeDisconnect = events.at(-1)!.data.revision;
    expect(backend.handle({ id: 6, method: 'controller.shutdown', params: {} })).toEqual({
      id: 6,
      result: { accepted: true },
    });
    expect(events.at(-1)?.data.activeConnection).toBeNull();
    expect(events.at(-1)?.data.revision).toBe(beforeDisconnect + 2);
  });

  it('retained configuration reads have no state events and missing sources still load', () => {
    const events: unknown[] = [];
    const backend = new MockBackend((event) => events.push(event));
    backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
    backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'guest' } });
    events.length = 0;
    const retained = backend.handle({
      id: 3,
      method: 'refloat.configuration.read',
      params: { source: 'current', refresh: false },
    });
    expect(retained).toHaveProperty('result');
    expect(events).toEqual([]);
    backend.handle({ id: 4, method: 'refloat.configuration.read', params: { source: 'default', refresh: false } });
    expect(events).toHaveLength(1);
    events.length = 0;
    expect(
      backend.handle({ id: 5, method: 'refloat.configuration.read', params: { source: 'current', refresh: false } })
    ).toMatchObject({ result: (retained as { result: unknown }).result });
    backend.handle({ id: 6, method: 'refloat.configuration.read', params: { source: 'default', refresh: false } });
    expect(events).toEqual([]);
    backend.handle({ id: 7, method: 'refloat.configuration.read', params: { source: 'current' } });
    expect(events).toHaveLength(1);
    expect(
      backend.handle({ id: 8, method: 'refloat.configuration.read', params: { source: 'current', refresh: 'false' } })
    ).toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('keeps editor state for foreground retries and clears it on background loss or disconnect', () => {
    const backend = new MockBackend();
    const deviceId = 'mock-board';
    const connect = () => {
      backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
      backend.handle({ id: 2, method: 'device.connect', params: { deviceId, trackingMode: 'guest' } });
    };
    connect();
    const current = (
      backend.handle({ id: 3, method: 'refloat.configuration.read', params: { source: 'current' } }) as {
        result: RefloatConfigurationValues;
      }
    ).result;
    const draft: RefloatEditorDraft = {
      version: 1,
      identity: current.identity,
      source: 'current',
      values: current.values,
      inputs: {},
      position: { sectionKey: 'Ride', search: 'gain', controlsExpanded: false, scrollTop: 123 },
    };
    const save = () => {
      expect(
        backend.handle({
          id: 4,
          method: 'refloat.configuration.draft.set',
          params: { deviceId, baseRevision: current.revision, draft },
        })
      ).toHaveProperty('result');
      backend.handle({
        id: 5,
        method: 'uiState.set',
        params: {
          checkpoint: {
            version: 1,
            route: { kind: 'live' },
            live: { deviceId, mode: 'normal' },
            surface: { kind: 'refloatConfiguration' },
          },
        },
      });
    };
    const read = () => backend.handle({ id: 6, method: 'refloat.configuration.draft.get', params: { deviceId } });
    save();
    backend.simulateConnectionState('reconnecting');
    backend.simulateConnectionState('ready');
    expect(read()).toMatchObject({ result: draft });
    backend.simulateConnectionState('reconnecting', false);
    expect(read()).toMatchObject({ error: { code: 'invalid_state' } });
    backend.simulateConnectionState('ready');
    expect(read()).toMatchObject({ result: null });
    expect(backend.handle({ id: 7, method: 'uiState.get', params: {} })).toMatchObject({ result: null });
    save();
    backend.handle({ id: 8, method: 'device.disconnect', params: {} });
    connect();
    expect(read()).toMatchObject({ result: null });
  });

  it('publishes specific edited-write reasons as board state changes', () => {
    const backend = new MockBackend();
    backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
    backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'guest' } });
    backend.publishTelemetry();
    const reason = () => backend.handle({ id: 3, method: 'refloat.configuration.open', params: {} });
    backend.simulateRideState('idle');
    expect(reason()).toMatchObject({ result: { writeBlockReason: null } });
    backend.simulateRideState('riding');
    expect(reason()).toMatchObject({ result: { writeBlockReason: 'riding' } });
    backend.simulateRefloatControls({ flywheelEnabled: true });
    expect(reason()).toMatchObject({ result: { writeBlockReason: 'flywheel' } });
    backend.simulateRefloatControls({ flywheelEnabled: false, pendingAction: 'leds' });
    expect(reason()).toMatchObject({ result: { writeBlockReason: 'busy' } });
    backend.simulateConnectionState('reconnecting');
    expect(reason()).toMatchObject({ result: { writeBlockReason: 'reconnecting' } });
  });

  it('models bounded configuration pages, verified writes, flywheel exclusion, and exact-version Tunes', () => {
    const backend = new MockBackend();
    backend.handle({ id: 1, method: 'bluetooth.scan', params: {} });
    backend.handle({ id: 2, method: 'device.connect', params: { deviceId: 'mock-board', trackingMode: 'guest' } });
    const opened = backend.handle({ id: 3, method: 'refloat.configuration.open', params: {} });
    expect(opened).toMatchObject({ result: { availability: 'ready', currentLoaded: true } });

    const first = backend.handle({ id: 4, method: 'refloat.configuration.schema', params: {} }) as {
      result: { identity: Record<string, unknown>; fields: unknown[]; nextCursor: string };
    };
    expect(first.result.fields).toHaveLength(1);
    const second = backend.handle({
      id: 5,
      method: 'refloat.configuration.schema',
      params: { cursor: first.result.nextCursor },
    });
    expect(second).toMatchObject({
      result: { fields: expect.arrayContaining([expect.objectContaining({ name: 'leds.on' })]), nextCursor: null },
    });
    expect(
      backend.handle({
        id: 6,
        method: 'refloat.configuration.schema',
        params: { cursor: 'x'.repeat(513) },
      })
    ).toMatchObject({ error: { code: 'invalid_request' } });

    const read = backend.handle({
      id: 7,
      method: 'refloat.configuration.read',
      params: { source: 'current' },
    }) as { result: { revision: number; values: Record<string, unknown> } };
    expect(
      backend.handle({
        id: 8,
        method: 'refloat.configuration.write',
        params: {
          packageVersion: first.result.identity.packageVersion,
          schemaFingerprint: first.result.identity.schemaFingerprint,
          wireSignature: first.result.identity.wireSignature,
          baseRevision: read.result.revision,
          values: read.result.values,
        },
      })
    ).toMatchObject({ error: { code: 'invalid_state' } });

    backend.publishTelemetry();
    backend.simulateRideState('idle');
    const draft = { ...read.result.values, tiltback_duty: { type: 'double', value: 0.81 } };
    expect(
      backend.handle({
        id: 9,
        method: 'refloat.configuration.write',
        params: {
          packageVersion: first.result.identity.packageVersion,
          schemaFingerprint: `0${String(first.result.identity.schemaFingerprint).slice(1)}`,
          wireSignature: first.result.identity.wireSignature,
          baseRevision: read.result.revision,
          values: draft,
        },
      })
    ).toMatchObject({ error: { code: 'conflict' } });
    const written = backend.handle({
      id: 10,
      method: 'refloat.configuration.write',
      params: {
        packageVersion: first.result.identity.packageVersion,
        schemaFingerprint: first.result.identity.schemaFingerprint,
        wireSignature: first.result.identity.wireSignature,
        baseRevision: read.result.revision,
        values: draft,
      },
    }) as { result: { revision: number; values: Record<string, unknown> } };
    expect(written.result).toMatchObject({ revision: 2, values: { 'meta.is_default': { value: false } } });

    const tuneValues = Object.fromEntries(
      Object.entries(written.result.values).filter(([name]) => name === 'leds.on' || name === 'leds.headlights_on')
    );
    const created = backend.handle({
      id: 11,
      method: 'refloat.tune.create',
      params: {
        name: 'Trail',
        description: null,
        identity: first.result.identity,
        sourceRevision: written.result.revision,
        values: tuneValues,
      },
    }) as { result: { tuneId: string; revision: number; values: Record<string, unknown> } };
    expect(created.result).toMatchObject({ tuneId: 'tune-1', revision: 1 });
    expect(created.result.values).toEqual(tuneValues);
    expect(
      backend.handle({
        id: 12,
        method: 'refloat.tune.list',
        params: { identity: first.result.identity, limit: 1 },
      })
    ).toMatchObject({ result: { items: [expect.objectContaining({ tuneId: 'tune-1' })] } });
    expect(
      backend.handle({
        id: 13,
        method: 'refloat.tune.update',
        params: {
          tuneId: created.result.tuneId,
          expectedRevision: 0,
          name: 'Stale',
          description: null,
          values: tuneValues,
        },
      })
    ).toMatchObject({ error: { code: 'conflict' } });

    const boardSpecific = {
      ...written.result.values,
      tiltback_duty: { type: 'double', value: 0.82 },
      'leds.on': { type: 'boolean', value: false },
    };
    const changed = backend.handle({
      id: 14,
      method: 'refloat.configuration.write',
      params: {
        packageVersion: first.result.identity.packageVersion,
        schemaFingerprint: first.result.identity.schemaFingerprint,
        wireSignature: first.result.identity.wireSignature,
        baseRevision: written.result.revision,
        values: boardSpecific,
      },
    }) as { result: { revision: number } };
    backend.publishTelemetry();
    backend.simulateRideState('riding');
    expect(
      backend.handle({
        id: 15,
        method: 'refloat.tune.apply',
        params: {
          tuneId: created.result.tuneId,
          expectedRevision: created.result.revision,
          baseRevision: changed.result.revision,
        },
      })
    ).toMatchObject({
      result: {
        values: {
          tiltback_duty: { value: 0.82 },
          'leds.on': { value: true },
        },
      },
    });

    backend.simulateRideState('idle');
    expect(
      backend.handle({
        id: 16,
        method: 'refloat.control.set',
        params: { control: 'flywheel', enabled: true },
      })
    ).toHaveProperty('result');
    expect(
      backend.handle({
        id: 17,
        method: 'refloat.configuration.read',
        params: { source: 'current' },
      })
    ).toMatchObject({ error: { code: 'invalid_state' } });
    expect(
      (backend.handle({ id: 18, method: 'state.get', params: {} }) as { result: AppState }).result.activeConnection
        ?.refloatConfiguration
    ).toMatchObject({ currentLoaded: false, writable: false });
    expect(
      backend.handle({
        id: 19,
        method: 'refloat.control.set',
        params: { control: 'flywheel', enabled: false },
      })
    ).toHaveProperty('result');
  });
});

describe('announcement mock contract', () => {
  it('defaults footpad settings and validates complete updates without changing saved values', () => {
    const backend = new MockBackend();
    const state = () => (backend.handle({ id: 1, method: 'state.get', params: {} }) as { result: AppState }).result;
    expect(state().settings.announcements).toMatchObject({
      batteryChargeEnabled: true,
      footpadEnabled: false,
      footpadDelaySeconds: 1,
    });
    for (const footpadDelaySeconds of [1, 2, 3, 4, 5]) {
      const current = state().settings;
      const announcements = {
        ...current.announcements,
        batteryChargeEnabled: false,
        footpadEnabled: true,
        footpadDelaySeconds,
      };
      expect(
        backend.handle({
          id: 2,
          method: 'settings.update',
          params: { expectedRevision: current.revision, patch: { announcements } },
        })
      ).toMatchObject({ result: { announcements } });
    }
    const current = state().settings;
    for (const footpadDelaySeconds of [0, 6, 1.5, null, '1']) {
      expect(
        backend.handle({
          id: 3,
          method: 'settings.update',
          params: {
            expectedRevision: current.revision,
            patch: { announcements: { ...current.announcements, footpadDelaySeconds } },
          },
        })
      ).toMatchObject({ error: { code: 'invalid_request' } });
      expect(state().settings).toEqual(current);
    }
    expect(
      backend.handle({
        id: 4,
        method: 'settings.update',
        params: { expectedRevision: 0, patch: { announcements: current.announcements } },
      })
    ).toMatchObject({ error: { code: 'conflict' } });
  });

  it('exposes the mandatory voice settings method and rejects unsupported or extra input', () => {
    const backend = new MockBackend();
    const initial = (backend.handle({ id: 1, method: 'state.get', params: {} }) as { result: AppState }).result;
    expect(initial.announcementAudio.voiceSettingsAvailable).toBe(false);
    expect(backend.handle({ id: 2, method: 'announcements.openVoiceSettings', params: {} })).toMatchObject({
      error: { code: 'unavailable' },
    });
    expect(
      backend.handle({ id: 3, method: 'announcements.openVoiceSettings', params: { uri: 'other' } })
    ).toMatchObject({ error: { code: 'invalid_request' } });
  });
  it('rejects missing and invalid battery charge fields without changing settings', () => {
    const backend = new MockBackend();
    const state = () => (backend.handle({ id: 1, method: 'state.get', params: {} }) as { result: AppState }).result;
    const before = structuredClone(state().settings);
    for (const batteryChargeEnabled of [undefined, null, 'true', 1]) {
      const announcements = { ...before.announcements, batteryChargeEnabled };
      if (batteryChargeEnabled === undefined) delete announcements.batteryChargeEnabled;
      expect(
        backend.handle({
          id: 2,
          method: 'settings.update',
          params: {
            expectedRevision: before.revision,
            patch: { announcements },
          },
        })
      ).toMatchObject({ error: { code: 'invalid_request' } });
      expect(state().settings).toEqual(before);
    }
  });
  it('accepts all rules, validates atomically and permits successive completed tests', () => {
    const backend = new MockBackend();
    const initial = (backend.handle({ id: 1, method: 'state.get', params: {} }) as { result: AppState }).result;
    const announcements = {
      ...initial.settings.announcements,
      speedEnabled: true,
      loadEnabled: true,
      volumePercent: 0,
    };
    expect(
      backend.handle({ id: 2, method: 'settings.update', params: { expectedRevision: 0, patch: { announcements } } })
    ).toMatchObject({ result: { announcements } });
    expect(backend.handle({ id: 3, method: 'announcements.test', params: { kind: 'combined' } })).toMatchObject({
      result: { outcome: 'finished' },
    });
    expect(backend.handle({ id: 4, method: 'announcements.test', params: { kind: 'speed' } })).toMatchObject({
      result: { outcome: 'finished' },
    });
    expect(
      backend.handle({
        id: 5,
        method: 'settings.update',
        params: {
          expectedRevision: 1,
          patch: { announcements: { ...announcements, volumePercent: 101 }, unitPreference: 'imperial' },
        },
      })
    ).toMatchObject({ error: { code: 'invalid_request' } });
    expect(
      (backend.handle({ id: 6, method: 'state.get', params: {} }) as { result: AppState }).result.settings
        .unitPreference
    ).toBe('metric');
    expect(
      backend.handle({ id: 7, method: 'announcements.test', params: { kind: 'combined', text: 'other' } })
    ).toMatchObject({ error: { code: 'invalid_request' } });
  });
});

describe('tune library', () => {
  it('pages across versions, binds cursors to scope, and renames older values without converting them', () => {
    const identity = {
      packageName: 'refloat' as const,
      packageVersion: '1.2.3',
      schemaFingerprint: 'a'.repeat(64),
      wireSignature: 42,
    };
    const values = { old_parameter: { type: 'integer' as const, value: 7 } };
    const old = {
      tuneId: 'old',
      revision: 1,
      name: 'Old',
      description: null,
      identity,
      values,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    };
    const backend = new MockBackend(() => {}, {
      initialRefloatTunes: [
        old,
        {
          ...old,
          tuneId: 'new',
          identity: { ...identity, packageVersion: '1.3.0' },
          updatedAt: '2026-10-02T00:00:00Z',
        },
      ],
    });
    const request = (method: string, params: object) => backend.handle({ id: 1, method, params });
    const page = request('refloat.tune.list', { identity: null, limit: 1 }) as {
      result: { items: { tuneId: string }[]; nextCursor: string };
    };
    expect(page.result.items.map((item) => item.tuneId)).toEqual(['new']);
    expect(request('refloat.tune.list', { identity: null, limit: 1, cursor: page.result.nextCursor })).toMatchObject({
      result: { items: [expect.objectContaining({ tuneId: 'old' })], nextCursor: null },
    });
    expect(request('refloat.tune.list', { identity, limit: 1, cursor: page.result.nextCursor })).toMatchObject({
      error: { code: 'invalid_request' },
    });
    expect(request('refloat.tune.list', { limit: 50 })).toMatchObject({ error: { code: 'invalid_request' } });
    expect(
      request('refloat.tune.update', { tuneId: 'old', expectedRevision: 1, name: 'Renamed', description: null, values })
    ).toMatchObject({ result: { name: 'Renamed', revision: 2, identity, values } });
    expect(
      request('refloat.tune.update', {
        tuneId: 'old',
        expectedRevision: 2,
        name: 'Changed',
        description: null,
        values: { old_parameter: { type: 'integer', value: 8 } },
      })
    ).toMatchObject({ error: { code: 'invalid_request' } });
  });
});

it('merges app data idempotently, keeps local profiles, clears explicitly and restores associations as unpaired', () => {
  const backend = new MockBackend(() => {}, { safetyDisclaimerAccepted: true });
  const exported = backend.appManifest();
  const local = backend.profiles.get('saved-board')!;
  local.values.batteryCapacityAh = 9;
  expect(backend.importAppManifest(exported, false)).toMatchObject({
    boardsAdded: 0,
    sessionsAdded: 0,
    sessionsSkipped: 2,
    settingsImported: false,
  });
  expect(backend.profiles.get('saved-board')!.values.batteryCapacityAh).toBe(9);
  expect(backend.handle({ id: 1, method: 'app.clear', params: {} })).toHaveProperty('result.accepted', true);
  expect(backend.importAppManifest(exported, true)).toMatchObject({
    boardsAdded: 1,
    sessionsAdded: 2,
    settingsImported: true,
  });
  const state = backend.handle({ id: 2, method: 'state.get', params: {} }) as { result: AppState };
  expect(state.result.savedDevices[0]!.bluetoothIdentifier).toBeNull();
  expect(state.result.settings.safetyDisclaimerAccepted).toBe(true);
});
