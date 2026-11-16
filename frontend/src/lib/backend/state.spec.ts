import { emptySpeedCalibration } from './contract';
import { permissionInventory } from '../../../backend-mock/permissions';
import { emptyEstimate } from '../../../backend-mock/battery';
import { describe, expect, it, vi } from 'vitest';
import type {
  AppState,
  BackendMethod,
  BackendParams,
  BackendResult,
  BluetoothPermissionState,
  BluetoothState,
} from '$lib/backend/contract';
import { defaultAnnouncements } from '$lib/backend/contract';
import { ApiRequestError, ApiRequestTimeoutError, type ApiClient } from './client';
import { BackendState, permissionOutcome } from './state.svelte';

const bluetooth = (scanPermission: BluetoothPermissionState): BluetoothState => ({
  radio: 'powered_on',
  scanPermission,
  connectPermission: 'granted',
  scanning: false,
});

const initial: AppState = {
  speedCalibration: { ...emptySpeedCalibration, currentDiameterMm: 280 },
  permissions: permissionInventory('ios'),
  revision: 1,
  bluetooth: bluetooth('granted'),
  discoveredDevices: [],
  savedDevices: [
    {
      savedDeviceId: 'saved-board',
      deviceHistoryId: 'history-board',
      revision: 0,
      displayName: 'Advertised',
      customDisplayName: null,
      advertisedName: 'Advertised',
      bluetoothIdentifier: 'AA:BB:CC:DD:EE:FF',
      profileComplete: false,
      summary: {
        sessionCount: 0,
        totalRidingElapsedMs: 0,
        totalDistanceM: null,
        mostRecentSessionAt: null,
        totalStorageBytes: 0,
      },
    },
  ],
  activeConnection: null,
  pausedRide: null,
  sessionCatalogRevision: 0,
  batteryCellProfiles: [],
  batteryPresets: [],
  batteryPresetCatalogVersion: 'test',
  location: {
    status: 'disabled',
    permissionAction: 'requestPermission',
    backgroundCapture: 'unavailable',
    reason: null,
  },
  announcementAudio: { status: 'ready', reason: null, loweringControl: 'adjustable', voiceSettingsAvailable: false },
  settings: {
    announcements: { ...defaultAnnouncements },
    revision: 0,
    idleProbeIntervalMs: 500,
    idlePersistIntervalMs: 1_000,
    ridingPersistIntervalMs: 100,
    postRideTailMs: 5_000,
    reconnectDurationMs: 300_000,
    rideResumeWindowMinutes: 60,
    minimumSessionDistance: 100,
    themePreference: 'system',
    accentPreference: 'purple',
    unitPreference: 'metric',
    sessionDisplayOptions: { bothFootpadsOff: false, oneFootpadOff: false },
    liveWidgetSlots: ['fieldWeakeningCurrentA', 'motorCurrentA', 'batteryCurrentA', 'powerW', 'distanceM'],
    historyGapThresholdSeconds: null,
    locationRecordingEnabled: false,
    autoConnectSavedDeviceId: null,
    safetyDisclaimerAccepted: false,
    includeGpsLocationWhenExporting: false,
  },
};

class FakeClient {
  isOpen = true;
  state = structuredClone(initial);
  locationRequests: string[] = [];
  pruneRequests: Array<{ method: string; scope: string; sessionId?: string; targetResolutionSeconds: number }> = [];
  prunedResolution: number | null = null;
  pruneStatus: 'queued' | 'completed' = 'completed';
  private handler?: (state: AppState) => void;

