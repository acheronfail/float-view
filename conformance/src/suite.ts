import { validatePermissions } from '../../frontend/src/lib/backend/permissions.ts';
import {
  supportsRidingTuneApply,
  tunePackageVersion,
  tuneCompatibilityVersion,
} from '../../frontend/src/lib/backend/refloat-tune-policy.ts';
import assert from 'node:assert/strict';
import {
  liveWidgetFields,
  defaultBoardAppearance,
  MAX_SESSION_DATA_FIELDS,
} from '../../frontend/src/lib/backend/contract.ts';
import { validBoardAppearance } from '../../frontend/src/lib/backend/board-appearance.ts';
import type {
  AppState,
  BackendMethod,
  ConnectionIssueCode,
  RefloatConfigurationField,
  RefloatEditorDraft,
  RefloatConfigurationIdentity,
  RefloatConfigurationSummary,
  RefloatConfigurationSchemaPage,
} from '../../frontend/src/lib/backend/contract.ts';
import { ConformanceClient, ConformanceError } from './client.ts';
import { exerciseTransport, exerciseBoardExports, exerciseAppTransfer } from './transport.ts';

export interface Target {
  name: string;
  start(): Promise<{ url: string; origin: string }>;
  endpoint(): Promise<{ url: string; origin: string }>;
  background?(): Promise<void>;
  foreground?(): Promise<void>;
  recreateFrontend?(): Promise<void>;
  verifyFilePresentation?(): Promise<void>;
  loseFixture?(): Promise<void>;
  stop(): Promise<void>;
}

export interface PhysicalTarget extends Target {
  platform: 'android' | 'ios' | 'macos';
  productionBluetooth: true;
  prepareSuite?(report: (message: string) => void): Promise<void>;
  /** Prepare OS-level location permissions without changing app settings. */
  prepareLocation?(report: (message: string) => void): Promise<void>;
  finishSuite?(report: (message: string) => void): Promise<void>;
}

/** Focused board export coverage through each production host without unrelated permission flows. */
export async function runBoardExportConformance(target: Target) {
  let client: ConformanceClient | undefined;
  try {
    const endpoint = await target.start();
    client = await ConformanceClient.open(endpoint.url, endpoint.origin);
    const initial = await client.request('state.get', {});
    await client.request('settings.update', {
      expectedRevision: initial.settings.revision,
      patch: { safetyDisclaimerAccepted: true, minimumSessionDistance: 0 },
    });
    await client.request('bluetooth.requestPermission', {});
    await client.request('bluetooth.scan', { timeoutMs: 10000 });
    const scanned = await client.waitForState((state) => state.discoveredDevices.length > 0);
    await client.request('device.connect', { deviceId: scanned.discoveredDevices[0]!.deviceId, trackingMode: 'saved' });
    const ready = await client.waitForState(
      (state) =>
        state.activeConnection?.state === 'ready' &&
        !!state.activeConnection?.latestSample &&
        !!state.activeConnection?.activeSession
    );
    const board = ready.activeConnection!.savedDeviceId!;
    await client.request('session.end', { sessionId: ready.activeConnection!.activeSession!.sessionId });
    await client.waitForState((state) => !state.activeConnection && !state.pausedRide);
    if (process.env.FLOAT_VIEW_CONFORMANCE_SCENARIOS === 'app-transfer')
      await exerciseAppTransfer(endpoint, client, target.verifyFilePresentation?.bind(target));
    else await exerciseBoardExports(endpoint, client, board, target.verifyFilePresentation?.bind(target));
    return { target: target.name, revision: (await client.request('state.get', {})).revision };
  } finally {
    client?.close();
    await target.stop();
  }
}

/** Exact release admission, schema, recovered timeout and saved/guest lifecycle. */
export async function runRefloatReleaseConformance(target: Target) {
  const version = process.env.FLOAT_VIEW_FIXTURE_REFLOAT ?? '1.3.1-beta2';
  let client: ConformanceClient | undefined;
  try {
    const endpoint = await target.start();
    client = await ConformanceClient.open(endpoint.url, endpoint.origin);
    const initial = await client.request('state.get', {});
    await client.request('settings.update', {
      expectedRevision: initial.settings.revision,
      patch: { safetyDisclaimerAccepted: true, minimumSessionDistance: 0 },
    });
    await client.request('bluetooth.requestPermission', {});
    await client.request('bluetooth.scan', { timeoutMs: 10000 });
    const scanned = await client.waitForState((s) => s.discoveredDevices.length > 0);
    const deviceId = scanned.discoveredDevices[0]!.deviceId;
    for (const trackingMode of ['saved', 'guest'] as const) {
      await client.request('device.connect', { deviceId, trackingMode });
      const ready = await client.waitForState(
        (s) =>
          s.activeConnection?.state === 'ready' &&
          s.activeConnection.latestSample?.imuTimeoutActive === false &&
          s.activeConnection.refloatConfiguration?.availability === 'ready',
        { timeoutMs: 30000 }
      );

      assert.equal(ready.activeConnection!.firmware!.packageVersion, version);
      assert.equal(ready.activeConnection!.latestSample!.firmwareFault, null);
      assert.deepEqual(
        ready.activeConnection!.latestSample!.imuTimeoutHistory.map((entry) => entry.active),
        [true, false]
      );
      assert.deepEqual(ready.activeConnection!.latestSample!.faultHistory, []);
      const opened: RefloatConfigurationSummary = await client.request('refloat.configuration.open', {});
      assert.equal(opened.packageVersion, version);
      if (trackingMode === 'saved') {
        await exerciseRefloatConfiguration(client, ready, true);
        const sessionId = required(ready.activeConnection!.activeSession, 'saved Refloat session').sessionId;
        const metadata = await client.request('session.get', { sessionId });
        const history = await client.sessionData({
          kind: 'events',
          sessionId,
          snapshot: metadata.snapshot,
          range: { startElapsedMs: 0, endElapsedMs: metadata.snapshot.committedElapsedMs },
          limit: 500,
        });
        assert.equal(history.kind, 'events');
        if (history.kind !== 'events') throw new Error('Wrong history kind');
        assert.equal(history.page.kinds.filter((k) => k === 'imuTimeoutHistory').length, 2);
        assert.deepEqual(
          history.page.timeouts?.filter(Boolean).map((v) => v!.active),
          [true, false]
        );
        assert.equal(history.page.kinds.filter((k) => k === 'firmwareFaultHistory').length, 0);
      } else assert.equal(ready.activeConnection!.activeSession, null);
      await client.request('device.disconnect', {});
    }
    return { target: target.name, revision: (await client.request('state.get', {})).revision };
  } finally {
    client?.close();
    await target.stop();
  }
}

/** Firmware provenance without unrelated permission or location scenarios. */
export async function runConnectionContextConformance(target: Target) {
  let client: ConformanceClient | undefined;
  try {
    const endpoint = await target.start();
    client = await ConformanceClient.open(endpoint.url, endpoint.origin);
    const initial = await client.request('state.get', {});
    await client.request('settings.update', {
      expectedRevision: initial.settings.revision,
      patch: { safetyDisclaimerAccepted: true, minimumSessionDistance: 0 },
    });
    await client.request('bluetooth.requestPermission', {});
    const connect = async () => {
      await client!.request('bluetooth.scan', { timeoutMs: 10000 });
      const scanned = await client!.waitForState((s) => s.discoveredDevices.length > 0);
      await client!.request('device.connect', {
        deviceId: scanned.discoveredDevices[0]!.deviceId,
        trackingMode: 'saved',
      });
      return client!.waitForState((s) => s.activeConnection?.state === 'ready', { timeoutMs: 20000 });
    };
    const ready = await connect();
    const id = required(ready.activeConnection?.activeSession, 'No saved session').sessionId;
    await client.waitForState((state) => (state.activeConnection?.activeSession?.sampleCount ?? 0) > 0);
    const first = await client.request('session.get', { sessionId: id });
    assert.equal(first.connectionContextCount, 1);
    assert.deepEqual(first.recordingBreaks, []);
    const request = {
      kind: 'connectionContexts' as const,
      sessionId: id,
      snapshot: first.snapshot,
      range: { startElapsedMs: 0, endElapsedMs: first.snapshot.committedElapsedMs },
      limit: 1,
    };
    const original = await client.sessionData(request);
    assert.equal(original.kind, 'connectionContexts');
    if (original.kind !== 'connectionContexts') throw new Error('Wrong history kind');
    assert.equal(original.contexts.length, 1);
    assert.equal(original.contexts[0]!.context.refloatVersion, ready.activeConnection!.firmware!.packageVersion);
    assert.deepEqual(original.contexts[0]!.context.connection, ready.activeConnection!.controllerConnection);
    assert.doesNotMatch(JSON.stringify(original), /controllerUuid|bluetoothIdentifier|operationId/);
    await client.request('session.marker.add', { sessionId: id, operationId: '00000000-0000-4000-8000-000000000001' });
    await client.request('device.disconnect', {});
    const resumed = await connect();
    assert.equal(resumed.activeConnection?.activeSession?.sessionId, id);
    await client.waitForState(
      (state) => (state.activeConnection?.activeSession?.sampleCount ?? 0) > first.summary.sampleCount
    );
    const metadata = await client.request('session.get', { sessionId: id });
    assert.equal(metadata.connectionContextCount, 2);
    assert.equal(metadata.recordingBreaks.length, 1);
    const [breakStart, breakEnd] = metadata.recordingBreaks[0]!;
    assert.equal(metadata.recordingBreaks[0]![2], 'pause');
    assert.ok(breakStart >= first.snapshot.committedElapsedMs);
    assert.ok(breakEnd > breakStart && breakEnd <= metadata.snapshot.committedElapsedMs);
    // A committed boundary identifies exact source samples, rather than a
    // threshold-derived gap inferred from the reduced chart series.
    if (target.name !== 'mock') {
      const endpoints = await client.sessionData({
        kind: 'samples',
        sessionId: id,
        snapshot: metadata.snapshot,
        range: { startElapsedMs: breakStart, endElapsedMs: breakEnd },
        fields: ['speedKph'],
        mode: 'window',
        limit: 2000,
      });
      assert.equal(endpoints.kind, 'samples');
      if (endpoints.kind === 'samples') {
        assert.deepEqual(endpoints.elapsedMs, [breakStart, breakEnd]);
      }
    }
    const pageRequest = {
      ...request,
      snapshot: metadata.snapshot,
      range: { startElapsedMs: 0, endElapsedMs: metadata.snapshot.committedElapsedMs },
    };
    const page = await client.sessionData(pageRequest);
    if (page.kind !== 'connectionContexts') throw new Error('Wrong history kind');
    assert.deepEqual(page.contexts, original.contexts);
    assert.ok(page.nextCursor);
    const next = await client.sessionData({ ...pageRequest, cursor: page.nextCursor });
    if (next.kind !== 'connectionContexts') throw new Error('Wrong history kind');
    assert.equal(next.contexts.length, 1);
    assert.equal(next.nextCursor, null);
    assert.deepEqual(next.contexts[0]!.context, original.contexts[0]!.context);
    assert.ok(next.contexts[0]!.sequence > original.contexts[0]!.sequence);
    await assert.rejects(
      client.sessionData({
        ...pageRequest,
        range: { startElapsedMs: 1, endElapsedMs: metadata.snapshot.committedElapsedMs },
        cursor: page.nextCursor,
      }),
      /HTTP 400/
    );
    const prefix = await client.sessionData(request);
    if (prefix.kind === 'connectionContexts') assert.deepEqual(prefix.contexts, original.contexts);
    return { target: target.name, revision: (await client.request('state.get', {})).revision };
  } finally {
    client?.close();
    await target.stop();
  }
}

/** Focused contract scenario; avoids unrelated location/export prompts on native hosts. */
export async function runAutoConnectConformance(target: Target) {
  let client: ConformanceClient | undefined;
  try {
    const endpoint = await target.start();
    client = await ConformanceClient.open(endpoint.url, endpoint.origin);
    const initial = await client.request('state.get', {});
    await client.request('settings.update', {
      expectedRevision: initial.settings.revision,
      patch: { safetyDisclaimerAccepted: true },
    });
    await client.request('bluetooth.requestPermission', {});
    await client.request('bluetooth.scan', { timeoutMs: 10000 });
    const discovered = await client.waitForState((s) => s.discoveredDevices.length > 0);
    await client.request('device.connect', {
      deviceId: discovered.discoveredDevices[0]!.deviceId,
      trackingMode: 'saved',
    });
    await client.waitForState((s) => s.activeConnection?.state === 'ready', { timeoutMs: 20000 });
    await client.request('device.disconnect', {});
    client = await exerciseAutoConnect(target, client);
    return { target: target.name, revision: (await client.request('state.get', {})).revision };
  } finally {
    client?.close();
    await target.stop();
  }
}

export async function runDiagnosticsConformance(target: Target) {
  let client: ConformanceClient | undefined;
  try {
    const endpoint = await target.start();
    client = await ConformanceClient.open(endpoint.url, endpoint.origin);
    await exerciseDiagnostics(client);
    return { target: target.name, revision: (await client.request('state.get', {})).revision };
  } finally {
    client?.close();
    await target.stop();
  }
}