  async request<M extends BackendMethod>(method: M, params: BackendParams<M>): Promise<BackendResult<M>> {
    let result: unknown;
    switch (method) {
      case 'state.get':
        result = this.state;
        break;
      case 'settings.update':
        this.state = {
          ...this.state,
          revision: this.state.revision + 1,
          settings: {
            ...this.state.settings,
            ...(params as BackendParams<'settings.update'>).patch,
            revision: this.state.settings.revision + 1,
          },
        };
        this.handler?.(this.state);
        result = this.state.settings;
        break;
      case 'device.disconnect':
        result = { accepted: true };
        break;
      case 'refloat.control.set': {
        const request = params as BackendParams<'refloat.control.set'>;
        const controls = this.state.activeConnection?.refloatControls;
        if (!controls) throw new Error('Missing Refloat controls');
        const field = `${request.control}Enabled` as
          | 'packageEnabled'
          | 'flywheelEnabled'
          | 'ledsEnabled'
          | 'headlightsEnabled';
        result = { ...controls, [field]: request.enabled };
        break;
      }
      case 'refloat.fatalError.clear': {
        const controls = this.state.activeConnection?.refloatControls;
        if (!controls) throw new Error('Missing Refloat controls');
        result = { ...controls, fatalErrorLatched: false, fatalErrorClearable: false };
        break;
      }
      case 'location.requestPermission':
        this.locationRequests.push(method);
        this.state = {
          ...this.state,
          location: {
            status: 'authorized',
            permissionAction: null,
            backgroundCapture: 'available',
            reason: null,
          },
        };
        result = this.state.location;
        break;
      case 'location.openSettings':
        this.locationRequests.push(method);
        this.state = {
          ...this.state,
          location: {
            status: 'authorized',
            permissionAction: null,
            backgroundCapture: 'available',
            reason: null,
          },
        };
        result = this.state.location;
        break;
      case 'savedDevice.update': {
        const update = params as BackendParams<'savedDevice.update'>;
        const current = this.state.savedDevices[0];
        const customDisplayName = update.customDisplayName?.trim() || null;
        const saved = {
          ...current,
          revision: current.revision + 1,
          customDisplayName,
          displayName: customDisplayName ?? current.advertisedName ?? current.bluetoothIdentifier ?? 'Board',
        };
        this.state = { ...this.state, savedDevices: [saved] };
        result = saved;
        break;
      }
      case 'session.get':
        result = {
          summary: {
            sessionId: 'session-1',
            deviceHistoryId: 'history-board',
            displayName: 'Board',
            startedAt: '2026-07-30T00:00:00Z',
            endedAt: '2026-07-30T00:01:00Z',
            state: 'completed',
            integrity: 'complete',
            sampleCount: 2,
            eventCount: 1,
            ridingElapsedMs: 1_000,
            totalElapsedMs: 1_000,
          },
          fields: [{ name: 'fieldWeakeningCurrentA', source: 'stable' }],
          eventCount: 1,
          recordedSampleCount: 2,
          storedSampleCount: 2,
          prune: {
            targetResolutionSeconds: this.prunedResolution,
            recordedSampleCount: 2,
            storedSampleCount: 2,
            policy: null,
          },
          snapshot: {
            historyRevision: 0,
            committedSampleSequence: 1,
            committedEventSequence: 0,
            committedElapsedMs: 1_000,
            committedLocationSequence: 0,
            committedLocationElapsedMs: 0,
          },
          location: { available: false, count: 0, lastSequence: 0, lastElapsedMs: 0, status: 'disabled' },
        };
        break;
      case 'session.prune.preview': {
        const request = params as BackendParams<'session.prune.preview'>;
        this.pruneRequests.push({ method, ...request });
        result = {
          operation: {
            operationId: 'preview-1',
            kind: 'prunePreview',
            status: 'completed',
            sessionId: request.sessionId ?? null,
            scope: request.scope,
            targetResolutionSeconds: request.targetResolutionSeconds,
            completedSessions: 1,
            eligibleSessions: 1,
            error: null,
          },
          recordedSampleCount: 2,
          estimatedStoredSampleCount: 1,
          estimatedReclaimableBytes: 256,
          skipped: false,
          skipReason: null,
        };
        break;
      }
      case 'session.prune.start': {
        const request = params as BackendParams<'session.prune.start'>;
        this.pruneRequests.push({ method, ...request });
        this.prunedResolution = request.targetResolutionSeconds;
        result = {
          operationId: 'prune-1',
          kind: 'prune',
          status: this.pruneStatus,
          sessionId: request.sessionId ?? null,
          scope: request.scope,
          targetResolutionSeconds: request.targetResolutionSeconds,
          completedSessions: 1,
          eligibleSessions: 1,
          error: null,
        };
        break;
      }
      default:
        throw new Error(`Unexpected method ${method}`);
    }
    return result as BackendResult<M>;
  }
  onStateChanged(handler: (state: AppState) => void) {
    this.handler = handler;
    return () => {
      this.handler = undefined;
    };
  }
  emitState() {
    this.handler?.(this.state);
  }
  onClosed() {
    return () => {};
  }
  close() {
    this.isOpen = false;
  }
}

describe('BackendState', () => {
  it.each([
    [
      new ApiRequestError({ code: 'unavailable', message: 'Backend service is unavailable' }),
      'may have timed out or disconnected',
    ],
    [new ApiRequestTimeoutError('refloat.configuration.write'), 'Timed out waiting for the configuration write'],
    [new ApiRequestError({ code: 'invalid_state', message: 'Controller must be idle' }), 'Controller must be idle'],
    [
      new ApiRequestError({ code: 'conflict', message: 'Configuration changed on the controller' }),
      'Configuration changed on the controller',
    ],
  ])('explains configuration write failures without claiming success: %s', async (failure, expected) => {
    const client = new FakeClient();
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    const original = client.request.bind(client);
    client.request = async <M extends BackendMethod>(
      method: M,
      params: BackendParams<M>
    ): Promise<BackendResult<M>> => {
      if (method === 'refloat.configuration.write') throw failure;
      return original(method, params);
    };
    const result = await store.writeRefloatConfiguration(
      { packageName: 'refloat', packageVersion: '1.3.0', schemaFingerprint: 'test', wireSignature: 1 },
      1,
      {}
    );
    expect(result).toBeNull();
    expect(store.error).toContain(expected);
    if (failure instanceof ApiRequestTimeoutError || failure.code === 'unavailable')
      expect(store.error).toContain('Read current values before retrying');
    expect(store.status).toBe('connected');
    expect(store.busy).toBe(false);
    store.close();
  });

  it.each([
    ['granted', 'ready'],
    ['not_required', 'ready'],
    ['not_determined', 'pending'],
    ['denied', 'denied'],
    ['restricted', 'restricted'],
  ] as const)('maps %s permission to %s', (permission, outcome) => {
    expect(permissionOutcome(bluetooth(permission))).toBe(outcome);
  });

  it('pauses scanning while Bluetooth is off and isolates scan failures from saved data', async () => {
    const client = new FakeClient();
    client.state.bluetooth.radio = 'powered_off';
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    const original = client.request.bind(client);
    let scans = 0;
    client.request = async <M extends BackendMethod>(
      method: M,
      params: BackendParams<M>
    ): Promise<BackendResult<M>> => {
      if (method === 'bluetooth.scan') {
        scans++;
        throw new ApiRequestError({ code: 'unavailable', message: 'Backend service is unavailable' });
      }
      return original(method, params);
    };
    store.error = 'An unrelated operation failed';
    await store.scan();
    expect(scans).toBe(0);
    store.snapshot = { ...client.state, bluetooth: bluetooth('granted') };
    await store.scan();
    expect(scans).toBe(1);
    expect(store.scanError).toContain('Scanning is temporarily unavailable');
    expect(store.error).toBe('An unrelated operation failed');
    expect(store.savedDevices).toHaveLength(1);
    expect(store.status).toBe('connected');
    store.close();
  });

  it.each(['unknown', 'powered_on'] as const)('requests first-use access and waits for radio %s', async (radio) => {
    const client = new FakeClient();
    client.state.bluetooth = { ...bluetooth('not_determined'), radio: 'unknown' };
    const calls: string[] = [];
    const original = client.request.bind(client);
    client.request = async <M extends BackendMethod>(
      method: M,
      params: BackendParams<M>
    ): Promise<BackendResult<M>> => {
      if (method === 'bluetooth.scan') {
        calls.push(method);
        if (calls.length === 1)
          throw new ApiRequestError({ code: 'permission_required', message: 'Permission required' });
        return { accepted: true } as BackendResult<M>;
      }
      if (method === 'bluetooth.requestPermission') {
        calls.push(method);
        return { ...bluetooth('granted'), radio } as BackendResult<M>;
      }
      return original(method, params);
    };
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    await store.scan();
    expect(calls).toEqual(
      radio === 'powered_on'
        ? ['bluetooth.scan', 'bluetooth.requestPermission', 'bluetooth.scan']
        : ['bluetooth.scan', 'bluetooth.requestPermission']
    );
    expect(store.scanError).toBeNull();
    expect(store.permissionBusy).toBe(false);
    store.close();
  });

  it.each(['not_found', 'unavailable'] as const)(
    'distinguishes %s from a transient detail load failure',
    async (code) => {
      const client = new FakeClient();
      const store = new BackendState(
        async () => ({ webSocketUrl: 'ws://test' }),
        async () => client as unknown as ApiClient
      );
      await store.connect();
      const original = client.request.bind(client);
      client.request = async <M extends BackendMethod>(
        method: M,
        params: BackendParams<M>
      ): Promise<BackendResult<M>> => {
        if (method === 'session.get' || method === 'boardProfile.get')
          throw new ApiRequestError({ code, message: 'Load failed' });
        return original(method, params);
      };
      expect(await store.openSession('session')).toBe(false);
      expect(store.sessionNotFound).toBe(code === 'not_found');
      expect(await store.openBoardProfile('saved-board')).toBe(false);
      expect(store.boardProfileNotFound).toBe(code === 'not_found');
      expect(store.status).toBe('connected');
      store.close();
    }
  );

  it('loads one authoritative state and accepts only newer events', async () => {
    const client = new FakeClient();
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    expect(store.snapshot?.revision).toBe(1);
    await store.updateSessionSettings({
      minimumSessionDistance: 250,
    });
    expect(store.settings?.minimumSessionDistance).toBe(250);
    expect(store.snapshot?.revision).toBe(2);
    store.close();
  });

  it('waits for authoritative monotonic snapshots after Refloat method results', async () => {
    const client = new FakeClient();
    client.state = {
      ...client.state,
      activeConnection: {
        deviceId: 'board',
        deviceKind: 'board',
        name: 'Board',
        displayName: 'Board',
        state: 'ready',
        trackingMode: 'guest',
        savedDeviceId: null,
        firmware: {
          vescVersion: '6.06',
          packageName: 'refloat',
          packageVersion: '1.2.3',
          accessMode: 'readWrite',
          supported: true,
        },
        transportFirmware: null,
        controllerConnection: { kind: 'direct' },
        controllerCandidates: [],
        connectionIssue: null,
        connectionWarning: null,
        bms: { status: 'not_found', connection: null, candidates: [], latestSnapshot: null },
        refloatControls: {
          status: 'ready',
          writable: true,
          packageEnabled: true,
          flywheelEnabled: false,
          lightingAvailable: true,
          ledsEnabled: true,
          headlightsEnabled: true,
          fatalErrorClearAvailable: true,
          imuTimeoutAvailable: false,
          fatalErrorLatched: true,
          fatalErrorActive: false,
          fatalErrorClearable: true,
          pendingAction: null,
        },
        refloatConfiguration: null,
        controllerActions: { shutdownAvailable: true, pendingAction: null },
        activeSession: null,
        latestSample: null,
        batteryWarning: null,
        batteryEstimate: emptyEstimate(),
        liveWidgetSlots: ['empty', 'powerW', 'elapsedMs', 'odometerM', 'distanceM'],
        latestLocation: null,
        currentLimits: null,
      },
    };
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    expect(await store.setRefloatControl('leds', false)).toBe(true);
    expect(store.refloatControls?.ledsEnabled).toBe(true);

    client.state = {
      ...client.state,
      revision: client.state.revision + 1,
      activeConnection: {
        ...client.state.activeConnection!,
        refloatControls: { ...client.state.activeConnection!.refloatControls!, ledsEnabled: false },
      },
    };
    client.emitState();
    expect(store.refloatControls?.ledsEnabled).toBe(false);
    store.close();
  });

  it('previews and commits a selected-session prune, then reloads its metadata', async () => {
    const client = new FakeClient();
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    await store.openSession('session-1');

    const preview = await store.previewSessionPrune('one', 5, 'session-1');
    expect(preview?.estimatedStoredSampleCount).toBe(1);
    expect(await store.startSessionPrune('one', 5, 'session-1')).toBe(true);
    expect(client.pruneRequests).toEqual([
      { method: 'session.prune.preview', scope: 'one', sessionId: 'session-1', targetResolutionSeconds: 5 },
      { method: 'session.prune.start', scope: 'one', sessionId: 'session-1', targetResolutionSeconds: 5 },
    ]);
    expect(store.sessionMetadata?.prune.targetResolutionSeconds).toBe(5);
  });

  it('waits for terminal prune state before refreshing selected metadata', async () => {
    const client = new FakeClient();
    client.pruneStatus = 'queued';
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    await store.openSession('session-1');
    await store.startSessionPrune('one', 5, 'session-1');
    expect(store.sessionMetadata?.prune.targetResolutionSeconds).toBe(null);
    client.state = {
      ...client.state,
      revision: client.state.revision + 1,
      sessionOperation: {
        operationId: 'prune-1',
        kind: 'prune',
        status: 'reclaiming',
        sessionId: 'session-1',
        scope: 'one',
        targetResolutionSeconds: 5,
        completedSessions: 0,
        eligibleSessions: 1,
        error: null,
      },
    };
    client.emitState();
    expect(store.sessionMetadata?.prune.targetResolutionSeconds).toBe(null);
    client.state = {
      ...client.state,
      revision: client.state.revision + 1,
      sessionOperation: { ...client.state.sessionOperation!, status: 'completed' },
    };
    client.emitState();
    await vi.waitFor(() => expect(store.sessionMetadata?.prune.targetResolutionSeconds).toBe(5));
    store.close();
  });

  it('enables location with an immediate permission request and routes denied state to settings', async () => {
    const client = new FakeClient();
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    await store.updateSessionSettings({ locationRecordingEnabled: true });
    expect(client.locationRequests).toEqual(['location.requestPermission']);
    expect(store.snapshot?.location.status).toBe('authorized');

    client.state = {
      ...client.state,
      location: {
        status: 'denied',
        permissionAction: 'openSettings',
        backgroundCapture: 'unavailable',
        reason: 'Enable location in Settings.',
      },
    };
    client.emitState();
    await store.requestLocationPermission();
    expect(client.locationRequests.at(-1)).toBe('location.openSettings');
    store.close();
  });

  it('reconciles custom board names and clears back to advertised identity', async () => {
    const client = new FakeClient();
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    await store.updateSavedDeviceName('saved-board', 'Trail board');
    expect(store.savedDevices[0]).toMatchObject({ displayName: 'Trail board', revision: 1 });
    await store.updateSavedDeviceName('saved-board', null);
    expect(store.savedDevices[0]).toMatchObject({ displayName: 'Advertised', revision: 2 });
    store.close();
  });

  it('loads bounded session metadata without embedding history', async () => {
    const client = new FakeClient();
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    expect(await store.openSession('session-1')).toBe(true);
    expect(store.sessionMetadata?.fields).toEqual([{ name: 'fieldWeakeningCurrentA', source: 'stable' }]);
    expect(store.sessionMetadata?.recordedSampleCount).toBe(2);
    store.closeSession();
    expect(store.sessionMetadata).toBeNull();
    store.close();
  });
});