export async function runConformance(target: Target) {
  let client!: ConformanceClient;
  try {
    const endpoint = await target.start();
    client = await ConformanceClient.open(endpoint.url, endpoint.origin);
    let initial = await client.request('state.get', {});
    assert.deepEqual(
      await client.request('diagnostics.report', {
        snapshots: 10,
        max_sample_age_ms: 50,
        max_delivery_gap_ms: 100,
        max_handler_ms: 2,
      }),
      { accepted: true }
    );
    await assert.rejects(
      client.request('diagnostics.report', {
        snapshots: 10001,
        max_sample_age_ms: 0,
        max_delivery_gap_ms: 0,
        max_handler_ms: 0,
      })
    );
    await exerciseDiagnostics(client);
    assertState(initial);
    await expectError(
      client.request('settings.update', {
        expectedRevision: initial.settings.revision,
        patch: { safetyDisclaimerAccepted: 'yes' } as never,
      }),
      'invalid_request'
    );
    const agreed = await client.request('settings.update', {
      expectedRevision: initial.settings.revision,
      patch: { safetyDisclaimerAccepted: true },
    });
    assert.equal(agreed.safetyDisclaimerAccepted, true);
    initial = await client.request('state.get', {});
    assert.equal(initial.settings.safetyDisclaimerAccepted, true);
    await exerciseAnnouncements(client, initial);
    initial = await client.request('state.get', {});
    const checkpoint = { version: 1 as const, route: { kind: 'settings' as const }, live: null, surface: null };
    assert.equal(await client.request('uiState.get', {}), null);
    assert.deepEqual(await client.request('uiState.set', { checkpoint }), { accepted: true });
    assert.deepEqual(await client.request('uiState.get', {}), checkpoint);
    for (const returnTo of ['live', 'sessions', 'boardHistory'] as const) {
      const sessionCheckpoint = {
        ...checkpoint,
        route: { kind: 'session' as const, sessionId: 'navigation-check', savedDeviceId: 'board', returnTo },
      };
      await client.request('uiState.set', { checkpoint: sessionCheckpoint });
      assert.deepEqual(await client.request('uiState.get', {}), sessionCheckpoint);
    }
    await client.request('uiState.set', { checkpoint });
    const afterCheckpoint = await client.request('state.get', {});
    for (const mode of ['normal', 'detailed', 'custom'] as const) {
      const liveCheckpoint = {
        ...checkpoint,
        route: { kind: 'live' as const },
        live: { deviceId: 'board', mode, ...(mode === 'custom' ? { savedDeviceId: 'saved-board' } : {}) },
      };
      await client.request('uiState.set', { checkpoint: liveCheckpoint });
      assert.deepEqual(await client.request('uiState.get', {}), liveCheckpoint);
    }
    await client.request('uiState.set', { checkpoint });
    // Native TTS initialization can complete during these requests and publish
    // its own revision. Rust's checkpoint unit test checks the no-event invariant
    // without concurrent OS facts; here all other product state must stay equal.
    assert.ok(afterCheckpoint.revision >= initial.revision);
    assert.deepEqual(
      { ...afterCheckpoint, revision: initial.revision, announcementAudio: initial.announcementAudio },
      initial
    );
    for (const invalid of [
      { ...checkpoint, version: 2 },
      { ...checkpoint, draft: {} },
      { ...checkpoint, surface: { kind: 'liveCharts' } },
      { ...checkpoint, route: { kind: 'session', sessionId: 'ride', savedDeviceId: null } },
      { ...checkpoint, route: { kind: 'session', sessionId: 'ride', savedDeviceId: null, returnTo: 'boardHistory' } },
      { ...checkpoint, route: { kind: 'session', sessionId: 'ride', savedDeviceId: null, returnTo: 'external' } },
      {
        ...checkpoint,
        route: { kind: 'session', sessionId: 'é'.repeat(257), savedDeviceId: null, returnTo: 'sessions' },
      },
      {
        ...checkpoint,
        route: {
          kind: 'session',
          sessionId: '\u0001'.repeat(512),
          savedDeviceId: '\u0001'.repeat(512),
          returnTo: 'boardHistory',
        },
      },
    ])
      await expectError(client.request('uiState.set', { checkpoint: invalid } as never), 'invalid_request');
    assert.deepEqual(await client.request('uiState.get', {}), checkpoint);
    for (const params of [
      { permission: 'unknown', action: 'requestPermission' },
      { permission: 'location', action: 'launchUrl' },
      { permission: 'location', action: 'requestPermission', url: 'https://invalid.example' },
    ]) {
      await expectError(client.request('permissions.recover', params as never), 'invalid_request');
    }
    const row = initial.permissions.find((row) => row.action === null)!;
    if (row)
      await expectError(
        client.request('permissions.recover', { permission: row.permission, action: 'requestPermission' }),
        'invalid_state'
      );
    // New permission IDs are recognized even on hosts where they do not apply.
    for (const permission of ['notifications', 'liveUpdates'] as const) {
      const row = initial.permissions.find((row) => row.permission === permission);
      if (!row || permission === 'liveUpdates') {
        await expectError(
          client.request('permissions.recover', { permission, action: 'requestPermission' }),
          'invalid_state'
        );
      }
      if (row) {
        assert.equal(row.optional, true);
        assert.equal(row.accuracy, 'unknown');
        assert.equal(row.scope, 'unknown');
        assert.equal(row.servicesEnabled, null);
      }
    }
    const afterInvalidRecovery = await client.request('state.get', {});
    assert.equal(afterInvalidRecovery.settings.locationRecordingEnabled, initial.settings.locationRecordingEnabled);
    assert.equal(afterInvalidRecovery.bluetooth.scanning, initial.bluetooth.scanning);
    await expectError(
      (
        client as unknown as {
          request(method: string, params: unknown): Promise<unknown>;
        }
      ).request('unknown.method', {}),
      'invalid_request'
    );

    const permission = await client.request('bluetooth.requestPermission', {});
    assert.equal(typeof permission.radio, 'string');
    // Allow native fixture relay/callback delivery without racing a 100 ms scan expiry.
    await client.request('bluetooth.scan', { timeoutMs: 1_000 });
    const scanned = await client.waitForState((state) => state.discoveredDevices.length > 0, {
      afterRevision: initial.revision,
    });
    assertState(scanned);
    assert.ok(scanned.revision >= initial.revision);

    client.close();
    const replacementEndpoint = await target.endpoint();
    client = await ConformanceClient.open(replacementEndpoint.url, replacementEndpoint.origin);
    const restored = await client.request('state.get', {});
    assertState(restored);
    assert.deepEqual(await client.request('uiState.get', {}), checkpoint);
    await client.request('uiState.set', { checkpoint: null });
    assert.equal(await client.request('uiState.get', {}), null);
    assert.ok(restored.revision >= scanned.revision);
    assert.deepEqual(
      restored.discoveredDevices.map((device) => device.deviceId),
      scanned.discoveredDevices.map((device) => device.deviceId),
      'frontend recreation lost backend-owned state'
    );

    await exerciseProductMethods(
      client,
      restored,
      ['android', 'ios', 'macos', 'direct'].includes(target.name),
      target.recreateFrontend,
      target.name === 'direct'
    );
    if (['android', 'ios', 'macos', 'direct'].includes(target.name)) {
      await exerciseTransport(await target.endpoint(), target.verifyFilePresentation?.bind(target));
    }
    client = await exerciseAutoConnect(target, client);
    if (target.loseFixture) {
      await client.request('bluetooth.scan', { timeoutMs: 100 });
      const observed = await client.waitForState((s) => s.discoveredDevices.length > 0, { afterRevision: 0 });
      const deviceId = observed.discoveredDevices[0]!.deviceId;
      await client.request('device.connect', { deviceId, trackingMode: 'saved' });
      const recording = await client.waitForState(
        (s) =>
          s.activeConnection?.state === 'ready' &&
          !!s.activeConnection.latestSample &&
          !!s.activeConnection.activeSession,
        { afterRevision: observed.revision }
      );
      const began = performance.now();
      await target.loseFixture();
      await client.waitForState((s) => s.activeConnection?.state !== 'ready', {
        afterRevision: recording.revision,
        timeoutMs: 5_000,
      });
      assert.ok(performance.now() - began < 5_000, 'fixture loss was not bounded');
    }
    return {
      target: target.name,
      revision: (await client.request('state.get', {})).revision,
    };
  } finally {
    client?.close();
    await target.stop();
  }
}