describe('board profile ownership', () => {
  it('ignores late profile reads after closure or another editor opens', async () => {
    const client = new FakeClient();
    const original = client.request.bind(client);
    let resolveFirst!: (value: BackendResult<'boardProfile.get'>) => void;
    vi.spyOn(client, 'request').mockImplementation(async (method, params) => {
      if (method === 'boardProfile.get') {
        const id = (params as BackendParams<'boardProfile.get'>).savedDeviceId;
        if (id === 'first')
          return new Promise((resolve) => {
            resolveFirst = resolve;
          }) as never;
        return { savedDeviceId: id, revision: 1, values: {}, missingFields: [] } as never;
      }
      return original(method, params);
    });
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    const first = store.openBoardProfile('first');
    store.closeBoardProfile();
    await store.openBoardProfile('second');
    resolveFirst({ savedDeviceId: 'first', revision: 1, values: {}, missingFields: [] });
    expect(await first).toBe(false);
    expect(store.selectedBoardProfile?.savedDeviceId).toBe('second');
    expect(await store.updateBoardProfile('first', { seriesCount: 20 })).toBe(false);
    store.close();
  });

  it('keeps an in-flight save bound to its board and ignores its late response', async () => {
    const client = new FakeClient();
    const original = client.request.bind(client);
    let resolveSave!: (value: BackendResult<'boardProfile.update'>) => void;
    const requests: string[] = [];
    vi.spyOn(client, 'request').mockImplementation(async (method, params) => {
      if (method === 'boardProfile.get')
        return {
          savedDeviceId: (params as BackendParams<'boardProfile.get'>).savedDeviceId,
          revision: 1,
          values: {},
          missingFields: [],
        } as never;
      if (method === 'boardProfile.update') {
        requests.push((params as BackendParams<'boardProfile.update'>).savedDeviceId);
        return new Promise((resolve) => {
          resolveSave = resolve;
        }) as never;
      }
      return original(method, params);
    });
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    await store.openBoardProfile('first');
    const save = store.updateBoardProfile('first', { seriesCount: 20 });
    store.closeBoardProfile();
    await store.openBoardProfile('second');
    resolveSave({ savedDeviceId: 'first', revision: 2, values: { seriesCount: 20 }, missingFields: [] });
    await save;
    expect(requests).toEqual(['first']);
    expect(store.selectedBoardProfile?.savedDeviceId).toBe('second');
    store.close();
  });
});