export async function exerciseAutoConnect(
  target: Target,
  current: ConformanceClient,
  preferredSavedDeviceId?: string,
  prepareDiscovery?: () => Promise<void>
) {
  let state = await current.request('state.get', {});
  const board = state.savedDevices.find(
    (b) => b.bluetoothIdentifier && (!preferredSavedDeviceId || b.savedDeviceId === preferredSavedDeviceId)
  );
  assert.ok(board, 'saved connection must establish a local association');
  for (const value of [42, 'missing-auto-connect-board']) {
    await expectError(
      current.request('settings.update', {
        expectedRevision: state.settings.revision,
        patch: { autoConnectSavedDeviceId: value, unitPreference: 'metric' } as never,
      }),
      typeof value === 'string' ? 'not_found' : 'invalid_request'
    );
    assert.deepEqual((await current.request('state.get', {})).settings, state.settings);
  }
  const selected = await current.request('settings.update', {
    expectedRevision: state.settings.revision,
    patch: { autoConnectSavedDeviceId: board.savedDeviceId },
  });
  assert.equal(selected.autoConnectSavedDeviceId, board.savedDeviceId);
  if (target.background && target.foreground) {
    // No Home/frontend command starts this discovery; a retained non-live checkpoint wins navigation.
    await current.request('uiState.set', {
      checkpoint: { version: 1, route: { kind: 'settings' }, live: null, surface: null },
    });
    await target.background();
    current.close();
    await prepareDiscovery?.();
    await target.foreground();
    const endpoint = await target.endpoint();
    const resumed = await ConformanceClient.open(endpoint.url, endpoint.origin);
    try {
      const connected = await resumed.waitForState((s) => s.activeConnection?.state === 'ready', { timeoutMs: 15000 });
      assert.equal(connected.activeConnection?.savedDeviceId, board.savedDeviceId);
      assert.equal(connected.activeConnection?.trackingMode, 'saved');
      const checkpoint = await resumed.request('uiState.get', {});
      assert.equal(checkpoint?.route.kind, 'settings');
      await resumed.request('device.disconnect', {});
      await prepareDiscovery?.();
      await resumed.request('bluetooth.scan', { timeoutMs: 1000 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      state = await resumed.request('state.get', {});
      assert.equal(state.activeConnection, null, 'normal scan must not undo explicit disconnect');
      await resumed.request('settings.update', {
        expectedRevision: state.settings.revision,
        patch: { autoConnectSavedDeviceId: null },
      });
      await resumed.request('uiState.set', { checkpoint: null });
    } finally {
      resumed.close();
    }
    // Reconnect the caller's transport without creating a lifecycle visit.
    return ConformanceClient.open(endpoint.url, endpoint.origin);
  } else {
    await current.request('settings.update', {
      expectedRevision: selected.revision,
      patch: { autoConnectSavedDeviceId: null },
    });
  }
  return current;
}

async function exerciseProductMethods(
  client: ConformanceClient,
  state: AppState,
  expectSoftwareBms: boolean,
  recreateFrontend?: () => Promise<void>,
  verifyRouteAltitude = false
) {
  const device = required(state.discoveredDevices[0], 'scan did not create a discovered device');
  const settings = await client.request('settings.update', {
    expectedRevision: state.settings.revision,
    patch: {
      minimumSessionDistance: 100,
      themePreference: 'dark',
      accentPreference: 'teal',
      unitPreference: 'imperial',
      sessionDisplayOptions: { bothFootpadsOff: true, oneFootpadOff: false },
      liveWidgetSlots: ['empty', 'headlights', 'leds', 'elapsedMs', 'distanceM'],
    },
  });
  await expectError(
    client.request('settings.update', {
      expectedRevision: state.settings.revision,
      patch: { minimumSessionDistance: 101 },
    }),
    'conflict'
  );
  assert.deepEqual(settings.sessionDisplayOptions, { bothFootpadsOff: true, oneFootpadOff: false });
  for (const invalid of [
    null,
    {},
    { bothFootpadsOff: true },
    { bothFootpadsOff: true, oneFootpadOff: 1 },
    { bothFootpadsOff: true, oneFootpadOff: false, extra: true },
  ]) {
    await expectError(
      client.request('settings.update', {
        expectedRevision: settings.revision,
        patch: { sessionDisplayOptions: invalid },
      } as never),
      'invalid_request'
    );
  }
  assert.equal(settings.minimumSessionDistance, 100);
  assert.equal(settings.themePreference, 'dark');
  assert.equal(settings.accentPreference, 'teal');
  for (const accentPreference of ['orange', '', null, 1]) {
    await expectError(
      client.request('settings.update', { expectedRevision: settings.revision, patch: { accentPreference } } as never),
      'invalid_request'
    );
  }
  assert.equal(settings.unitPreference, 'imperial');
  assert.deepEqual(settings.liveWidgetSlots, ['empty', 'headlights', 'leds', 'elapsedMs', 'distanceM']);
  for (const invalid of [[], ['speedKph'], ['speedKph', 'powerW', 'motorTempC', 'unknown', 'distanceM'], null]) {
    await expectError(
      client.request('settings.update', {
        expectedRevision: settings.revision,
        patch: { liveWidgetSlots: invalid },
      } as never),
      'invalid_request'
    );
  }
  assert.deepEqual((await client.request('state.get', {})).settings.liveWidgetSlots, settings.liveWidgetSlots);
  if (recreateFrontend) {
    await recreateFrontend();
    assert.equal((await client.request('state.get', {})).settings.accentPreference, settings.accentPreference);
    assert.deepEqual(
      (await client.request('state.get', {})).settings.sessionDisplayOptions,
      settings.sessionDisplayOptions
    );
    assert.deepEqual((await client.request('state.get', {})).settings.liveWidgetSlots, settings.liveWidgetSlots);
  }
  const locationSettings = await client.request('settings.update', {
    expectedRevision: settings.revision,
    patch: { locationRecordingEnabled: true, includeGpsLocationWhenExporting: true },
  });
  assert.equal(locationSettings.locationRecordingEnabled, true);
  assert.equal(locationSettings.includeGpsLocationWhenExporting, true);
  const locationState = await client.request('location.requestPermission', {});
  assert.ok(
    ['notDetermined', 'foregroundOnly', 'authorized', 'denied', 'restricted', 'unavailable'].includes(
      locationState.status
    )
  );
  await expectError(
    (
      client as unknown as {
        request(method: string, params: unknown): Promise<unknown>;
      }
    ).request('settings.update', {
      expectedRevision: locationSettings.revision,
      patch: { automaticSessionLinkingEnabled: true },
    }),
    'invalid_request'
  );

  // Software-host sessions are intentionally brief; retain them so the rest of
  // the canonical session surface can be exercised deterministically.
  await client.request('settings.update', {
    expectedRevision: locationSettings.revision,
    patch: { minimumSessionDistance: 0 },
  });

  await createCompletedSession(client, device.deviceId, expectSoftwareBms, recreateFrontend, verifyRouteAltitude);
  await createCompletedSession(client, device.deviceId, expectSoftwareBms);

  const prepared = await client.request('state.get', {});
  const profileDevice = required(
    prepared.savedDevices.find((saved) => saved.advertisedName === device.name) ?? prepared.savedDevices[0],
    'connection did not create a saved device'
  );
  const profile = await client.request('boardProfile.get', {
    savedDeviceId: profileDevice.savedDeviceId,
  });
  assert.equal(typeof profileDevice.bluetoothIdentifier, 'string');
  assert.ok(profileDevice.bluetoothIdentifier);
  assert.ok(profileDevice.bluetoothIdentifier.length > 0);
  const renamed = await client.request('savedDevice.update', {
    savedDeviceId: profileDevice.savedDeviceId,
    expectedRevision: profileDevice.revision,
    customDisplayName: 'Conformance Board',
  });
  assert.equal(renamed.displayName, 'Conformance Board');
  assert.equal(renamed.customDisplayName, 'Conformance Board');
  await expectError(
    client.request('savedDevice.update', {
      savedDeviceId: profileDevice.savedDeviceId,
      expectedRevision: profileDevice.revision,
      customDisplayName: null,
    }),
    'conflict'
  );
  const resetName = await client.request('savedDevice.update', {
    savedDeviceId: profileDevice.savedDeviceId,
    expectedRevision: renamed.revision,
    customDisplayName: null,
  });
  assert.equal(resetName.displayName, resetName.advertisedName ?? resetName.bluetoothIdentifier);
  const updatedProfile = await client.request('boardProfile.update', {
    savedDeviceId: profile.savedDeviceId,
    expectedRevision: profile.revision,
    patch: { seriesCount: 18, parallelCount: 2, motor: 'hypercore_xr' },
  });
  assert.equal(updatedProfile.missingFields.length, 0);
  const preferredProfile = await client.request('boardProfile.update', {
    savedDeviceId: profile.savedDeviceId,
    expectedRevision: updatedProfile.revision,
    patch: { preferredCanId: 42 },
  });
  assert.equal(preferredProfile.values.preferredCanId, 42);
  assert.equal(preferredProfile.missingFields.length, 0);
  await expectError(
    client.request('boardProfile.update', {
      savedDeviceId: profile.savedDeviceId,
      expectedRevision: preferredProfile.revision,
      patch: { preferredCanId: 254 },
    }),
    'invalid_request'
  );
  const clearedPreference = await client.request('boardProfile.update', {
    savedDeviceId: profile.savedDeviceId,
    expectedRevision: preferredProfile.revision,
    patch: { preferredCanId: null },
  });
  assert.equal(clearedPreference.values.preferredCanId, null);
  await expectError(
    client.request('boardProfile.update', {
      savedDeviceId: profile.savedDeviceId,
      expectedRevision: profile.revision,
      patch: {},
    }),
    'conflict'
  );
  await expectError(
    client.request('boardProfile.get', {
      savedDeviceId: 'missing-saved-device',
    }),
    'not_found'
  );

  const layoutProfile = await client.request('boardProfile.update', {
    savedDeviceId: profile.savedDeviceId,
    expectedRevision: clearedPreference.revision,
    patch: {
      lastLiveView: 'custom',
      appearance: { ...defaultBoardAppearance, rail: 5, hooks: 3, leftTop: '#ed5555' },
      customDashboard: {
        version: 1,
        widgets: [
          {
            id: 'current',
            kind: 'reading',
            field: 'maxSpeedKph',
            presentation: 'gauge',
            size: 'large',
            range: { min: 0, max: 60 },
          },
          { id: 'battery', kind: 'visual', visual: 'battery', size: { columns: 4, rows: 1 } },
          { id: 'lights', kind: 'control', control: 'leds', size: { columns: 1, rows: 4 } },
          { id: 'marker', kind: 'action', action: 'rideMarker', size: { columns: 2, rows: 1 } },
          { id: 'theme', kind: 'action', action: 'themeToggle', size: { columns: 1, rows: 1 } },
          { id: 'net-wh', kind: 'reading', field: 'wattHoursNetWh', presentation: 'number', size: 'compact' },
          { id: 'net-ah', kind: 'reading', field: 'ampHoursNetAh', presentation: 'trend', size: 'compact' },
        ],
      },
      liveWidgetSlots: ['themeToggle', 'bmsStateOfCharge', 'wattHoursNetWh', 'ampHoursNetAh', 'maxSpeedKph'],
    },
  });
  assert.deepEqual(
    (await client.request('state.get', {})).savedDevices.find((b) => b.savedDeviceId === profile.savedDeviceId)
      ?.appearance,
    layoutProfile.values.appearance
  );
  for (const appearance of [
    { ...defaultBoardAppearance, rail: 7 },
    { ...defaultBoardAppearance, rubber: 'red' },
    { ...defaultBoardAppearance, hooks: 2 },
    { rail: 1 },
  ]) {
    await expectError(
      client.request('boardProfile.update', {
        savedDeviceId: profile.savedDeviceId,
        expectedRevision: layoutProfile.revision,
        patch: { appearance },
      }),
      'invalid_request'
    );
  }
  for (const invalid of [
    null,
    [],
    ['empty', 'empty', 'empty', 'unknown', 'empty'],
    ['empty', 'empty', 'empty', 'empty', 4],
  ]) {
    await expectError(
      client.request('boardProfile.update', {
        savedDeviceId: profile.savedDeviceId,
        expectedRevision: layoutProfile.revision,
        patch: { liveWidgetSlots: invalid } as Record<string, unknown>,
      }),
      'invalid_request'
    );
  }
  assert.deepEqual(await client.request('boardProfile.get', { savedDeviceId: profile.savedDeviceId }), layoutProfile);

  assert.equal(layoutProfile.values.lastLiveView, 'custom');
  for (const lastLiveView of ['unknown', 1, {}, ['normal']]) {
    await expectError(
      client.request('boardProfile.update', {
        savedDeviceId: profile.savedDeviceId,
        expectedRevision: layoutProfile.revision,
        patch: { lastLiveView },
      }),
      'invalid_request'
    );
  }
  assert.deepEqual(await client.request('boardProfile.get', { savedDeviceId: profile.savedDeviceId }), layoutProfile);
  assert.equal(layoutProfile.values.customDashboard?.widgets.length, 7);
  assert.deepEqual(layoutProfile.values.customDashboard?.widgets[1]?.size, { columns: 4, rows: 1 });
  for (const customDashboard of [
    { version: 1, widgets: [{ id: 'mark', kind: 'action', action: 'unknown', size: 'compact' }] },
    {
      version: 1,
      widgets: [{ id: 'theme', kind: 'reading', field: 'themeToggle', presentation: 'number', size: 'compact' }],
    },
    { version: 1, widgets: [{ id: 'mark', kind: 'action', action: 'rideMarker', size: 'compact', control: 'leds' }] },
    ...[
      {},
      { columns: 1 },
      { columns: 0, rows: 1 },
      { columns: 5, rows: 1 },
      { columns: 1, rows: 5 },
      { columns: 1.5, rows: 1 },
      { columns: '1', rows: 1 },
      { columns: 1, rows: 1, extra: true },
    ].map((size) => ({ version: 1, widgets: [{ id: 'invalid-size', kind: 'control', control: 'leds', size }] })),
    { version: 2, widgets: [] },
    { version: 1, widgets: [], extra: true },
    { version: 1, widgets: [{ id: 'x', kind: 'control', control: 'leds', size: 'giant' }] },
    {
      version: 1,
      widgets: [{ id: 'x', kind: 'reading', field: 'headlights', presentation: 'gauge', size: 'compact' }],
    },
    {
      version: 1,
      widgets: [
        {
          id: 'x',
          kind: 'reading',
          field: 'speedKph',
          presentation: 'bar',
          size: 'compact',
          range: { min: 70, max: 60 },
        },
      ],
    },
    {
      version: 1,
      widgets: Array.from({ length: 25 }, (_, i) => ({
        id: `w${i}`,
        kind: 'visual',
        visual: 'battery',
        size: 'compact',
      })),
    },
    {
      version: 1,
      widgets: Array.from({ length: 2 }, () => ({
        id: 'duplicate',
        kind: 'visual',
        visual: 'battery',
        size: 'compact',
      })),
    },
  ]) {
    await expectError(
      client.request('boardProfile.update', {
        savedDeviceId: profile.savedDeviceId,
        expectedRevision: layoutProfile.revision,
        patch: { customDashboard },
      }),
      'invalid_request'
    );
  }
  assert.deepEqual(await client.request('boardProfile.get', { savedDeviceId: profile.savedDeviceId }), layoutProfile);

  const current = await client.request('state.get', {});
  const firstPage = await client.request('session.list', { savedDeviceId: profileDevice.savedDeviceId, limit: 1 });
  const session = required(firstPage.items[0], 'connections did not create a session');
  assert.ok(firstPage.items.length <= 1);
  if (firstPage.nextCursor) {
    const secondPage = await client.request('session.list', {
      savedDeviceId: profileDevice.savedDeviceId,
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    assert.ok(secondPage.items.length <= 1);
    assert.notEqual(secondPage.items[0]?.sessionId, firstPage.items[0]?.sessionId);
  }
  const detail = await client.request('session.get', {
    sessionId: session.sessionId,
  });
  assert.equal(detail.summary.sessionId, session.sessionId);
  assert.ok(detail.fields.length > 0 && detail.fields.length <= 64);
  assert.ok(Number.isSafeInteger(detail.snapshot.historyRevision));
  assert.ok(detail.storedSampleCount <= detail.recordedSampleCount);
  assert.doesNotMatch(JSON.stringify(detail), /controllerUuid|controllerUUID|launchToken|bluetoothIdentifier/);
  const historyRange = { startElapsedMs: 0, endElapsedMs: detail.snapshot.committedElapsedMs };
  const originalMarkers = await client.sessionData({
    kind: 'markers',
    sessionId: session.sessionId,
    snapshot: detail.snapshot,
    range: historyRange,
    limit: 256,
  });
  assert.equal(detail.markerCount, 2);
  assert.ok(Number.isSafeInteger(detail.connectionContextCount));
  assert.ok(Array.isArray(detail.recordingBreaks) && detail.recordingBreaks.length <= 1000);
  const originalContexts = await client.sessionData({
    kind: 'connectionContexts',
    sessionId: session.sessionId,
    snapshot: detail.snapshot,
    range: historyRange,
    limit: 64,
  });
  assert.equal(originalContexts.kind, 'connectionContexts');
  if (originalContexts.kind === 'connectionContexts') {
    assert.ok(originalContexts.contexts.length <= detail.connectionContextCount);
    assert.doesNotMatch(JSON.stringify(originalContexts), /controllerUuid|bluetoothIdentifier|operationId/);
  }

  const field = detail.fields[0]?.name;
  assert.ok(field, 'session metadata did not publish a numeric field');
  const overview = await client.sessionData({
    kind: 'series',
    sessionId: session.sessionId,
    snapshot: detail.snapshot,
    range: historyRange,
    fields: [field],
    buckets: 16,
    gapPolicy: { thresholdSeconds: null },
  });
  assert.equal(overview.kind, 'series');
  // Every advertised numeric field must be readable alongside its neighbours.
  // A missing transport allowlist entry (such as recorded BMS temperatures)
  // otherwise rejects a whole chart batch, including voltage and speed.
  for (let offset = 0; offset < detail.fields.length; offset += MAX_SESSION_DATA_FIELDS) {
    const fields = detail.fields.slice(offset, offset + MAX_SESSION_DATA_FIELDS).map((descriptor) => descriptor.name);
    const group = await client.sessionData({
      kind: 'series',
      sessionId: session.sessionId,
      snapshot: detail.snapshot,
      range: historyRange,
      fields,
      buckets: 16,
      gapPolicy: { thresholdSeconds: null },
    });
    assert.equal(group.kind, 'series');
    if (group.kind === 'series')
      assert.deepEqual(
        group.fields.map((descriptor) => descriptor.name),
        fields
      );
  }
  const samples = await client.sessionData({
    kind: 'samples',
    sessionId: session.sessionId,
    snapshot: detail.snapshot,
    range: historyRange,
    fields: [field],
    mode: 'window',
    limit: 100,
  });
  assert.equal(samples.kind, 'samples');
  if (samples.nextCursor) {
    const continuation = await client.sessionData({
      kind: 'samples',
      sessionId: session.sessionId,
      snapshot: detail.snapshot,
      range: historyRange,
      fields: [field],
      mode: 'window',
      limit: 100,
      cursor: samples.nextCursor,
    });
    assert.equal(continuation.kind, 'samples');
    const sampleElapsed = samples.elapsedMs.at(-1) ?? -1;
    const sampleSequence = samples.sequence.at(-1) ?? -1;
    assert.ok(
      continuation.elapsedMs.every(
        (elapsed, index) =>
          elapsed > sampleElapsed || (elapsed === sampleElapsed && continuation.sequence[index]! > sampleSequence)
      )
    );
  }
  const events = await client.sessionData({
    kind: 'events',
    sessionId: session.sessionId,
    snapshot: detail.snapshot,
    range: historyRange,
    limit: 100,
  });
  assert.equal(events.kind, 'events');
  if (events.nextCursor) {
    const eventContinuation = await client.sessionData({
      kind: 'events',
      sessionId: session.sessionId,
      snapshot: detail.snapshot,
      range: historyRange,
      limit: 100,
      cursor: events.nextCursor,
    });
    assert.equal(eventContinuation.kind, 'events');
    const eventElapsed = events.page.elapsedMs.at(-1) ?? -1;
    const eventSequence = events.page.sequence.at(-1) ?? -1;
    assert.ok(
      eventContinuation.page.elapsedMs.every(
        (elapsed, index) =>
          elapsed > eventElapsed ||
          (elapsed === eventElapsed && eventContinuation.page.sequence[index]! > eventSequence)
      )
    );
  }
  await expectSessionDataFailure(
    client,
    {
      kind: 'samples',
      sessionId: session.sessionId,
      snapshot: { ...detail.snapshot, historyRevision: detail.snapshot.historyRevision + 1 },
      range: historyRange,
      fields: [field],
      mode: 'window',
      limit: 1,
    },
    'stale revision'
  );
  const prunePreview = await client.request('session.prune.preview', {
    scope: 'one',
    sessionId: session.sessionId,
    targetResolutionSeconds: 5,
  });
  assert.equal(prunePreview.operation.kind, 'prunePreview');
  assert.equal(prunePreview.operation.status, 'completed');
  assert.ok(prunePreview.estimatedStoredSampleCount <= prunePreview.recordedSampleCount);
  const prune = await client.request('session.prune.start', {
    scope: 'one',
    sessionId: session.sessionId,
    targetResolutionSeconds: 5,
  });
  assert.equal(prune.kind, 'prune');
  assert.ok(['queued', 'running', 'reclaiming', 'completed'].includes(prune.status));
  if (prune.status !== 'completed') {
    const observed = await client.request('state.get', {});
    if (
      !observed.sessionOperation ||
      observed.sessionOperation.operationId !== prune.operationId ||
      !['completed', 'cancelled', 'failed'].includes(observed.sessionOperation.status)
    ) {
      const terminal = await client.waitForState(
        (value) => {
          const operation = value.sessionOperation;
          return (
            operation?.operationId === prune.operationId &&
            ['completed', 'cancelled', 'failed'].includes(operation.status)
          );
        },
        { afterRevision: observed.revision }
      );
      assert.ok(terminal.sessionOperation);
    }
  }
  assert.ok(Number.isSafeInteger(prune.completedSessions));
  const afterPrune = await client.request('session.get', { sessionId: session.sessionId });
  assert.ok(afterPrune.snapshot.historyRevision >= detail.snapshot.historyRevision);
  const prunedMarkers = await client.sessionData({
    kind: 'markers',
    sessionId: session.sessionId,
    snapshot: afterPrune.snapshot,
    range: historyRange,
    limit: 256,
  });
  assert.equal(afterPrune.markerCount, detail.markerCount);
  assert.equal(afterPrune.connectionContextCount, detail.connectionContextCount);
  assert.deepEqual(afterPrune.recordingBreaks, detail.recordingBreaks);
  const prunedContexts = await client.sessionData({
    kind: 'connectionContexts',
    sessionId: session.sessionId,
    snapshot: afterPrune.snapshot,
    range: historyRange,
    limit: 64,
  });
  if (originalContexts.kind === 'connectionContexts' && prunedContexts.kind === 'connectionContexts')
    assert.deepEqual(prunedContexts.contexts, originalContexts.contexts);

  if (originalMarkers.kind === 'markers' && prunedMarkers.kind === 'markers')
    assert.deepEqual(prunedMarkers.markers, originalMarkers.markers);

  const cancelledPrune = await client.request('session.prune.cancel', { operationId: prune.operationId });
  assert.ok(['completed', 'cancelled'].includes(cancelledPrune.status));
  const csvExport = await client.request('session.export', {
    sessionId: session.sessionId,
    format: 'csv',
  });
  assert.ok(csvExport.fileName.endsWith('.csv.zip'));
  await expectError(
    client.request('session.export', {
      savedDeviceId: profileDevice.savedDeviceId,
      sessionId: session.sessionId,
      format: 'csv',
    } as never),
    'invalid_request'
  );
  await expectError(client.request('session.export', { format: 'csv' } as never), 'invalid_request');

  await expectError(client.request('session.get', { sessionId: 'missing-session' }), 'not_found');

  const beforeDelete = await client.request('state.get', {});
  const storageBeforeDelete = beforeDelete.savedDevices.find(
    (board) => board.savedDeviceId === profileDevice.savedDeviceId
  )!.summary.totalStorageBytes;
  assert.ok(storageBeforeDelete !== null && storageBeforeDelete > 0);
  await client.request('session.delete', { sessionId: session.sessionId });
  const deleted = await client.request('session.list', { savedDeviceId: profileDevice.savedDeviceId, limit: 100 });
  assert.ok(!deleted.items.some((item) => item.sessionId === session.sessionId));
  const afterDelete = await client.request('state.get', {});
  const storageAfterDelete = afterDelete.savedDevices.find(
    (board) => board.savedDeviceId === profileDevice.savedDeviceId
  )!.summary.totalStorageBytes;
  assert.ok(storageAfterDelete !== null && storageAfterDelete < storageBeforeDelete);
  await client.request('device.connect', { deviceId: device.deviceId, trackingMode: 'saved' });
  const withLayout = await client.waitForState((s) => s.activeConnection?.state === 'ready');
  assert.deepEqual(withLayout.activeConnection!.liveWidgetSlots, layoutProfile.values.liveWidgetSlots);
  await client.request('device.disconnect', {});
  await client.request('device.connect', { deviceId: device.deviceId, trackingMode: 'guest' });
  const guestLayout = await client.waitForState((s) => s.activeConnection?.state === 'ready');
  assert.deepEqual(guestLayout.activeConnection!.liveWidgetSlots, guestLayout.settings.liveWidgetSlots);
  await client.request('device.disconnect', {});
  assert.deepEqual(
    (await client.request('boardProfile.get', { savedDeviceId: profile.savedDeviceId })).values.liveWidgetSlots,
    layoutProfile.values.liveWidgetSlots
  );
}

async function expectSessionDataFailure(
  client: ConformanceClient,
  request: Parameters<ConformanceClient['sessionData']>[0],
  label: string
) {
  await assert.rejects(client.sessionData(request), () => true, label);
}

async function createCompletedSession(
  client: ConformanceClient,
  deviceId: string,
  expectSoftwareBms: boolean,
  recreateFrontend?: () => Promise<void>,
  verifyRouteAltitude = false
) {
  await client.request('bluetooth.scan', { timeoutMs: 100 });
  const before = await client.request('state.get', {});
  assert.ok(
    before.discoveredDevices.some((device) => device.deviceId === deviceId),
    'scan did not rediscover the session device'
  );
  await client.request('device.connect', { deviceId, trackingMode: 'saved' });
  let connected = await client.waitForState(
    (value) => value.activeConnection?.deviceId === deviceId && value.activeConnection.state === 'ready',
    { afterRevision: before.revision }
  );
  if (expectSoftwareBms && connected.activeConnection?.bms.status !== 'attached') {
    connected = await client.waitForState(
      (value) =>
        value.activeConnection?.deviceId === deviceId &&
        value.activeConnection.state === 'ready' &&
        value.activeConnection.bms.status === 'attached',
      { afterRevision: connected.revision }
    );
  }
  assertState(connected);
  assert.ok(connected.activeConnection);
  assert.equal(connected.activeConnection.deviceKind, 'board');
  const savedDeviceId = connected.activeConnection.savedDeviceId;
  assert.equal(connected.activeConnection.displayName, connected.activeConnection.name);
  assert.ok(connected.activeConnection.savedDeviceId);
  assert.ok(connected.activeConnection.activeSession);
  await exerciseBatteryEstimate(client, connected);
  if (recreateFrontend) {
    const beforeRecreation = await client.request('state.get', {});
    await recreateFrontend();
    assert.equal(
      (await client.request('state.get', {})).settings.accentPreference,
      beforeRecreation.settings.accentPreference
    );
    assert.deepEqual(
      (await client.request('state.get', {})).settings.sessionDisplayOptions,
      beforeRecreation.settings.sessionDisplayOptions
    );
    const afterRecreation = await client.waitForState(
      (state) =>
        (state.activeConnection?.latestSample?.sequence ?? 0) >
        (beforeRecreation.activeConnection?.latestSample?.sequence ?? 0),
      { afterRevision: beforeRecreation.revision, timeoutMs: 10_000 }
    );
    assert.equal(
      afterRecreation.activeConnection?.activeSession?.sessionId,
      beforeRecreation.activeConnection?.activeSession?.sessionId,
      'frontend recreation replaced the recording session'
    );
    assert.equal(afterRecreation.activeConnection?.state, 'ready');
  }
  assert.ok(connected.activeConnection.controllerConnection);
  assert.ok(
    connected.activeConnection.controllerConnection.kind === 'direct' ||
      (connected.activeConnection.controllerConnection.kind === 'can' &&
        connected.activeConnection.controllerConnection.canId >= 0 &&
        connected.activeConnection.controllerConnection.canId <= 253)
  );
  assert.deepEqual(connected.activeConnection.controllerCandidates, []);
  assert.equal(connected.activeConnection.connectionIssue, null);
  if (expectSoftwareBms) {
    assert.deepEqual(connected.activeConnection.bms.connection, { kind: 'can', canId: 42 });
    assert.equal(connected.activeConnection.bms.status, 'attached');
    assert.equal(connected.activeConnection.bms.latestSnapshot?.reportedCanId, 42);
    assert.equal(connected.activeConnection.bms.latestSnapshot?.status, 'OK');
  }
  if (connected.activeConnection.currentLimits) {
    const limits = connected.activeConnection.currentLimits;
    assert.deepEqual(Object.keys(limits).sort(), [
      'batteryCurrentMaxA',
      'batteryCurrentMinA',
      'batterySeriesCells',
      'motorCurrentMaxA',
      'motorCurrentMinA',
    ]);
    for (const value of Object.values(limits).filter((value) => value != null)) {
      assert.ok(Number.isFinite(value));
      assert.ok(Math.abs(value) > 0);
    }
  }
  await exerciseRefloatConfiguration(client, connected);
  if (connected.activeConnection.latestSample) {
    const sample = connected.activeConnection.latestSample;
    assert.ok(Number.isSafeInteger(sample.ridingElapsedMs) && sample.ridingElapsedMs >= 0);
    assert.ok(sample.ridingElapsedMs <= sample.elapsedMs);
    assert.ok(sample.distanceM != null && Number.isFinite(sample.distanceM) && sample.distanceM >= 0);
    assert.ok(sample.maxSpeedKph != null && Number.isFinite(sample.maxSpeedKph));
    assert.ok(sample.maxSpeedKph >= Math.abs(sample.speedKph ?? 0));
    assert.deepEqual(Object.keys(connected.activeConnection.latestSample).sort(), [
      'alertReason',
      'ampHoursChargedAh',
      'ampHoursDrawnAh',
      'atrAccelerationDifferenceErpmPerSecond',
      'atrSetpointDeg',
      'atrSpeedBoost',
      'balancePitchDeg',
      'batteryCurrentA',
      'batteryLevel',
      'boosterCurrentA',
      'brakeTiltSetpointDeg',
      'charging',
      'chargingCurrentA',
      'chargingVoltageV',
      'controllerTempC',
      'darkride',
      'directionalMotorCurrentA',
      'distanceM',
      'dutyCycle',
      'elapsedMs',
      'erpm',
      'extensions',
      'fatalErrorLatched',
      'faultHistory',
      'fieldWeakeningCurrentA',
      'filteredMotorCurrentA',
      'firmwareFault',
      'footpadAdc1V',
      'footpadAdc2V',
      'footpadState',
      'imuTimeoutActive',
      'imuTimeoutHistory',
      'lastFirmwareFault',
      'load',
      'maxSpeedKph',
      'motorCurrentA',
      'motorTempC',
      'observedAt',
      'odometerM',
      'packVoltageV',
      'packageMode',
      'packageState',
      'pitchDeg',
      'remoteInput',
      'remoteSetpointDeg',
      'requestedBalanceCurrentA',
      'rideState',
      'ridingElapsedMs',
      'rollDeg',
      'sequence',
      'setpointAdjustment',
      'setpointDeg',
      'slowObservedAt',
      'speedKph',
      'stopCondition',
      'torqueTiltSetpointDeg',
      'turnTiltSetpointDeg',
      'wattHoursChargedWh',
      'wattHoursDrawnWh',
      'wheelslip',
    ]);
  }
  const faults = connected.activeConnection.latestSample?.faultHistory;
  if (faults) {
    assert.ok(faults.length <= 20);
    for (const fault of faults) {
      assert.ok(Number.isInteger(fault.code) && fault.code > 0 && fault.code <= 255);
      assert.ok(fault.elapsedMs === null || (fault.elapsedMs >= 0 && fault.elapsedMs <= fault.observedElapsedMs));
    }
  }
  if (connected.activeConnection.refloatControls?.status === 'ready') {
    const controls = connected.activeConnection.refloatControls;
    if (controls.packageEnabled !== null && connected.activeConnection.latestSample?.rideState === 'idle') {
      const idempotent = await client.request('refloat.control.set', {
        control: 'package',
        enabled: controls.packageEnabled,
      });
      assert.deepEqual(idempotent, controls, 'idempotent control request changed authoritative state');
    }
    if (controls.fatalErrorClearable) {
      try {
        const cleared = await client.request('refloat.fatalError.clear', {});
        assert.equal(cleared.fatalErrorLatched, false);
        assert.equal(cleared.pendingAction, null);
      } catch (error) {
        if (!(error instanceof ConformanceError) || error.error.code !== 'invalid_state') throw error;
        const changed = await client.request('state.get', {});
        assert.ok(changed.revision > connected.revision, 'fatal clear failed without an intervening state change');
        assert.equal(changed.activeConnection?.latestSample?.rideState, 'riding');
        assert.equal(changed.activeConnection?.refloatControls?.fatalErrorClearable, false);
      }
    } else {
      await expectError(client.request('refloat.fatalError.clear', {}), 'invalid_state');
    }
  }
  await expectError(client.request('controller.shutdown', { force: true } as never), 'invalid_request');
  let ridingState: AppState;
  if (connected.activeConnection.latestSample?.rideState === 'riding') {
    ridingState = connected;
  } else {
    ridingState = await client.waitForState(
      (value) =>
        value.activeConnection?.deviceId === deviceId && value.activeConnection.latestSample?.rideState === 'riding',
      { afterRevision: connected.revision }
    );
  }
  await expectError(client.request('controller.shutdown', {}), 'invalid_state');
  await expectError(client.request('device.connect', { deviceId, trackingMode: 'saved' }), 'invalid_state');
  const markerSession = required(ridingState.activeConnection?.activeSession, 'No saved marker session');
  if (verifyRouteAltitude) {
    const located = await client.waitForState((state) => Boolean(state.activeConnection?.latestLocation), {
      afterRevision: ridingState.revision - 1,
    });
    assert.equal(required(located.activeConnection?.latestLocation, 'No route fix').altitudeM, -12);
  }
  const markerOperation = '00000000-0000-4000-8000-000000000001';
  await expectError(
    client.request('session.marker.add', { sessionId: 'missing-session', operationId: markerOperation }),
    'invalid_state'
  );
  const savedMarker = await client.request('session.marker.add', {
    sessionId: markerSession.sessionId,
    operationId: markerOperation,
  });
  const retryMarker = await client.request('session.marker.add', {
    sessionId: markerSession.sessionId,
    operationId: markerOperation,
  });
  assert.deepEqual(retryMarker.marker, savedMarker.marker, 'Marker retries must be idempotent');
  assert.ok(savedMarker.snapshot.committedEventSequence >= savedMarker.marker.sequence);
  await new Promise((resolve) => setTimeout(resolve, 550));
  const secondMarker = await client.request('session.marker.add', {
    sessionId: markerSession.sessionId,
    operationId: '00000000-0000-4000-8000-000000000002',
  });
  // Recording can append between metadata and any history request. All read
  // kinds must still accept the earlier committed prefix and exclude new rows.
  const prefix = {
    sessionId: markerSession.sessionId,
    snapshot: savedMarker.snapshot,
    range: { startElapsedMs: 0, endElapsedMs: secondMarker.snapshot.committedElapsedMs },
  };
  for (const request of [
    { ...prefix, kind: 'series' as const, fields: ['speedKph'], buckets: 16, gapPolicy: { thresholdSeconds: null } },
    { ...prefix, kind: 'samples' as const, fields: ['speedKph'], mode: 'window' as const, limit: 100 },
    { ...prefix, kind: 'events' as const, limit: 100 },
    { ...prefix, kind: 'markers' as const, limit: 256 },
    { ...prefix, kind: 'connectionContexts' as const, limit: 64 },
    { ...prefix, kind: 'locations' as const, limit: 100 },
  ]) {
    const result = await client.sessionData(request);
    assert.deepEqual(result.snapshot, savedMarker.snapshot);
    if (result.kind === 'samples')
      assert.ok(result.sequence.every((sequence) => sequence <= savedMarker.snapshot.committedSampleSequence));
    if (result.kind === 'events')
      assert.ok(result.page.sequence.every((sequence) => sequence <= savedMarker.snapshot.committedEventSequence));
    if (result.kind === 'connectionContexts') {
      assert.ok(result.contexts.length > 0);
      assert.ok(result.contexts.every((event) => event.sequence <= savedMarker.snapshot.committedEventSequence));
    }
    if (result.kind === 'markers') assert.deepEqual(result.markers, [savedMarker.marker]);
    if (result.kind === 'locations') {
      assert.equal(result.locationBoundary.lastSequence, savedMarker.snapshot.committedLocationSequence);
      assert.equal(result.locationBoundary.lastElapsedMs, savedMarker.snapshot.committedLocationElapsedMs);
      if (verifyRouteAltitude) assert.ok(result.points.some((point) => point.altitudeM === -12));
    }
  }
  await assert.rejects(
    client.sessionData({
      ...prefix,
      kind: 'events',
      limit: 100,
      snapshot: { ...savedMarker.snapshot, historyRevision: savedMarker.snapshot.historyRevision + 1 },
    }),
    /HTTP 400/
  );
  await client.request('session.end', { sessionId: markerSession.sessionId });
  await client.waitForState((value) => value.activeConnection === null, {
    afterRevision: ridingState.revision,
  });
  const markerMetadata = await client.request('session.get', { sessionId: markerSession.sessionId });
  assert.equal(markerMetadata.markerCount, 2);
  const markerRequest = {
    kind: 'markers' as const,
    sessionId: markerSession.sessionId,
    snapshot: markerMetadata.snapshot,
    range: { startElapsedMs: 0, endElapsedMs: markerMetadata.summary.totalElapsedMs },
    limit: 1,
  };
  const markerPage = await client.sessionData(markerRequest);
  assert.equal(markerPage.kind, 'markers');
  if (markerPage.kind === 'markers') {
    assert.deepEqual(markerPage.markers, [savedMarker.marker]);
    assert.ok(markerPage.nextCursor);
    const next = await client.sessionData({ ...markerRequest, cursor: markerPage.nextCursor });
    assert.equal(next.kind, 'markers');
    if (next.kind === 'markers') {
      assert.deepEqual(next.markers, [secondMarker.marker]);
      assert.equal(next.nextCursor, null);
    }
    await assert.rejects(
      client.sessionData({ ...markerRequest, sessionId: 'foreign', cursor: markerPage.nextCursor }),
      /HTTP 400/
    );
    await assert.rejects(
      client.sessionData({
        ...markerRequest,
        range: { startElapsedMs: 1, endElapsedMs: markerMetadata.summary.totalElapsedMs },
        cursor: markerPage.nextCursor,
      }),
      /HTTP 400/
    );
  }
  await expectError(
    client.request('session.marker.add', { sessionId: markerSession.sessionId, operationId: markerOperation }),
    'invalid_state'
  );
  const completed = await client.request('state.get', {});
  assert.ok(savedDeviceId);
  const page = await client.request('session.list', { savedDeviceId, limit: 100 });
  assert.ok(
    page.items.some((item) => item.state === 'completed'),
    'disconnect did not retain the session'
  );
}

export async function exerciseRefloatConfiguration(
  client: ConformanceClient,
  connected: AppState,
  requireAvailable = false
) {
  const opened = await client.request('refloat.configuration.open', {});
  assert.ok(['loading', 'ready', 'unavailable'].includes(opened.availability));
  let ready = opened;
  if (opened.availability === 'unavailable') {
    if (!requireAvailable) return;
    const state = await client.waitForState(
      (value) => value.activeConnection?.refloatConfiguration?.availability !== 'unavailable',
      { afterRevision: connected.revision, timeoutMs: 15_000 }
    );
    ready = required(state.activeConnection?.refloatConfiguration, 'configuration summary disappeared');
  }
  if (ready.availability !== 'ready' || ready.pendingOperation !== null || !ready.currentLoaded) {
    const state = await client.waitForState(
      (value) => {
        const configuration = value.activeConnection?.refloatConfiguration;
        return (
          configuration?.availability === 'ready' &&
          configuration.pendingOperation === null &&
          configuration.currentLoaded
        );
      },
      { afterRevision: connected.revision, timeoutMs: requireAvailable ? 120_000 : 15_000 }
    );
    ready = required(state.activeConnection?.refloatConfiguration, 'configuration summary disappeared');
  }
  assert.equal(ready.pendingOperation, null);
  assert.equal(typeof ready.packageVersion, 'string');
  assert.equal(typeof ready.schemaFingerprint, 'string');
  assert.equal(typeof ready.wireSignature, 'number');

  const fields: RefloatConfigurationField[] = [];
  let cursor: string | null = null;
  let identity: RefloatConfigurationIdentity | undefined;
  do {
    const page: RefloatConfigurationSchemaPage = await client.request('refloat.configuration.schema', { cursor });
    identity ??= page.identity;
    assert.deepEqual(page.identity, identity);
    for (const field of page.fields) {
      assert.equal(typeof field.tunable, 'boolean', 'schema field is missing its Tune eligibility');
      assert.ok(Number.isFinite(field.editorScale) && field.editorScale > 0, 'missing editor scale');
      assert.equal(typeof field.editAsPercentage, 'boolean', 'missing editor mode');
      for (const bound of [field.wireMinimum, field.wireMaximum])
        assert.ok(bound === null || Number.isFinite(bound), 'missing encoding bound');
      if (field.type === 'double' || field.type === 'integer')
        assert.ok(field.wireMinimum !== null && field.wireMaximum !== null);
      assert.ok(
        field.heading === null || (typeof field.heading === 'string' && field.heading.trim().length > 0),
        'schema field is missing valid subsection context'
      );
    }
    fields.push(...page.fields);
    cursor = page.nextCursor;
    assert.ok(fields.length <= 512, 'configuration schema exceeded field bound');
  } while (cursor);
  assert.ok(fields.length > 0);
  assert.ok(
    fields.some((field) => field.heading !== null),
    'upstream subsection headers were discarded'
  );
  // Real firmware schemas include both booster groups with identically named controls.
  if (fields.some((field) => field.name === 'kp')) {
    for (const [name, heading] of [
      ['kp', 'PID'],
      ['booster_current', 'Booster (Acceleration)'],
      ['brkbooster_current', 'Booster (Braking)'],
    ]) {
      assert.equal(fields.find((field) => field.name === name)?.heading, heading);
    }
  }

  const brightness = fields.find((field) => field.name === 'leds.front.brightness');
  if (brightness) {
    assert.equal(brightness.editorScale, 100);
    assert.equal(brightness.wireMaximum, 3.2767);
    assert.equal(fields.find((field) => field.name === 'ki')?.wireMaximum, 0.32767);
    assert.equal(fields.find((field) => field.name === 'fault_adc_half_erpm')?.wireMaximum, 65535);
    assert.equal(brightness.precision, 0);
    assert.equal(brightness.step, 5);
  }
  assert.equal(fields.find((field) => field.name === 'tiltback_duty')?.editAsPercentage, true);

  const current = await client.request('refloat.configuration.read', { source: 'current' });
  const defaults = await client.request('refloat.configuration.read', { source: 'default', refresh: false });
  assert.deepEqual(current.identity, identity);
  assert.deepEqual(defaults.identity, identity);
  assert.equal(Object.keys(current.values).length, fields.length);
  assert.equal(Object.keys(defaults.values).length, fields.length);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(
      await client.request('refloat.configuration.read', { source: 'current', refresh: false }),
      current,
      'retained current read changed the loaded revision or values'
    );
    assert.deepEqual(
      await client.request('refloat.configuration.read', { source: 'default', refresh: false }),
      defaults,
      'retained defaults read changed the loaded revision or values'
    );
  }
  await expectError(
    client.request('refloat.configuration.read', { source: 'current', refresh: 'false' } as never),
    'invalid_request'
  );
  const currentKp = current.values.kp;
  assert.ok(
    !requireAvailable || currentKp?.type === 'double',
    'physical configuration fixture requires a numeric kp field'
  );
  const draftValues =
    currentKp?.type === 'double'
      ? {
          ...current.values,
          kp: { type: 'double' as const, value: currentKp.value + 1 },
        }
      : current.values;

  const deviceId = required(connected.activeConnection, 'active board disappeared').deviceId;
  const editorDraft: RefloatEditorDraft = {
    version: 1 as const,
    identity: current.identity,
    source: 'current' as const,
    values: draftValues,
    inputs: currentKp?.type === 'double' ? { kp: '' } : {},
    position: { sectionKey: 'Ride', search: 'gain', controlsExpanded: false, scrollTop: 123 },
  };
  await client.request('refloat.configuration.draft.set', {
    deviceId,
    baseRevision: current.revision,
    draft: editorDraft,
  });
  assert.deepEqual(await client.request('refloat.configuration.draft.get', { deviceId }), editorDraft);
  for (const draft of [
    { ...editorDraft, version: 2 },
    { ...editorDraft, unexpected: true },
    { ...editorDraft, position: { ...editorDraft.position, search: 'é'.repeat(257) } },
  ])
    await expectError(
      client.request('refloat.configuration.draft.set', {
        deviceId,
        baseRevision: current.revision,
        draft,
      } as never),
      'invalid_request'
    );
  assert.deepEqual(await client.request('refloat.configuration.draft.get', { deviceId }), editorDraft);
  await expectError(client.request('refloat.configuration.draft.get', { deviceId: 'another-board' }), 'invalid_state');
  await client.request('refloat.configuration.draft.set', {
    deviceId,
    baseRevision: current.revision,
    draft: { ...editorDraft, values: current.values, inputs: {} },
  });

  const tuneValues = Object.fromEntries(
    fields.filter((field) => field.tunable).map((field) => [field.name, current.values[field.name]!])
  );
  assert.ok(Object.keys(tuneValues).length > 0, 'Refloat schema has no portable Tune fields');

  const tune = await client.request('refloat.tune.create', {
    name: 'Conformance configuration',
    description: 'Exact-version disposable conformance record',
    identity: current.identity,
    sourceRevision: current.revision,
    values: tuneValues,
  });
  assert.equal(tune.identity.packageVersion, tunePackageVersion(current.identity.packageVersion));
  const listed = await client.request('refloat.tune.list', { identity: current.identity, limit: 1, cursor: null });
  assert.ok(listed.items.some((item) => item.tuneId === tune.tuneId));
  const family = tuneCompatibilityVersion(current.identity.packageVersion);
  if (family.endsWith('.x')) {
    const patchIdentity = { ...current.identity, packageVersion: `${family.slice(0, -1)}255` };
    const patchList = await client.request('refloat.tune.list', { identity: patchIdentity, limit: 50 });
    assert.ok(
      patchList.items.some((item) => item.tuneId === tune.tuneId),
      'compatible patch lost a saved Tune'
    );
  }

  const library = await client.request('refloat.tune.list', { identity: null, limit: 50 });
  assert.ok(library.items.some((item) => item.tuneId === tune.tuneId));
  const extra = await client.request('refloat.tune.create', {
    name: 'Pagination fixture',
    description: null,
    identity: current.identity,
    sourceRevision: current.revision,
    values: tuneValues,
  });
  const firstLibraryPage = await client.request('refloat.tune.list', { identity: null, limit: 1 });
  assert.ok(firstLibraryPage.nextCursor);
  const secondLibraryPage = await client.request('refloat.tune.list', {
    identity: null,
    limit: 1,
    cursor: firstLibraryPage.nextCursor,
  });
  assert.notEqual(firstLibraryPage.items[0]!.tuneId, secondLibraryPage.items[0]!.tuneId);
  await expectError(
    client.request('refloat.tune.list', { identity: current.identity, limit: 1, cursor: firstLibraryPage.nextCursor }),
    'invalid_request'
  );
  await client.request('refloat.tune.delete', { tuneId: extra.tuneId, expectedRevision: extra.revision });
  const otherVersion = await client.request('refloat.tune.list', {
    identity: { ...current.identity, packageVersion: 'other-version' },
    limit: 50,
  });
  assert.equal(otherVersion.items.length, 0);
  await expectError(client.request('refloat.tune.list', { limit: 50 } as never), 'invalid_request');
  assert.deepEqual(await client.request('refloat.tune.get', { tuneId: tune.tuneId }), tune);
  const updated = await client.request('refloat.tune.update', {
    tuneId: tune.tuneId,
    expectedRevision: tune.revision,
    name: 'Conformance configuration updated',
    description: null,
    values: tune.values,
  });
  await expectError(
    client.request('refloat.tune.update', {
      tuneId: tune.tuneId,
      expectedRevision: tune.revision,
      name: tune.name,
      description: tune.description,
      values: tune.values,
    }),
    'conflict'
  );

  const idle = client.currentState()?.activeConnection?.latestSample?.rideState === 'idle';
  if (idle && ready.writable) {
    try {
      const written = await client.request('refloat.configuration.write', {
        packageVersion: current.identity.packageVersion,
        schemaFingerprint: current.identity.schemaFingerprint,
        wireSignature: current.identity.wireSignature,
        baseRevision: current.revision,
        values: draftValues,
      });
      assert.deepEqual(written.identity, current.identity);
      const applied = await client.request('refloat.tune.apply', {
        tuneId: updated.tuneId,
        expectedRevision: updated.revision,
        baseRevision: written.revision,
      });
      assert.deepEqual(applied.identity, current.identity);
      const expectedApplied = { ...written.values, ...updated.values };
      assert.deepEqual(applied.values, expectedApplied, 'Tune application must replace only portable Tune fields');
      const readback = await client.request('refloat.configuration.read', { source: 'current' });
      assert.deepEqual(readback.values, expectedApplied, 'Applied Tune must persist on the controller');
    } finally {
      if (requireAvailable) {
        // Physical writes must leave the fixture's complete original configuration restored,
        // including when the write or subsequent Tune application fails.
        const latest = await client.request('refloat.configuration.read', { source: 'current' });
        await client.request('refloat.configuration.write', {
          packageVersion: current.identity.packageVersion,
          schemaFingerprint: current.identity.schemaFingerprint,
          wireSignature: current.identity.wireSignature,
          baseRevision: latest.revision,
          values: current.values,
        });
        const restored = await client.request('refloat.configuration.read', { source: 'current' });
        assert.deepEqual(restored.identity, current.identity);
        const expectedOriginal = { ...current.values };
        if (!current.identity.packageVersion.startsWith('1.0.') && 'meta.is_default' in expectedOriginal) {
          expectedOriginal['meta.is_default'] = { type: 'boolean', value: false };
        }
        assert.deepEqual(restored.values, expectedOriginal, 'physical configuration restore did not verify');
      }
    }
  } else if (
    ready.writable &&
    supportsRidingTuneApply(current.identity.packageVersion) &&
    client.currentState()?.activeConnection?.latestSample?.rideState === 'riding' &&
    client.currentState()?.activeConnection?.latestSample?.packageState === 'running' &&
    client.currentState()?.activeConnection?.latestSample?.packageMode === 'normal'
  ) {
    const applied = await client.request('refloat.tune.apply', {
      tuneId: updated.tuneId,
      expectedRevision: updated.revision,
      baseRevision: current.revision,
    });
    assert.deepEqual(applied.values, { ...current.values, ...updated.values });
    const readback = await client.request('refloat.configuration.read', { source: 'current' });
    assert.deepEqual(readback.values, applied.values, 'Riding Tune application must verify by readback');
  } else {
    await expectError(
      client.request('refloat.tune.apply', {
        tuneId: updated.tuneId,
        expectedRevision: updated.revision,
        baseRevision: current.revision,
      }),
      'invalid_state'
    );
  }
  await client.request('refloat.tune.delete', { tuneId: updated.tuneId, expectedRevision: updated.revision });
  await expectError(client.request('refloat.tune.get', { tuneId: updated.tuneId }), 'not_found');
}

const stableConnectionIssueCodes = new Set<ConnectionIssueCode>([
  'transport_setup_failed',
  'identification_timeout',
  'no_controller_found',
  'too_many_can_devices',
  'too_many_controllers',
  'preferred_controller_unavailable',
  'controller_changed',
  'unsupported_controller',
  'unsupported_refloat',
  'refloat_info_invalid',
]);

export function assertState(state: AppState) {
  const calibration = state.speedCalibration;
  assert.ok(
    [
      'inactive',
      'waitingGps',
      'waitingBoard',
      'lowSpeed',
      'gpsUncertain',
      'speedChanging',
      'speedMismatch',
      'collecting',
      'needsMoreMeasurements',
      'inconsistentMeasurements',
      'ready',
    ].includes(calibration.measurementStatus)
  );
  assert.ok(['idle', 'collecting', 'refining', 'ready', 'insufficient', 'applied'].includes(calibration.status));
  assert.ok(
    Number.isInteger(calibration.acceptedSamples) &&
      calibration.acceptedSamples >= 0 &&
      calibration.acceptedSamples <= 180
  );
  for (const mm of [calibration.currentDiameterMm, calibration.startingDiameterMm, calibration.recommendedDiameterMm])
    assert.ok(mm === null || (Number.isFinite(mm) && mm >= 100 && mm <= 600));
  assert.ok(
    Number.isInteger(calibration.progressPercent) &&
      calibration.progressPercent >= 0 &&
      calibration.progressPercent <= 100
  );
  if (calibration.status === 'collecting') assert.ok(calibration.progressPercent <= 95);
  if (['refining', 'ready', 'applied'].includes(calibration.status)) {
    assert.equal(calibration.progressPercent, 100);
    assert.notEqual(calibration.recommendedDiameterMm, null);
  }
  if (calibration.status === 'refining') assert.equal(calibration.applyAvailable, false);
  assert.equal(calibration.minimumSpeedKph, 7.2);
  assert.equal(typeof calibration.applyAvailable, 'boolean');
  if (calibration.applyAvailable) {
    assert.equal(calibration.status, 'ready');
    assert.notEqual(calibration.recommendedDiameterMm, null);
  }

  assert.ok(['initializing', 'ready', 'unavailable'].includes(state.announcementAudio.status));
  assert.ok(['adjustable', 'automatic'].includes(state.announcementAudio.loweringControl));
  assert.equal(typeof state.announcementAudio.voiceSettingsAvailable, 'boolean');
  const load = state.activeConnection?.latestSample?.load;
  if (load) {
    assert.ok(
      [load.duty, load.motor, load.battery].every((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 1))
    );
    if (load.winner) {
      assert.equal(load[load.winner.source], load.winner.fraction);
      assert.ok([load.duty, load.motor, load.battery].every((v) => v === null || v <= load.winner!.fraction));
    }
  }
  validatePermissions(state.permissions);
  assert.equal(state.batteryCellProfiles.length, 7);
  assert.equal(new Set(state.batteryCellProfiles.map((p) => p.id)).size, 7);
  assert.ok(state.batteryCellProfiles.every((p) => p.id.length > 0 && p.label.length > 0));
  assert.equal(state.batteryPresetCatalogVersion, 'packs-2026-09-30-v1');
  assert.equal(state.batteryPresets.length, 52);
  assert.equal(new Set(state.batteryPresets.map((p) => p.id)).size, 52);
  for (const p of state.batteryPresets) {
    assert.ok(p.id.length > 0 && p.id.length <= 64);
    assert.ok([p.label, p.manufacturer, p.cellLabel].every((v) => v.length > 0 && v.length <= 128));
    assert.ok(p.seriesCount >= 1 && p.seriesCount <= 36 && p.parallelCount >= 1 && p.parallelCount <= 20);
    assert.ok(state.batteryCellProfiles.some((c) => c.id === p.batteryCellProfileId));
    assert.ok(p.nominalCapacityAh === null || (p.nominalCapacityAh >= 0.1 && p.nominalCapacityAh <= 200));
  }
  const active = state.activeConnection;
  if (active) {
    const estimate = active.batteryEstimate;
    assert.equal(estimate.catalogVersion, 'community-curves-2025-05-18-v1');
    assert.equal(estimate.sampleSequence, active.latestSample?.sequence ?? null);
    assert.ok(['load_compensated', 'load_clamped', 'voltage_only', 'unavailable'].includes(estimate.mode));
    assert.equal(typeof estimate.provisional, 'boolean');
    if (estimate.level === null) {
      assert.equal(estimate.method, null);
      assert.equal(estimate.provisional, false);
      assert.equal(estimate.mode, 'unavailable');
      assert.ok(
        ['not_configured', 'series_mismatch', 'missing_voltage', 'not_applicable'].includes(estimate.unavailableReason!)
      );
    } else {
      assert.ok(['voltage_smoothed', 'charge_integrated'].includes(estimate.method!));
      assert.ok(Number.isFinite(estimate.level) && estimate.level >= 0 && estimate.level <= 1);
      assert.equal(estimate.unavailableReason, null);
    }
    if (active.trackingMode === 'guest' || active.deviceKind === 'bms') {
      assert.equal(estimate.level, null);
      assert.equal(estimate.unavailableReason, 'not_applicable');
    }
  }
  assert.ok(Number.isSafeInteger(state.revision));
  assert.ok(Array.isArray(state.discoveredDevices));
  assert.ok(Array.isArray(state.savedDevices));
  assert.ok(Number.isSafeInteger(state.sessionCatalogRevision));
  assert.ok(state.discoveredDevices.length <= 50);
  assert.ok(state.savedDevices.length <= 50);
  assert.equal(
    new Set(state.discoveredDevices.map((device) => device.deviceId)).size,
    state.discoveredDevices.length,
    'discovered devices contain duplicate IDs'
  );
  for (const device of state.discoveredDevices) {
    assert.ok(
      device.rssi === null || Number.isSafeInteger(device.rssi),
      'discovered device RSSI is not an integer or null'
    );
    assert.ok(device.savedDeviceId === null || typeof device.savedDeviceId === 'string');
  }
  for (const board of state.savedDevices) {
    if (board.appearance !== undefined) assert.ok(validBoardAppearance(board.appearance));
    assert.ok(board.bluetoothIdentifier === null || typeof board.bluetoothIdentifier === 'string');
    assert.deepEqual(Object.keys(board.summary).sort(), [
      'mostRecentSessionAt',
      'sessionCount',
      'totalDistanceM',
      'totalRidingElapsedMs',
      'totalStorageBytes',
    ]);
    assert.ok(
      board.summary.totalStorageBytes === null ||
        (Number.isSafeInteger(board.summary.totalStorageBytes) && board.summary.totalStorageBytes >= 0)
    );
    if (board.summary.sessionCount === 0) assert.equal(board.summary.totalStorageBytes, 0);
    assert.ok(Number.isSafeInteger(board.summary.sessionCount));
    assert.ok(Number.isSafeInteger(board.summary.totalRidingElapsedMs));
    assert.ok(board.summary.totalDistanceM === null || Number.isFinite(board.summary.totalDistanceM));
  }
  assert.deepEqual(Object.keys(state.settings).sort(), [
    'accentPreference',
    'announcements',
    'autoConnectSavedDeviceId',
    'historyGapThresholdSeconds',
    'idlePersistIntervalMs',
    'idleProbeIntervalMs',
    'includeGpsLocationWhenExporting',
    'liveWidgetSlots',
    'locationRecordingEnabled',
    'minimumSessionDistance',
    'postRideTailMs',
    'reconnectDurationMs',
    'revision',
    'rideResumeWindowMinutes',
    'ridingPersistIntervalMs',
    'safetyDisclaimerAccepted',
    'sessionDisplayOptions',
    'themePreference',
    'unitPreference',
  ]);
  assert.ok(
    ['disabled', 'notDetermined', 'foregroundOnly', 'authorized', 'denied', 'restricted', 'unavailable'].includes(
      state.location.status
    )
  );
  assert.ok(['available', 'foregroundOnly', 'unavailable'].includes(state.location.backgroundCapture));
  assert.ok(['system', 'light', 'dark'].includes(state.settings.themePreference));
  assert.ok(['purple', 'blue', 'teal', 'amber', 'rose'].includes(state.settings.accentPreference));
  assert.ok(['metric', 'imperial'].includes(state.settings.unitPreference));
  assert.equal(state.settings.liveWidgetSlots.length, 5);
  assert.ok(state.settings.liveWidgetSlots.every((field) => liveWidgetFields.includes(field)));
  if (state.activeConnection) {
    assert.equal(state.activeConnection.liveWidgetSlots.length, 5);
    assert.ok(state.activeConnection.liveWidgetSlots.every((field) => liveWidgetFields.includes(field)));
  }

  if (!active) return;
  assert.ok(active.deviceKind === null || active.deviceKind === 'board' || active.deviceKind === 'bms');
  assert.ok(active.trackingMode === 'saved' || active.trackingMode === 'guest');
  if (active.trackingMode === 'guest') {
    assert.equal(active.savedDeviceId, null);
    assert.equal(active.activeSession, null);
    assert.equal(active.latestLocation, null);
  }
  const latestLocation = active.latestLocation;
  if (latestLocation) {
    assert.deepEqual(Object.keys(latestLocation).sort(), [
      'accuracyM',
      'altitudeM',
      'latitude',
      'longitude',
      'observedAt',
    ]);
    assert.ok(Number.isFinite(latestLocation.latitude));
    assert.ok(latestLocation.latitude >= -90 && latestLocation.latitude <= 90);
    assert.ok(Number.isFinite(latestLocation.longitude));
    assert.ok(latestLocation.longitude >= -180 && latestLocation.longitude <= 180);
    assert.ok(
      latestLocation.accuracyM === null || (Number.isFinite(latestLocation.accuracyM) && latestLocation.accuracyM >= 0)
    );
    assert.ok(latestLocation.altitudeM === null || Number.isFinite(latestLocation.altitudeM));
    assert.ok(typeof latestLocation.observedAt === 'string' && Number.isFinite(Date.parse(latestLocation.observedAt)));
  }
  assert.ok(active.transportFirmware === null || typeof active.transportFirmware === 'object');
  if (active.transportFirmware) {
    const transport = active.transportFirmware;
    assert.deepEqual(Object.keys(transport).sort(), ['firmwareName', 'hardwareName', 'testVersion', 'vescVersion']);
    assert.ok(transport.vescVersion.length > 0 && transport.vescVersion.length <= 32);
    assert.ok(transport.hardwareName === null || transport.hardwareName.length <= 128);
    assert.ok(transport.firmwareName === null || transport.firmwareName.length <= 128);
    assert.ok(Number.isInteger(transport.testVersion) && transport.testVersion >= 0 && transport.testVersion <= 255);
  }
  assert.ok(active.controllerCandidates.length <= 16);
  assert.deepEqual(
    active.controllerCandidates.map((candidate) => candidate.canId),
    active.controllerCandidates.map((candidate) => candidate.canId).sort((left, right) => left - right),
    'controller candidates are not sorted by CAN ID'
  );
  assert.equal(
    new Set(active.controllerCandidates.map((candidate) => candidate.canId)).size,
    active.controllerCandidates.length,
    'controller candidates contain duplicate CAN IDs'
  );
  for (const candidate of active.controllerCandidates) {
    assert.ok(Number.isInteger(candidate.canId) && candidate.canId >= 0 && candidate.canId <= 253);
    assert.deepEqual(Object.keys(candidate).sort(), [
      'canId',
      'firmwareName',
      'hardwareName',
      'vescSupported',
      'vescVersion',
    ]);
    assert.ok((candidate.hardwareName?.length ?? 0) <= 80);
    assert.ok((candidate.firmwareName?.length ?? 0) <= 80);
  }
  assert.ok(
    !JSON.stringify(active.controllerCandidates).toLowerCase().includes('uuid'),
    'controller candidates exposed a private UUID'
  );

  assert.deepEqual(Object.keys(active.bms).sort(), ['candidates', 'connection', 'latestSnapshot', 'status']);
  assert.ok(['discovering', 'not_found', 'attached', 'unavailable', 'ambiguous'].includes(active.bms.status));
  assert.ok(active.bms.candidates.length <= 16);
  assert.ok(!JSON.stringify(active.bms).toLowerCase().includes('uuid'), 'BMS state exposed a private UUID');
  for (const candidate of active.bms.candidates) {
    assert.deepEqual(Object.keys(candidate).sort(), ['connection', 'hardwareName', 'vescVersion']);
    assertBmsConnection(candidate.connection);
    assert.ok((candidate.hardwareName?.length ?? 0) <= 80);
    assert.ok(candidate.vescVersion.length <= 32);
  }
  if (active.bms.connection) assertBmsConnection(active.bms.connection);
  if (active.bms.latestSnapshot) {
    const snapshot = active.bms.latestSnapshot;
    assert.ok(snapshot.cellVoltagesV.length <= 50);
    assert.equal(snapshot.balancing.length, snapshot.cellVoltagesV.length);
    assert.ok(snapshot.temperaturesC.length <= 50);
    assert.ok(Number.isFinite(snapshot.highestCircuitryTemperatureC));
    assert.ok(snapshot.highestCircuitryTemperatureC >= snapshot.icTemperatureC);
    assert.ok(snapshot.highestCircuitryTemperatureC >= snapshot.humiditySensorTemperatureC);
    assert.ok([...snapshot.cellVoltagesV, ...snapshot.temperaturesC].every(Number.isFinite));
    assert.ok(snapshot.balancing.every((value) => typeof value === 'boolean'));
    assert.ok(snapshot.status === null || new TextEncoder().encode(snapshot.status).length <= 40);
    assert.ok(snapshot.reportedCanId >= 0 && snapshot.reportedCanId <= 253);
  }

  if (active.refloatControls) {
    const controls = active.refloatControls;
    assert.deepEqual(Object.keys(controls).sort(), [
      'fatalErrorActive',
      'fatalErrorClearAvailable',
      'fatalErrorClearable',
      'fatalErrorLatched',
      'flywheelEnabled',
      'headlightsEnabled',
      'imuTimeoutAvailable',
      'ledsEnabled',
      'lightingAvailable',
      'packageEnabled',
      'pendingAction',
      'status',
      'writable',
    ]);
    assert.ok(['loading', 'ready', 'unavailable'].includes(controls.status));
    assert.equal(typeof controls.imuTimeoutAvailable, 'boolean');
    assert.ok(
      controls.pendingAction === null ||
        ['package', 'flywheel', 'leds', 'headlights', 'clearFatalError'].includes(controls.pendingAction)
    );
    if (!controls.lightingAvailable) {
      assert.equal(controls.ledsEnabled, null);
      assert.equal(controls.headlightsEnabled, null);
    }
    if (!controls.fatalErrorClearAvailable) {
      assert.equal(controls.fatalErrorClearable, false);
    }
  }
  if (active.refloatConfiguration) {
    const configuration = active.refloatConfiguration;
    assert.deepEqual(Object.keys(configuration).sort(), [
      'availability',
      'currentLoaded',
      'defaultLoaded',
      'packageVersion',
      'pendingOperation',
      'schemaFingerprint',
      'wireSignature',
      'writable',
      'writeBlockReason',
    ]);
    assert.ok(['loading', 'ready', 'unavailable'].includes(configuration.availability));
    if (configuration.writeBlockReason === null) {
      assert.equal(active.state, 'ready');
      assert.equal(configuration.availability, 'ready');
      assert.equal(configuration.writable, true);
      assert.equal(configuration.currentLoaded, true);
      assert.equal(configuration.pendingOperation, null);
    }

    assert.ok(
      configuration.writeBlockReason === null ||
        [
          'reconnecting',
          'loading',
          'unavailable',
          'readOnly',
          'busy',
          'flywheel',
          'riding',
          'stateUnknown',
          'packageNotReady',
          'modeNotNormal',
          'currentRequired',
        ].includes(configuration.writeBlockReason)
    );
    assert.ok(
      configuration.pendingOperation === null ||
        ['schema', 'readCurrent', 'readDefault', 'write', 'applyTune'].includes(configuration.pendingOperation)
    );
    if (configuration.availability === 'ready') {
      assert.ok(configuration.packageVersion);
      assert.equal(configuration.schemaFingerprint?.length, 64);
      assert.ok(Number.isSafeInteger(configuration.wireSignature));
    }
  }

  assert.deepEqual(Object.keys(active.controllerActions).sort(), ['pendingAction', 'shutdownAvailable']);
  assert.ok(active.controllerActions.pendingAction === null || active.controllerActions.pendingAction === 'shutdown');
  if (active.controllerActions.pendingAction === 'shutdown') {
    assert.equal(active.controllerActions.shutdownAvailable, false);
  }

  assert.ok(Object.hasOwn(active, 'connectionWarning'));
  if (active.connectionWarning !== null) {
    assert.equal(active.connectionWarning.code, 'possible_can_id_conflict');
    assert.ok(active.connectionWarning.message.length > 0 && active.connectionWarning.message.length <= 1_024);
  }
  if (active.connectionIssue) {
    assert.ok(stableConnectionIssueCodes.has(active.connectionIssue.code));
    assert.ok(active.connectionIssue.message.length > 0);
    assert.ok(active.connectionIssue.message.length <= 1_024);
    const compatibility = active.connectionIssue.refloatCompatibility;
    if (compatibility) {
      assert.equal(active.connectionIssue.code, 'unsupported_refloat');
      assert.equal(active.state, 'failed');
      assert.match(compatibility.reportedVersion, /^[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:-[A-Za-z0-9.+-]+)?$/);
      assert.ok(compatibility.reportedVersion.length <= 32);
      assert.ok(compatibility.supportedVersions.length > 0 && compatibility.supportedVersions.length <= 32);
      assert.deepEqual(compatibility.supportedVersions, [
        '1.0.x',
        '1.1.x',
        '1.2.x',
        '1.3.x',
        '1.3.1-beta2',
        '1.3.1-beta3',
      ]);
      assert.equal(active.activeSession, null);
    }
  }
  if (active.state === 'ready') {
    assert.ok(active.controllerConnection, 'ready connection has no controller route');
    if (active.trackingMode === 'saved')
      assert.ok(active.activeSession, 'ready connection has no active durable session');
    else assert.equal(active.activeSession, null);
    assert.ok(active.firmware?.supported, 'ready connection has unsupported or absent firmware');
    assert.deepEqual(active.controllerCandidates, []);
    assert.equal(active.connectionIssue, null);
  } else if (active.state === 'selecting_controller') {
    assert.equal(active.controllerConnection, null);
    assert.ok(active.savedDeviceId);
    assert.ok(active.controllerCandidates.length >= 2);
    assert.equal(active.activeSession, null);
    assert.equal(active.connectionIssue, null);
  } else if (active.state === 'failed') {
    assert.ok(active.connectionIssue, 'failed connection has no stable issue');
    assert.deepEqual(active.controllerCandidates, []);
    assert.equal(active.activeSession, null);
  } else {
    assert.equal(active.connectionIssue, null);
    assert.deepEqual(active.controllerCandidates, []);
  }
}

function assertBmsConnection(connection: { kind: string; canId?: number }) {
  if (connection.kind === 'direct') {
    assert.deepEqual(Object.keys(connection), ['kind']);
    return;
  }
  assert.equal(connection.kind, 'can');
  assert.deepEqual(Object.keys(connection).sort(), ['canId', 'kind']);
  assert.ok(Number.isInteger(connection.canId) && connection.canId! >= 0 && connection.canId! <= 253);
}

async function expectError(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    return error instanceof ConformanceError && error.error.code === code;
  });
}

function required<T>(value: T | null | undefined, message: string): T {
  assert.ok(value, message);
  return value;
}

async function exerciseDiagnostics(client: ConformanceClient) {
  const initial = await client.request('state.get', {});
  await client.request('diagnostics.clear', {});
  assert.equal((await client.request('diagnostics.list', {})).incidents.length, 0);
  const captured = await client.request('diagnostics.capture', {});
  await expectError(client.request('diagnostics.capture', {}), 'unavailable');
  const report = await client.request('diagnostics.prepare', { incidentId: captured.incidentId });
  assert.ok(report.summary.length < 8192);
  assert.equal(report.complete, false);
  assert.match(report.summary, /Excludes routes/);
  await expectError(
    client.request('diagnostics.uiError', {
      category: 'exception',
      feature: 'app',
      line: null,
      column: null,
      message: 'PRIVATE',
    } as never),
    'invalid_request'
  );
  await expectError(client.request('diagnostics.prepare', { incidentId: '999999' }), 'not_found');
  const after = await client.request('state.get', {});
  assert.equal(after.revision, initial.revision);
  assert.equal(after.sessionCatalogRevision, initial.sessionCatalogRevision);
  assert.equal(after.activeConnection, null);
  await client.request('diagnostics.clear', {});
  await expectError(client.request('diagnostics.export', { reportId: report.reportId }), 'not_found');
  assert.equal((await client.request('diagnostics.list', {})).incidents.length, 0);
  // A handled error must be captured even when no frontend exception is raised.
  await expectError(
    client.request('refloat.tune.apply', {
      tuneId: 'PRIVATE-REQUEST-PARAMETER',
      expectedRevision: 1,
      baseRevision: 1,
    }),
    'not_found'
  );
  const failed = await client.request('diagnostics.list', {});
  assert.equal(failed.incidents[0]?.reason, 'backend_request_failure');
  const failedReport = await client.request('diagnostics.prepare', { incidentId: failed.incidents[0]!.incidentId });
  assert.match(failedReport.summary, /backend_request_failure/);
  assert.ok(!failedReport.summary.includes('PRIVATE-REQUEST-PARAMETER'));
  await client.request('diagnostics.clear', {});
}

export const mandatoryMethods: BackendMethod[] = [
  'permissions.recover',
  'state.get',
  'uiState.get',
  'uiState.set',
  'diagnostics.report',
  'diagnostics.list',
  'diagnostics.capture',
  'diagnostics.prepare',
  'diagnostics.export',
  'diagnostics.clear',
  'diagnostics.uiError',
  'bluetooth.requestPermission',
  'location.requestPermission',
  'location.openSettings',
  'bluetooth.scan',
  'device.connect',
  'device.selectController',
  'device.disconnect',
  'session.end',
  'session.extendPause',
  'refloat.control.set',
  'refloat.fatalError.clear',
  'controller.shutdown',
  'refloat.configuration.draft.get',
  'refloat.configuration.draft.set',
  'refloat.configuration.open',
  'refloat.configuration.schema',
  'refloat.configuration.read',
  'refloat.configuration.write',
  'refloat.tune.list',
  'refloat.tune.get',
  'refloat.tune.create',
  'refloat.tune.update',
  'refloat.tune.delete',
  'refloat.tune.apply',
  'savedDevice.update',
  'savedDevice.delete',
  'settings.update',
  'announcements.test',
  'announcements.openVoiceSettings',
  'boardProfile.get',
  'boardProfile.update',
  'session.list',
  'session.get',
  'session.marker.add',
  'session.export',
  'session.export.status',
  'session.export.cancel',
  'session.delete',
  'session.delete.cancel',
  'session.prune.preview',
  'session.prune.start',
  'session.prune.cancel',
];

async function exerciseBatteryEstimate(client: ConformanceClient, state: AppState) {
  const id = state.activeConnection!.savedDeviceId!;
  await exerciseBatteryPresets(client, id);
  const original = await client.request('boardProfile.get', { savedDeviceId: id });
  const series = state.activeConnection!.currentLimits?.batterySeriesCells ?? 18;
  const configured = await client.request('boardProfile.update', {
    savedDeviceId: id,
    expectedRevision: original.revision,
    patch: {
      batteryCellProfileId: 'generic-linear',
      batteryMinimumCellVoltageV: 3,
      seriesCount: series,
      parallelCount: 2,
    },
  });
  const estimated = await client.waitForState(
    (s) =>
      s.activeConnection?.batteryEstimate.profileRevision === configured.revision &&
      s.activeConnection.batteryEstimate.level != null,
    { afterRevision: state.revision }
  );
  assertState(estimated);
  const active = estimated.activeConnection!;
  const expected = Math.max(0, Math.min(1, (active.latestSample!.packVoltageV! / series - 3) / 1.2));
  assert.ok(Math.abs(active.batteryEstimate.level! - expected) < 1e-10);
  assert.equal(active.batteryEstimate.seriesCount, series);
  assert.equal(active.batteryEstimate.mode, 'voltage_only');
  for (const patch of [
    { batteryCellProfileId: 'unknown' },
    { batteryMinimumCellVoltageV: 4.2 },
    { batteryMinimumCellVoltageV: 2.69 },
  ]) {
    await expectError(
      client.request('boardProfile.update', { savedDeviceId: id, expectedRevision: configured.revision, patch }),
      'invalid_request'
    );
  }
  await expectError(
    client.request('boardProfile.update', {
      savedDeviceId: id,
      expectedRevision: original.revision,
      patch: { batteryCellProfileId: 'molicel-p45b' },
    }),
    'conflict'
  );
  assert.deepEqual(await client.request('boardProfile.get', { savedDeviceId: id }), configured);
  if (state.activeConnection!.currentLimits?.batterySeriesCells) {
    const mismatch = await client.request('boardProfile.update', {
      savedDeviceId: id,
      expectedRevision: configured.revision,
      patch: { seriesCount: series === 18 ? 20 : 18 },
    });
    const unavailable = await client.request('state.get', {});
    assert.equal(unavailable.activeConnection!.batteryEstimate.unavailableReason, 'series_mismatch');
    assert.equal(unavailable.activeConnection!.batteryEstimate.level, null);
    await client.request('boardProfile.update', {
      savedDeviceId: id,
      expectedRevision: mismatch.revision,
      patch: { seriesCount: series },
    });
  }
}

async function exerciseBatteryPresets(client: ConformanceClient, id: string) {
  let profile = await client.request('boardProfile.get', { savedDeviceId: id });
  const update = async (patch: Record<string, unknown>) => {
    profile = await client.request('boardProfile.update', {
      savedDeviceId: id,
      expectedRevision: profile.revision,
      patch,
    });
  };
  for (const [preset, curve, capacity] of [
    ['floatwheel-adv2-samsung-50s', 'samsung-50s', 10],
    ['fungineers-funwheel-x7s-molicel-p30b', 'generic-linear', 6],
  ] as const) {
    const revision = profile.revision;
    await update({ batteryPresetId: preset });
    assert.equal(profile.values.batteryPresetId, preset);
    assert.equal(profile.values.seriesCount, 20);
    assert.equal(profile.values.parallelCount, 2);
    assert.equal(profile.values.batteryCellProfileId, curve);
    assert.equal(profile.values.batteryCapacityAh, capacity);
    assert.equal(profile.values.batteryMinimumCellVoltageV, null);
    await expectError(
      client.request('boardProfile.update', {
        savedDeviceId: id,
        expectedRevision: revision,
        patch: { batteryPresetId: preset },
      }),
      'conflict'
    );
    for (const patch of [
      { batteryPresetId: preset, batteryCapacityAh: null },
      { batteryPresetId: 'unknown' },
      { batteryCapacityAh: 0.09 },
      { batteryCapacityAh: 201 },
      { batteryCapacityAh: '9' },
    ]) {
      await expectError(
        client.request('boardProfile.update', { savedDeviceId: id, expectedRevision: profile.revision, patch }),
        'invalid_request'
      );
    }
    assert.deepEqual(await client.request('boardProfile.get', { savedDeviceId: id }), profile);
    await update({ batteryCapacityAh: null });
    assert.equal(profile.values.batteryPresetId, preset);
    await update({ batteryPresetId: preset });
    assert.equal(profile.values.batteryCapacityAh, capacity);
    await update({ parallelCount: 3 });
    assert.equal(profile.values.batteryPresetId, null);
    assert.equal(profile.values.batteryCapacityAh, null);
  }
}

async function exerciseAnnouncements(client: ConformanceClient, initial: AppState) {
  const original = initial.settings.announcements;
  await expectError(client.request('announcements.openVoiceSettings', { uri: 'other' } as never), 'invalid_request');
  if (!initial.announcementAudio.voiceSettingsAvailable)
    await expectError(client.request('announcements.openVoiceSettings', {}), 'unavailable');
  const updated = await client.request('settings.update', {
    expectedRevision: initial.settings.revision,
    patch: {
      announcements: {
        ...original,
        speedEnabled: true,
        loadEnabled: true,
        batteryChargeEnabled: false,
        footpadEnabled: true,
        footpadDelaySeconds: 3,
        volumePercent: 0,
      },
    },
  });
  assert.equal(updated.announcements.speedEnabled, true);
  assert.equal(updated.announcements.loadEnabled, true);
  assert.equal(updated.announcements.batteryChargeEnabled, false);
  assert.equal(updated.announcements.footpadEnabled, true);
  assert.equal(updated.announcements.footpadDelaySeconds, 3);
  assert.deepEqual(await client.request('announcements.test', { kind: 'combined' }), { outcome: 'finished' });
  assert.deepEqual(await client.request('announcements.test', { kind: 'speed' }), { outcome: 'finished' });
  assert.deepEqual(await client.request('announcements.test', { kind: 'load' }), { outcome: 'finished' });
  await expectError(client.request('announcements.test', { kind: 'arbitrary' } as never), 'invalid_request');
  await expectError(
    client.request('settings.update', {
      expectedRevision: updated.revision,
      patch: { announcements: { ...updated.announcements, repeatIntervalSeconds: 0 } },
    }),
    'invalid_request'
  );
  for (const footpadDelaySeconds of [0, 6, 1.5]) {
    await expectError(
      client.request('settings.update', {
        expectedRevision: updated.revision,
        patch: { announcements: { ...updated.announcements, footpadDelaySeconds } },
      }),
      'invalid_request'
    );
  }
  if (initial.announcementAudio.loweringControl === 'automatic') {
    await expectError(
      client.request('settings.update', {
        expectedRevision: updated.revision,
        patch: { announcements: { ...updated.announcements, lowerOtherAudio: false }, unitPreference: 'imperial' },
      }),
      'unavailable'
    );
  }
  assert.equal((await client.request('state.get', {})).settings.revision, updated.revision);
  await client.request('settings.update', { expectedRevision: updated.revision, patch: { announcements: original } });
}

/** Ride ownership crosses connection and disposable frontend lifetimes. */
export async function runRideContinuityConformance(target: Target) {
  let client: ConformanceClient | undefined;
  try {
    const endpoint = await target.start();
    client = await ConformanceClient.open(endpoint.url, endpoint.origin);
    const initial = await client.request('state.get', {});
    assert.equal(initial.settings.rideResumeWindowMinutes, 60);
    assert.equal(initial.pausedRide, null);
    for (const value of [0, 1441, 1.5]) {
      await expectError(
        client.request('settings.update', {
          expectedRevision: initial.settings.revision,
          patch: { rideResumeWindowMinutes: value },
        }),
        'invalid_request'
      );
    }
    await client.request('settings.update', {
      expectedRevision: initial.settings.revision,
      patch: { safetyDisclaimerAccepted: true, rideResumeWindowMinutes: 60 },
    });
    await client.request('bluetooth.requestPermission', {});
    await client.request('bluetooth.scan', { timeoutMs: 10000 });
    const discovered = await client.waitForState((s) => s.discoveredDevices.length > 0);
    const deviceId = discovered.discoveredDevices[0]!.deviceId;
    await client.request('device.connect', { deviceId, trackingMode: 'saved' });
    const ready = await client.waitForState((s) => s.activeConnection?.state === 'ready', { timeoutMs: 20000 });
    const sessionId = required(ready.activeConnection?.activeSession?.sessionId, 'saved session');
    const travelled = await client.waitForState((s) => (s.activeConnection?.activeSession?.sampleCount ?? 0) >= 2, {
      timeoutMs: 20000,
    });
    const distance = travelled.activeConnection!.latestSample!.distanceM!;
    const peak = travelled.activeConnection!.latestSample!.maxSpeedKph!;
    assert.ok(Number.isFinite(peak) && peak >= Math.abs(travelled.activeConnection!.latestSample!.speedKph ?? 0));
    assert.ok(Math.abs(peak / 3.6 - travelled.activeConnection!.activeSession!.maxSpeedMps!) < 1e-8);
    assert.ok(Math.abs(distance - travelled.activeConnection!.activeSession!.distanceM!) < 1e-8);
    await client.request('session.marker.add', { sessionId, operationId: '00000000-0000-4000-8000-000000000099' });
    await expectError(client.request('session.extendPause', { sessionId }), 'invalid_state');
    await client.request('device.disconnect', {});
    const paused = await client.request('state.get', {});
    assert.equal(paused.activeConnection, null);
    assert.equal(paused.pausedRide?.sessionId, sessionId);
    assert.ok(Date.parse(paused.pausedRide!.resumeUntil) > Date.now() + 59 * 60_000);
    await expectError(client.request('session.extendPause', { sessionId: 'stale' }), 'invalid_state');
    await expectError(client.request('session.extendPause', { sessionId, extra: true } as never), 'invalid_request');
    const settings = paused.settings;
    await client.request('settings.update', {
      expectedRevision: settings.revision,
      patch: { rideResumeWindowMinutes: 120 },
    });
    await client.request('session.extendPause', { sessionId });
    const extended = await client.request('state.get', {});
    assert.equal(extended.activeConnection, null);
    assert.equal(extended.pausedRide?.sessionId, sessionId);
    assert.ok(extended.revision > paused.revision);
    assert.ok(Date.parse(extended.pausedRide!.resumeUntil) > Date.parse(paused.pausedRide!.resumeUntil));
    assert.ok(Date.parse(extended.pausedRide!.resumeUntil) > Date.now() + 119 * 60_000);
    await client.request('session.extendPause', { sessionId });
    const repeated = await client.request('state.get', {});
    assert.ok(Date.parse(repeated.pausedRide!.resumeUntil) >= Date.parse(extended.pausedRide!.resumeUntil));
    client.close();
    client = await ConformanceClient.open(endpoint.url, endpoint.origin);
    const replaced = await client.request('state.get', {});
    assert.equal(replaced.pausedRide?.sessionId, sessionId);
    assert.equal(replaced.pausedRide?.resumeUntil, repeated.pausedRide?.resumeUntil);
    await client.request('bluetooth.scan', { timeoutMs: 10000 });
    await client.waitForState((s) => s.discoveredDevices.some((d) => d.deviceId === deviceId));
    await client.request('device.connect', { deviceId, trackingMode: 'saved' });
    const resumed = await client.waitForState((s) => s.activeConnection?.state === 'ready', { timeoutMs: 20000 });
    assert.equal(resumed.activeConnection?.activeSession?.sessionId, sessionId);
    assert.equal(resumed.pausedRide, null);
    const continuing = await client.waitForState((s) => s.activeConnection?.latestSample != null, { timeoutMs: 20000 });
    const continuedDistance = continuing.activeConnection!.latestSample!.distanceM!;
    assert.ok(continuedDistance >= distance, 'Resuming retains accumulated ride distance');
    assert.ok(continuing.activeConnection!.latestSample!.maxSpeedKph! >= peak, 'Resuming retains peak speed');
    assert.ok(Math.abs(continuedDistance - continuing.activeConnection!.activeSession!.distanceM!) < 1e-8);
    await expectError(client.request('session.end', { sessionId: 'stale' }), 'invalid_state');
    await client.request('device.disconnect', {});
    await client.request('session.end', { sessionId });
    const ended = await client.request('state.get', {});
    assert.equal(ended.activeConnection, null);
    assert.equal(ended.pausedRide, null);
    assert.equal((await client.request('session.get', { sessionId })).summary.state, 'completed');
    await expectError(client.request('session.extendPause', { sessionId }), 'invalid_state');
    return { target: target.name, revision: ended.revision };
  } finally {
    client?.close();
    await target.stop();
  }
}

/** Focused public settings coverage for each native/shared integration. */
export async function runAnnouncementsConformance(target: Target) {
  let client: ConformanceClient | undefined;
  try {
    const endpoint = await target.start();
    client = await ConformanceClient.open(endpoint.url, endpoint.origin);
    const initial = await client.request('state.get', {});
    assert.equal(initial.settings.announcements.batteryChargeEnabled, true);
    assert.equal(initial.settings.announcements.footpadEnabled, false);
    assert.equal(initial.settings.announcements.footpadDelaySeconds, 1);
    await exerciseAnnouncements(client, initial);
    return { target: target.name, revision: (await client.request('state.get', {})).revision };
  } finally {
    client?.close();
    await target.stop();
  }
}

/** Native HTTP startup and appearance without any radio or permission interaction. */
export async function runStartupConformance(target: Target) {
  let client: ConformanceClient | undefined;
  let original: AppState['settings'] | undefined;
  try {
    const endpoint = await target.start();
    client = await ConformanceClient.open(endpoint.url, endpoint.origin);
    original = (await client.request('state.get', {})).settings;
    const address = new URL(endpoint.url);
    address.protocol = 'http:';
    address.pathname = '/';
    address.search = '';
    for (const [themePreference, accentPreference] of [
      ['dark', 'rose'],
      ['light', 'purple'],
      ['system', 'teal'],
    ] as const) {
      const state = await client.request('state.get', {});
      await client.request('settings.update', {
        expectedRevision: state.settings.revision,
        patch: { themePreference, accentPreference },
      });
      const response = await fetch(address, { signal: AbortSignal.timeout(5_000) });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const html = await response.text();
      assert.ok(html.includes(`data-startup-theme="${themePreference}"`));
      assert.ok(html.includes(`data-startup-accent="${accentPreference}"`));
      assert.ok(!html.includes('data-native-appearance'));
      await target.recreateFrontend?.();
      assert.equal(
        (await target.endpoint()).origin,
        endpoint.origin,
        'Frontend recreation must retain process listener'
      );
    }
    return { target: target.name, revision: (await client.request('state.get', {})).revision };
  } finally {
    try {
      if (client && original) {
        const state = await client.request('state.get', {});
        await client.request('settings.update', {
          expectedRevision: state.settings.revision,
          patch: {
            themePreference: original.themePreference,
            accentPreference: original.accentPreference,
          },
        });
      }
    } finally {
      client?.close();
      await target.stop();
    }
  }
}