describe('session review request ownership', () => {
  it('ignores refreshes after close and superseded opens', async () => {
    const client = new FakeClient();
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    await store.openSession('session-1');
    const metadata = store.sessionMetadata!;
    const original = client.request.bind(client);
    let finish!: (value: unknown) => void;
    vi.spyOn(client, 'request').mockImplementation(((method: BackendMethod, params: never) =>
      method === 'session.get'
        ? new Promise<unknown>((resolve) => {
            finish = resolve;
          })
        : original(method, params)) as typeof client.request);
    const refresh = store.refreshSession('session-1', () => true);
    expect(store.busy).toBe(false);
    store.closeSession();
    finish(metadata);
    await refresh;
    expect(store.sessionMetadata).toBeNull();
    const first = store.openSession('session-1');
    const finishFirst = finish;
    const second = store.openSession('session-2');
    finish({ ...metadata, summary: { ...metadata.summary, sessionId: 'session-2' } });
    await second;
    finishFirst(metadata);
    await first;
    expect(store.selectedSession?.sessionId).toBe('session-2');
    store.close();
  });
});

describe('live box save ownership', () => {
  function active(): NonNullable<AppState['activeConnection']> {
    return {
      deviceId: 'board',
      name: 'Board',
      displayName: 'Board',
      state: 'ready',
      deviceKind: 'board',
      trackingMode: 'saved',
      savedDeviceId: 'first',
      firmware: null,
      transportFirmware: null,
      controllerConnection: null,
      controllerCandidates: [],
      connectionIssue: null,
      connectionWarning: null,
      bms: { status: 'not_found', connection: null, candidates: [], latestSnapshot: null },
      refloatControls: null,
      refloatConfiguration: null,
      controllerActions: { shutdownAvailable: false, pendingAction: null },
      activeSession: null,
      latestSample: null,
      batteryWarning: null,
      batteryEstimate: emptyEstimate(),
      latestLocation: null,
      currentLimits: null,
      liveWidgetSlots: ['empty', 'powerW', 'elapsedMs', 'odometerM', 'distanceM'],
    };
  }
  it('saves explicit board slots offline or while another board is active without touching the open editor', async () => {
    for (const connection of [null, { ...active(), savedDeviceId: 'second' }]) {
      const client = new FakeClient();
      client.state.activeConnection = connection;
      const original = client.request.bind(client);
      const writes: BackendParams<'boardProfile.update'>[] = [];
      vi.spyOn(client, 'request').mockImplementation(async (method, params) => {
        if (method === 'boardProfile.get')
          return {
            savedDeviceId: 'first',
            revision: 7,
            values: { lastLiveView: 'custom' },
            missingFields: [],
          } as never;
        if (method === 'boardProfile.update') {
          writes.push(params as BackendParams<'boardProfile.update'>);
          return {
            savedDeviceId: 'first',
            revision: 8,
            values: (params as BackendParams<'boardProfile.update'>).patch,
          } as never;
        }
        return original(method, params);
      });
      const store = new BackendState(
        async () => ({ webSocketUrl: 'ws://test' }),
        async () => client as unknown as ApiClient
      );
      await store.connect();
      store.selectedBoardProfile = { savedDeviceId: 'other', revision: 4, values: {}, missingFields: [] };
      const result = await store.saveLiveWidgetSlot('first', 4, 'packVoltageV');
      expect(result.revision).toBe(8);
      expect(writes).toEqual([
        {
          savedDeviceId: 'first',
          expectedRevision: 7,
          patch: {
            liveWidgetSlots: ['empty', 'powerW', 'elapsedMs', 'odometerM', 'packVoltageV'],
          },
        },
      ]);
      expect(store.selectedBoardProfile.savedDeviceId).toBe('other');
      store.close();
    }
  });
  it('keeps dashboard requests separate from the board editor and never retries a conflicted save', async () => {
    const client = new FakeClient();
    client.state.activeConnection = active();
    const original = client.request.bind(client);
    const writes: BackendParams<'boardProfile.update'>[] = [];
    vi.spyOn(client, 'request').mockImplementation(async (method, params) => {
      if (method === 'boardProfile.get')
        return { savedDeviceId: 'first', revision: 7, values: {}, missingFields: [] } as never;
      if (method === 'boardProfile.update') {
        writes.push(params as BackendParams<'boardProfile.update'>);
        throw new ApiRequestError({ code: 'conflict', message: 'Changed' });
      }
      return original(method, params);
    });
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    store.selectedBoardProfile = { savedDeviceId: 'other', revision: 4, values: {}, missingFields: [] };
    expect((await store.readBoardProfile('first')).revision).toBe(7);
    await expect(store.saveDashboard('first', 7, { version: 1, widgets: [] })).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(writes).toHaveLength(1);
    expect(store.selectedBoardProfile.savedDeviceId).toBe('other');
    client.state = { ...client.state, revision: 2, activeConnection: { ...active(), savedDeviceId: 'second' } };
    client.emitState();
    await expect(store.saveDashboard('first', 7, { version: 1, widgets: [] })).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(writes).toHaveLength(2);
    expect(writes[1]?.savedDeviceId).toBe('first');
    client.state = { ...client.state, revision: 3, activeConnection: null };
    client.emitState();
    await expect(store.saveDashboard('first', 7, { version: 1, widgets: [] })).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(writes).toHaveLength(3);
    store.close();
  });
  it('persists only the selected view with one bounded conflict retry and guards a changed target', async () => {
    const client = new FakeClient();
    client.state.activeConnection = active();
    const original = client.request.bind(client);
    let reads = 0;
    const writes: BackendParams<'boardProfile.update'>[] = [];
    vi.spyOn(client, 'request').mockImplementation(async (method, params) => {
      if (method === 'boardProfile.get')
        return { savedDeviceId: 'first', revision: ++reads, values: {}, missingFields: [] } as never;
      if (method === 'boardProfile.update') {
        writes.push(params as BackendParams<'boardProfile.update'>);
        if (writes.length === 1) throw new ApiRequestError({ code: 'conflict', message: 'Changed' });
        return {} as never;
      }
      return original(method, params);
    });
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    store.selectedBoardProfile = { savedDeviceId: 'other', revision: 4, values: {}, missingFields: [] };
    await store.saveLastLiveView('first', 'custom');
    expect(writes.map((p) => [p.expectedRevision, p.patch])).toEqual([
      [1, { lastLiveView: 'custom' }],
      [2, { lastLiveView: 'custom' }],
    ]);
    expect(store.selectedBoardProfile.savedDeviceId).toBe('other');
    client.state = { ...client.state, revision: 2, activeConnection: { ...active(), savedDeviceId: 'second' } };
    client.emitState();
    await expect(store.saveLastLiveView('first', 'normal')).rejects.toThrow('connected board changed');
    expect(writes).toHaveLength(2);
    store.close();
  });
  it('rebases a conflicted slot change onto the latest board layout without touching the open editor', async () => {
    const client = new FakeClient();
    client.state.activeConnection = active();
    const original = client.request.bind(client);
    let reads = 0;
    const writes: BackendParams<'boardProfile.update'>[] = [];
    vi.spyOn(client, 'request').mockImplementation(async (method, params) => {
      if (method === 'boardProfile.get') {
        reads++;
        return {
          savedDeviceId: 'first',
          revision: reads,
          values: {
            liveWidgetSlots: [
              'empty',
              reads === 1 ? 'powerW' : 'bmsStateOfCharge',
              'elapsedMs',
              'odometerM',
              'distanceM',
            ],
          },
          missingFields: [],
        } as never;
      }
      if (method === 'boardProfile.update') {
        writes.push(params as BackendParams<'boardProfile.update'>);
        if (writes.length === 1) throw new ApiRequestError({ code: 'conflict', message: 'Changed' });
        return {} as never;
      }
      return original(method, params);
    });
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    store.selectedBoardProfile = { savedDeviceId: 'other', revision: 4, values: {}, missingFields: [] };
    expect(await store.updateLiveWidgetSlot(0, 'highestTempC')).toBe(true);
    expect(writes[1]).toMatchObject({
      savedDeviceId: 'first',
      expectedRevision: 2,
      patch: {
        liveWidgetSlots: ['highestTempC', 'bmsStateOfCharge', 'elapsedMs', 'odometerM', 'distanceM'],
      },
    });
    expect(store.selectedBoardProfile.savedDeviceId).toBe('other');
    expect(store.snapshot?.activeConnection?.liveWidgetSlots[0]).toBe('empty');
    store.close();
  });
  it('rejects a late profile read after the connected board changes', async () => {
    const client = new FakeClient();
    client.state.activeConnection = active();
    const original = client.request.bind(client);
    let finish!: (value: BackendResult<'boardProfile.get'>) => void;
    const writes: string[] = [];
    vi.spyOn(client, 'request').mockImplementation(async (method, params) => {
      if (method === 'boardProfile.get')
        return new Promise((resolve) => {
          finish = resolve;
        }) as never;
      if (method === 'boardProfile.update') writes.push((params as BackendParams<'boardProfile.update'>).savedDeviceId);
      return original(method, params);
    });
    const store = new BackendState(
      async () => ({ webSocketUrl: 'ws://test' }),
      async () => client as unknown as ApiClient
    );
    await store.connect();
    const saving = store.updateLiveWidgetSlot(0, 'highestTempC');
    client.state = { ...client.state, revision: 2, activeConnection: { ...active(), savedDeviceId: 'second' } };
    client.emitState();
    finish({ savedDeviceId: 'first', revision: 0, values: {}, missingFields: [] });
    expect(await saving).toBe(false);
    expect(writes).toEqual([]);
    expect(store.error).toContain('connected board changed');
    store.close();
  });
});
