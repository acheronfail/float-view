import { emptySpeedCalibration } from '../src/lib/backend/contract.ts';
import type { SessionExportProgress } from '../src/lib/backend/contract.ts';
import type { ConnectionContextEvent } from '../src/lib/backend/contract.ts';
import { MockDiagnostics } from './diagnostics.ts';
import {
  supportsRidingTuneApply,
  sameRefloatTuneIdentity,
  tunePackageVersion,
} from '../src/lib/backend/refloat-tune-policy.ts';
import { validBoardAppearance } from '../src/lib/backend/board-appearance.ts';
import { validRefloatEditorDraft } from '../src/lib/backend/refloat-editor-draft.ts';
import type { RefloatEditorDraft } from '../src/lib/backend/contract.ts';
import { validUiCheckpoint } from '../src/lib/backend/ui-checkpoint.ts';
import type { UiCheckpoint } from '../src/lib/backend/contract.ts';
import { permissionInventory, locationSummary } from './permissions.ts';
import { batteryPresets, batteryPresetCatalogVersion, applyBatteryPatch } from './battery-presets.ts';
import { batteryCellProfiles, emptyEstimate, MockBattery } from './battery.ts';
import { validCustomDashboard } from '../src/lib/backend/custom-dashboard.ts';
import {
  defaultAnnouncements,
  defaultBoardAppearance,
  defaultLiveWidgetSlots,
  liveWidgetFields,
  MAX_MESSAGE_BYTES,
  MAX_REFLOAT_CONFIGURATION_CURSOR_BYTES,
  MAX_REFLOAT_CONFIGURATION_JSON_BYTES,
  MAX_REFLOAT_TUNE_DESCRIPTION_BYTES,
  MAX_REFLOAT_TUNE_CURSOR_BYTES,
  MAX_REFLOAT_TUNE_LIST_PAGE,
  MAX_REFLOAT_TUNE_NAME_BYTES,
  MAX_SESSION_LIST_CURSOR_BYTES,
  MAX_SESSION_LIST_PAGE,
  type AppState,
  type DiscoveredDevice,
  type ActiveConnection,
  type LiveWidgetSlots,
  type BoardHistorySummary,
  type BackendError,
  type BackendMethod,
  type BmsCandidate,
  type BmsSnapshot,
  type BmsState,
  type ConnectionIssueCode,
  type ControllerCandidate,
  type Request,
  type RefloatControl,
  type RefloatControls,
  type RefloatConfigurationField,
  type RefloatConfigurationIdentity,
  type RefloatConfigurationValue,
  type RefloatConfigurationWriteBlockReason,
  type RefloatTune,
  type RefloatPendingAction,
  type Response,
  type SessionMetadata,
  type SessionRecordingBreak,
  type SessionInterruptionReason,
  type SessionRideMarker,
  type SessionListPage,
  type SessionOperationState,
  type SessionPrunePreview,
  type SessionSummary,
  type StateChanged,
} from '../src/lib/backend/contract.ts';

const refloatIdentity: RefloatConfigurationIdentity = {
  packageName: 'refloat',
  packageVersion: '1.3.0',
  schemaFingerprint: '62681208dc609eb19420c89df65105f018499aa9f5741f295f00d62ea5a1bceb',
  wireSignature: 421_162_011,
};

const refloatFields: RefloatConfigurationField[] = [
  {
    name: 'tiltback_duty',
    label: 'Duty Tiltback',
    type: 'double',
    defaultValue: { type: 'double', value: 0.8 },
    minimum: 0,
    maximum: 1,
    step: 0.01,
    precision: 2,
    editorScale: 1,
    wireMinimum: -32.768,
    wireMaximum: 32.767,
    editAsPercentage: true,
    suffix: '',
    choices: [],
    description: 'Duty-cycle threshold.',
    heading: 'Duty Pushback',
    tunable: false,
  },
  {
    name: 'leds.on',
    label: 'LEDs On',
    type: 'boolean',
    defaultValue: { type: 'boolean', value: true },
    minimum: null,
    maximum: null,
    step: null,
    precision: null,
    editorScale: 1,
    wireMinimum: null,
    wireMaximum: null,
    editAsPercentage: false,
    suffix: '',
    choices: [],
    description: 'Persistent startup default.',
    heading: 'Lights',
    tunable: true,
  },
  {
    name: 'leds.headlights_on',
    label: 'Headlights On',
    type: 'boolean',
    defaultValue: { type: 'boolean', value: true },
    minimum: null,
    maximum: null,
    step: null,
    precision: null,
    editorScale: 1,
    wireMinimum: null,
    wireMaximum: null,
    editAsPercentage: false,
    suffix: '',
    choices: [],
    description: 'Persistent startup default.',
    heading: 'Headlights',
    tunable: true,
  },
  {
    name: 'meta.is_default',
    label: 'Default Marker',
    type: 'boolean',
    defaultValue: { type: 'boolean', value: true },
    minimum: null,
    maximum: null,
    step: null,
    precision: null,
    editorScale: 1,
    wireMinimum: null,
    wireMaximum: null,
    editAsPercentage: false,
    suffix: '',
    choices: [],
    description: '',
    heading: null,
    tunable: false,
  },
];

const defaultRefloatValues = Object.fromEntries(
  refloatFields.map((field) => [field.name, field.defaultValue])
) as Record<string, RefloatConfigurationValue>;

const readyRefloatControls = (overrides: Partial<RefloatControls> = {}): RefloatControls => ({
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
  ...overrides,
});

const discoveredBoard = {
  deviceId: 'mock-board',
  name: 'Float View Test VESC',
  state: 'discovered' as const,
  rssi: -48,
  lastSeenAt: '2026-01-01T00:00:00Z',
  savedDeviceId: 'saved-board' as string | null,
};

const savedBoard = {
  appearance: { ...defaultBoardAppearance },
  savedDeviceId: 'saved-board',
  deviceHistoryId: 'history-board',
  revision: 0,
  displayName: 'Float View Test VESC',
  customDisplayName: null,
  advertisedName: 'Float View Test VESC',
  bluetoothIdentifier: 'AA:BB:CC:DD:EE:FF',
  lastSeenAt: '2026-01-01T00:00:00Z',
  lastConnectedAt: null,
  profileComplete: false,
  summary: {
    sessionCount: 2,
    totalRidingElapsedMs: 100_000,
    totalDistanceM: 600,
    mostRecentSessionAt: '2026-01-01T00:02:00Z',
    totalStorageBytes: 8192 + 1200 * 256,
  } satisfies BoardHistorySummary,
};

const session: SessionSummary = {
  sessionId: 'session-1',
  deviceHistoryId: 'history-board',
  displayName: 'Float View Test VESC',
  startedAt: '2026-01-01T00:00:00Z',
  endedAt: '2026-01-01T00:01:00Z',
  state: 'completed',
  integrity: 'complete',
  sampleCount: 600,
  eventCount: 2,
  ridingElapsedMs: 50_000,
  totalElapsedMs: 60_000,
  distanceM: 300,
  maxSpeedMps: 8,
  maxDutyCycle: 0.8,
};

const secondSession: SessionSummary = {
  ...session,
  sessionId: 'session-2',
  startedAt: '2026-01-01T00:02:00Z',
  endedAt: '2026-01-01T00:03:00Z',
};

const sessionFields = Object.entries(detailedSeriesValues({}))
  .filter(([, value]) => value !== null && Number.isFinite(value))
  .map(([name]) => ({
    name,
    source:
      name === 'motorLoad' || name === 'batteryLoad' || name === 'estimatedBatteryLevel'
        ? ('extension' as const)
        : ('stable' as const),
  }));

function sessionMetadata(summary: SessionSummary): SessionMetadata {
  const hasLocation = summary.sessionId === 'session-1';
  return {
    summary,
    connectionContextCount: 0,
    markerCount: 0,
    recordingBreaks: [],
    fields: summary.sampleCount > 0 ? sessionFields : [],
    eventCount: summary.eventCount,
    recordedSampleCount: summary.sampleCount,
    storedSampleCount: summary.sampleCount,
    prune: {
      targetResolutionSeconds: null,
      recordedSampleCount: summary.sampleCount,
      storedSampleCount: summary.sampleCount,
      policy: null,
    },
    snapshot: {
      historyRevision: 0,
      committedSampleSequence: Math.max(0, summary.sampleCount - 1),
      committedEventSequence: Math.max(0, summary.eventCount - 1),
      committedElapsedMs: summary.totalElapsedMs,
      committedLocationSequence: hasLocation ? 3 : 0,
      committedLocationElapsedMs: hasLocation ? 50_000 : 0,
    },
    location: hasLocation
      ? { available: true, count: 3, lastSequence: 3, lastElapsedMs: 50_000, status: 'available' }
      : { available: false, count: 0, lastSequence: 0, lastElapsedMs: 0, status: 'disabled' },
  };
}

export function detailedSeriesValues(overrides: Record<string, number>): Record<string, number | null> {
  return {
    speedKph: 18,
    erpm: 2_900,
    pitchDeg: 1.4,
    balancePitchDeg: 1.1,
    rollDeg: 0.6,
    packVoltageV: 58.4,
    motorLoad: 0.174,
    batteryLoad: 0.168,
    dutyCycle: 0.42,
    motorCurrentA: 18.6,
    directionalMotorCurrentA: 17.9,
    filteredMotorCurrentA: 17.4,
    batteryCurrentA: 8.4,
    requestedBalanceCurrentA: 20.2,
    boosterCurrentA: 1.2,
    fieldWeakeningCurrentA: 0,
    controllerTempC: 38.2,
    motorTempC: 41.7,
    footpadAdc1V: 2.8,
    footpadAdc2V: 2.75,
    remoteInput: 0,
    setpointDeg: 1,
    atrSetpointDeg: 0.4,
    brakeTiltSetpointDeg: 0,
    torqueTiltSetpointDeg: 0.6,
    turnTiltSetpointDeg: 0,
    remoteSetpointDeg: 0,
    atrAccelerationDifferenceErpmPerSecond: 180,
    atrSpeedBoost: 0.05,
    distanceM: 0,
    odometerM: 12_345,
    ampHoursDrawnAh: 18.4,
    ampHoursChargedAh: 2.7,
    wattHoursDrawnWh: 812,
    wattHoursChargedWh: 119,
    batteryLevel: 0.68,
    estimatedBatteryLevel: 0.61,
    chargingCurrentA: 0,
    chargingVoltageV: 0,
    ...overrides,
  };
}

export class MockBackend {
  private hermesReceipts = new Map<string, string>();
  private exportProgress: SessionExportProgress | null = null;
  beginBoardExportProgress(operationId: string, savedDeviceId: string): boolean {
    const sessions = savedDeviceId === 'app' ? this.appSessionIds() : this.boardExportSessions(savedDeviceId);
    if (
      !sessions ||
      !/^[a-zA-Z0-9-]{1,128}$/.test(operationId) ||
      this.exportProgress?.operationId === operationId ||
      ['exporting', 'cancelling'].includes(this.exportProgress?.phase ?? '')
    )
      return false;
    this.exportProgress = {
      operationId,
      phase: 'exporting',
      completedSessions: 0,
      totalSessions: sessions.length,
      error: null,
    };
    return true;
  }
  advanceBoardExport(operationId: string, completed: number): boolean {
    const progress = this.exportProgress;
    if (!progress || progress.operationId !== operationId || progress.phase === 'cancelled') return false;
    progress.completedSessions = completed;
    if (completed === progress.totalSessions) progress.phase = 'ready';
    return true;
  }

  private readonly diagnostics = new MockDiagnostics();
  private refloatDrafts = new Map<string, RefloatEditorDraft>();
  private uiCheckpoint: UiCheckpoint | null = null;
  private connectionContexts = new Map<string, ConnectionContextEvent[]>();
  private recordingBreaks = new Map<string, SessionRecordingBreak[]>();
  private interruptionReasons = new Map<string, SessionInterruptionReason>();
  contextRows(sessionId: string) {
    return structuredClone(this.connectionContexts.get(sessionId) ?? []);
  }
  private captureConnectionContext(active: ActiveConnection, resumed: boolean) {
    const session = active?.activeSession;
    if (!active || !session || active.trackingMode !== 'saved' || !active.firmware || !active.controllerConnection)
      return;
    const rows = this.connectionContexts.get(session.sessionId) ?? [];
    if (resumed && rows.length) {
      const breaks = this.recordingBreaks.get(session.sessionId) ?? [];
      if (breaks.length >= 1000) throw new Error('Recording break capacity reached');
      const start = session.totalElapsedMs;
      const end = Math.max(start + 1, Date.now() - Date.parse(session.startedAt));
      breaks.push([start, end, this.interruptionReasons.get(session.sessionId) ?? 'unknown']);
      this.interruptionReasons.delete(session.sessionId);
      this.recordingBreaks.set(session.sessionId, breaks);
      session.totalElapsedMs = end;
      session.sampleCount++;
      session.eventCount++;
    }
    if (rows.length >= 1000) throw new Error('Connection history capacity reached');
    const [major = 0, minor = 0] = active.firmware.vescVersion.split('.').map(Number);
    const transport = active.transportFirmware;
    const [peerMajor = 0, peerMinor = 0] = (transport?.vescVersion ?? active.firmware.vescVersion)
      .split('.')
      .map(Number);
    rows.push({
      sequence: session.eventCount++,
      elapsedMs: session.totalElapsedMs,
      observedAtMs: Date.now(),
      context: {
        version: 1,
        refloatVersion: active.firmware.packageVersion,
        controller: {
          major,
          minor,
          testVersion: 0,
          hardwareName: active.firmware.hardwareName ?? null,
          firmwareName: null,
        },
        transport: {
          major: peerMajor,
          minor: peerMinor,
          testVersion: transport?.testVersion ?? 0,
          hardwareName: transport?.hardwareName ?? null,
          firmwareName: transport?.firmwareName ?? null,
        },
        connection: structuredClone(active.controllerConnection),
      },
    });
    this.connectionContexts.set(session.sessionId, rows);
  }
  private rideMarkers = new Map<string, SessionRideMarker[]>();
  markerRows(sessionId: string) {
    return structuredClone(this.rideMarkers.get(sessionId) ?? []);
  }

  private readonly publish: (event: StateChanged) => void;
  private readonly battery = new MockBattery();
  readonly profiles = new Map([
    [
      savedBoard.savedDeviceId,
      {
        savedDeviceId: savedBoard.savedDeviceId,
        revision: 0,
        values: { preferredBmsCanId: null } as Record<string, unknown>,
        missingFields: ['seriesCount', 'parallelCount', 'motor'],
      },
    ],
  ]);
  private nextSession = 3;
  private sessionCatalog: SessionSummary[] = [secondSession, session];
  private activeSessionId?: string;
  private pendingCandidates: ControllerCandidate[] = [];
  private advertising = true;
  private foreground = true;
  private autoConnect: 'waiting' | 'closed' | number = 'waiting';
  private autoConnectTimer?: ReturnType<typeof setTimeout>;
  private discoveryExpiryTimer?: ReturnType<typeof setTimeout>;
  private rideExpiryTimer?: ReturnType<typeof setTimeout>;
  private calibrationWritable = true;
  private calibrationDeadline: number | null = null;
  private refloatTimeoutOnce = false;
  private shutdownOutcome: 'no-op' | 'disconnect' = 'no-op';
  private refloatCurrentRevision = 1;
  private refloatCurrentValues = {
    ...defaultRefloatValues,
    'meta.is_default': { type: 'boolean', value: false },
  } satisfies Record<string, RefloatConfigurationValue>;
  private nextTune = 1;
  private readonly tunes = new Map<string, RefloatTune>();
  private state: AppState = {
    speedCalibration: { ...emptySpeedCalibration, currentDiameterMm: 280 },
    hermes: { status: 'signedOut', account: null, generation: 0, message: null },
    announcementAudio: { status: 'ready', reason: null, loweringControl: 'adjustable', voiceSettingsAvailable: false },
    revision: 0,
    bluetooth: {
      radio: 'powered_on',
      scanPermission: 'granted',
      connectPermission: 'granted',
      scanning: false,
    },
    discoveredDevices: [],
    savedDevices: [savedBoard],
    activeConnection: null,
    pausedRide: null,
    sessionCatalogRevision: 0,
    batteryCellProfiles,
    batteryPresets,
    batteryPresetCatalogVersion,
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
      accentPreference: 'teal',
      unitPreference: 'metric',
      sessionDisplayOptions: { bothFootpadsOff: false, oneFootpadOff: false },
      liveWidgetSlots: [...defaultLiveWidgetSlots],
      historyGapThresholdSeconds: null,
      locationRecordingEnabled: false,
      autoConnectSavedDeviceId: null,
      safetyDisclaimerAccepted: false,
      includeGpsLocationWhenExporting: false,
    },
    permissions: permissionInventory('ios'),
    location: {
      status: 'disabled',
      permissionAction: 'requestPermission',
      backgroundCapture: 'unavailable',
      reason: null,
    },
    sessionOperation: null,
  };

  private operation?: SessionOperationState;
  private operationTimer?: ReturnType<typeof setTimeout>;

  constructor(
    publish: (event: StateChanged) => void = () => {},
    options: {
      safetyDisclaimerAccepted?: boolean;
      autoConnectSavedDeviceId?: string | null;
      advertising?: boolean;
      initialRefloatTunes?: RefloatTune[];
    } = {}
  ) {
    this.publish = publish;
    for (const tune of (options.initialRefloatTunes ?? []).slice(0, 1000))
      this.tunes.set(tune.tuneId, {
        ...structuredClone(tune),
        identity: { ...tune.identity, packageVersion: tunePackageVersion(tune.identity.packageVersion) },
      });
    this.state.settings.safetyDisclaimerAccepted = options.safetyDisclaimerAccepted ?? false;
    this.state.settings.autoConnectSavedDeviceId = options.autoConnectSavedDeviceId ?? null;
    this.advertising = options.advertising ?? true;
    this.stepAutoConnect();
  }

  disconnectClient(owner: number) {
    this.diagnostics.disconnect(owner);
  }

  handlePayload(payload: string, owner = 0): Response {
    if (Buffer.byteLength(payload, 'utf8') > MAX_MESSAGE_BYTES) {
      return failure(0, 'invalid_request', 'Message is too large');
    }
    let value: unknown;
    try {
      value = JSON.parse(payload);
    } catch {
      return failure(0, 'invalid_request', 'Invalid JSON');
    }
    return this.handle(value, owner);
  }

  handle(value: unknown, owner = 0): Response {
    const result = this.dispatchRequest(value, owner);
    const method = value && typeof value === 'object' ? (value as { method?: unknown }).method : undefined;
    if ('error' in result && !(typeof method === 'string' && method.startsWith('diagnostics.'))) {
      this.diagnostics.recordRequestFailure();
    }
    return result;
  }

  private finishRide(sessionId: string) {
    this.interruptionReasons.delete(sessionId);
    if (this.rideExpiryTimer) clearTimeout(this.rideExpiryTimer);
    this.rideExpiryTimer = undefined;
    this.sessionCatalog = this.sessionCatalog.map((s) =>
      s.sessionId === sessionId ? { ...s, endedAt: new Date().toISOString(), state: 'completed' } : s
    );
    this.activeSessionId = undefined;
    this.change(
      {
        ...this.state,
        pausedRide: null,
        activeConnection:
          this.state.activeConnection?.activeSession?.sessionId === sessionId ? null : this.state.activeConnection,
      },
      true
    );
  }
  private scheduleRideExpiry() {
    if (this.rideExpiryTimer) clearTimeout(this.rideExpiryTimer);
    this.rideExpiryTimer = undefined;
    const ride = this.state.pausedRide;
    if (!ride) return;
    this.rideExpiryTimer = setTimeout(
      () => this.expirePausedRide(),
      Math.max(1, Date.parse(ride.resumeUntil) - Date.now())
    );
    this.rideExpiryTimer.unref?.();
  }
  private expirePausedRide() {
    const ride = this.state.pausedRide;
    if (ride && Date.now() >= Date.parse(ride.resumeUntil)) this.finishRide(ride.sessionId);
  }
  private dispatchRequest(value: unknown, owner = 0): Response {
    if (!value || typeof value !== 'object') {
      return failure(0, 'invalid_request', 'Request must be an object');
    }
    const request = value as Partial<Request>;
    if (!Number.isSafeInteger(request.id) || typeof request.method !== 'string') {
      return failure(0, 'invalid_request', 'Request ID and method are required');
    }
    const id = request.id!;
    const params = asObject(request.params);
    if (!params) return failure(id, 'invalid_request', 'Params must be an object');

    if (request.method.startsWith('diagnostics.') && request.method !== 'diagnostics.report')
      return this.diagnostics.handle(id, request.method, params, owner);
    this.expirePausedRide();
    switch (request.method as BackendMethod) {
      case 'diagnostics.report': {
        const limits = {
          snapshots: 10_000,
          max_sample_age_ms: 86_400_000,
          max_delivery_gap_ms: 86_400_000,
          max_handler_ms: 60_000,
        };
        if (
          Object.keys(params).length !== 4 ||
          Object.entries(limits).some(
            ([key, limit]) =>
              !Number.isSafeInteger(params[key]) || (params[key] as number) < 0 || (params[key] as number) > limit
          )
        )
          return failure(id, 'invalid_request', 'Invalid diagnostics summary');
        return success(id, { accepted: true });
      }
      case 'uiState.get':
        if (Object.keys(params).length) return failure(id, 'invalid_request', 'Invalid checkpoint request');
        return success(id, structuredClone(this.uiCheckpoint));
      case 'uiState.set':
        if (
          Object.keys(params).length !== 1 ||
          !('checkpoint' in params) ||
          (params.checkpoint !== null && !validUiCheckpoint(params.checkpoint))
        )
          return failure(id, 'invalid_request', 'Invalid checkpoint');
        this.uiCheckpoint = structuredClone(params.checkpoint as UiCheckpoint | null);
        return success(id, { accepted: true });
      case 'state.get':
        return success(id, this.state);
      case 'permissions.recover': {
        if (
          Object.keys(params).some((key) => !['permission', 'action'].includes(key)) ||
          !['bluetooth', 'location', 'backgroundLocation', 'notifications', 'liveUpdates'].includes(
            String(params.permission)
          ) ||
          !['requestPermission', 'openSettings'].includes(String(params.action))
        )
          return failure(id, 'invalid_request', 'Unknown permission or action');
        if (this.state.permissions.some((row) => row.pending))
          return failure(id, 'conflict', 'Permission presentation is pending');
        const row = this.state.permissions.find((row) => row.permission === params.permission);
        if (!row || row.action !== params.action)
          return failure(id, 'invalid_state', 'Permission action changed. Refresh and try again.');
        // Presentation never invents an OS grant. Tests explicitly supply later observations.
        return success(id, this.state.permissions);
      }
      case 'bluetooth.requestPermission':
        return success(id, this.state.bluetooth);
      case 'location.requestPermission':
        if (this.state.permissions.some((row) => row.pending))
          return failure(id, 'conflict', 'Permission presentation is pending');
        return success(id, this.state.location);
      case 'location.openSettings':
        if (this.state.permissions.some((row) => row.pending))
          return failure(id, 'conflict', 'Permission presentation is pending');
        if (this.state.location.permissionAction !== 'openSettings')
          return failure(id, 'invalid_state', 'Permission action changed');
        return success(id, this.state.location);
      case 'bluetooth.scan':
        if (
          this.state.permissions.some(
            (row) =>
              row.permission === 'location' &&
              !row.optional &&
              (row.status !== 'granted' || row.accuracy !== 'precise' || row.servicesEnabled !== true)
          )
        )
          return failure(
            id,
            'permission_required',
            'Precise location and Location services are required for discovery'
          );
        this.change({
          ...this.state,
          bluetooth: { ...this.state.bluetooth, scanning: false },
          discoveredDevices: [discoveredBoard],
        });
        this.scheduleDiscoveryExpiry();
        this.observeAutoConnect(discoveredBoard);
        return accepted(id);
      case 'device.connect': {
        const deviceId = string(params.deviceId);
        const trackingMode = params.trackingMode;
        if (!deviceId) return failure(id, 'invalid_request', 'deviceId is required');
        if (trackingMode !== 'saved' && trackingMode !== 'guest') {
          return failure(id, 'invalid_request', 'trackingMode must be saved or guest');
        }
        this.cancelAutoConnect();
        const active = this.state.activeConnection;
        if (active && (active.deviceId !== deviceId || active.state !== 'failed')) {
          return failure(id, 'invalid_state', 'A board is already active');
        }
        if (active && active.trackingMode !== trackingMode) {
          return failure(id, 'invalid_state', 'A retry must keep the active tracking mode');
        }
        if (!active && deviceId !== discoveredBoard.deviceId) {
          return failure(id, 'not_found', 'Device is no longer available');
        }
        const savedDeviceId =
          trackingMode === 'saved' ? (discoveredBoard.savedDeviceId ?? savedBoard.savedDeviceId) : null;
        const savedDevice = savedDeviceId
          ? this.state.savedDevices.find((value) => value.savedDeviceId === savedDeviceId)
          : undefined;
        if (trackingMode === 'saved' && !savedDevice) {
          return failure(id, 'not_found', 'Saved board is not available');
        }
        const paused = this.state.pausedRide;
        const resumable =
          trackingMode === 'saved' && paused?.savedDeviceId === savedDeviceId
            ? this.sessionCatalog.find((s) => s.sessionId === paused.sessionId)
            : undefined;
        if (paused && !resumable) this.finishRide(paused.sessionId);
        if (this.rideExpiryTimer) clearTimeout(this.rideExpiryTimer);
        this.rideExpiryTimer = undefined;
        this.activeSessionId =
          trackingMode === 'saved' ? (resumable?.sessionId ?? `session-${this.nextSession++}`) : undefined;
        if (this.discoveryExpiryTimer) clearTimeout(this.discoveryExpiryTimer);
        this.discoveryExpiryTimer = undefined;
        const activeSession: SessionSummary | null =
          resumable ??
          (this.activeSessionId
            ? {
                ...session,
                sessionId: this.activeSessionId,
                deviceHistoryId: savedDevice?.deviceHistoryId ?? session.deviceHistoryId,
                displayName: savedDevice?.displayName ?? session.displayName,
                startedAt: new Date().toISOString(),
                endedAt: null,
                state: 'active' as const,
                sampleCount: 0,
                ridingElapsedMs: 0,
                distanceM: 0,
                maxSpeedMps: null,
                totalElapsedMs: 0,
              }
            : null);
        if (activeSession && !resumable) this.sessionCatalog = [activeSession, ...this.sessionCatalog];
        this.change(
          {
            ...this.state,
            discoveredDevices: [],
            pausedRide: null,
            activeConnection: {
              ...discoveredBoard,
              state: 'ready',
              deviceKind: 'board',
              trackingMode,
              savedDeviceId,
              displayName: savedDevice?.displayName ?? discoveredBoard.name,
              controllerConnection: { kind: 'direct' },
              transportFirmware: {
                vescVersion: '6.06',
                hardwareName: 'Express',
                firmwareName: 'VESC Express',
                testVersion: 0,
              },
              controllerCandidates: [],
              connectionIssue: null,
              connectionWarning: null,
              bms: { status: 'discovering', connection: null, candidates: [], latestSnapshot: null },
              refloatControls: readyRefloatControls(),
              refloatConfiguration: {
                availability: 'ready',
                writeBlockReason: null,
                writable: true,
                packageVersion: refloatIdentity.packageVersion,
                schemaFingerprint: refloatIdentity.schemaFingerprint,
                wireSignature: refloatIdentity.wireSignature,
                currentLoaded: true,
                defaultLoaded: false,
                pendingOperation: null,
              },
              controllerActions: { shutdownAvailable: false, pendingAction: null },
              activeSession,
              latestSample: null,
              batteryEstimate: emptyEstimate(),
              batteryWarning: null,
              liveWidgetSlots: [...defaultLiveWidgetSlots],
              latestLocation: null,
              currentLimits: {
                motorCurrentMaxA: 100,
                motorCurrentMinA: -100,
                batteryCurrentMaxA: 50,
                batteryCurrentMinA: -20,
                batterySeriesCells: 18,
              },
              firmware: {
                vescVersion: '6.06',
                packageName: 'refloat',
                packageVersion: '1.3.0',
                hardwareName: 'Express',
                accessMode: 'readWrite',
                supported: true,
              },
            },
          },
          Boolean(activeSession)
        );
        return accepted(id);
      }
      case 'device.selectController': {
        const deviceId = string(params.deviceId);
        const canId = integer(params.canId);
        if (!deviceId || canId === null || canId < 0 || canId > 253) {
          return failure(id, 'invalid_request', 'Valid deviceId and CAN ID are required');
        }
        const active = this.state.activeConnection;
        const candidate = this.pendingCandidates.find((value) => value.canId === canId);
        if (
          !active ||
          active.deviceId !== deviceId ||
          active.state !== 'selecting_controller' ||
          !candidate?.vescSupported
        ) {
          return failure(id, 'invalid_state', 'Controller selection is no longer available');
        }
        if (active.trackingMode === 'saved') {
          const profile = this.profiles.get(active.savedDeviceId ?? '');
          if (!profile) return failure(id, 'invalid_state', 'Saved board is unavailable');
          const updated = {
            ...profile,
            revision: profile.revision + 1,
            values: { ...profile.values, preferredCanId: canId },
          };
          this.profiles.set(profile.savedDeviceId, updated);
        }
        this.pendingCandidates = [];
        this.change({
          ...this.state,
          activeConnection: {
            ...active,
            state: 'identifying',
            controllerConnection: { kind: 'can', canId },
            controllerCandidates: [],
            connectionIssue: null,
          },
        });
        return accepted(id);
      }
      case 'savedDevice.update': {
        const savedDeviceId = string(params.savedDeviceId);
        const expectedRevision = number(params.expectedRevision);
        const current = this.state.savedDevices.find((device) => device.savedDeviceId === savedDeviceId);
        const name = params.customDisplayName;
        if (!current || expectedRevision === null || (name !== null && typeof name !== 'string')) {
          return failure(id, 'invalid_request', 'Valid saved device update parameters are required');
        }
        if (current.revision !== expectedRevision) {
          return failure(id, 'conflict', 'Saved device revision changed');
        }
        const customDisplayName = typeof name === 'string' && name.trim() ? name.trim() : null;
        const updated = {
          ...current,
          revision: current.revision + 1,
          customDisplayName,
          displayName: customDisplayName ?? current.advertisedName ?? current.bluetoothIdentifier ?? 'Board',
        };
        this.change({
          ...this.state,
          savedDevices: this.state.savedDevices.map((device) =>
            device.savedDeviceId === savedDeviceId ? updated : device
          ),
          activeConnection:
            this.state.activeConnection?.savedDeviceId === savedDeviceId
              ? {
                  ...this.state.activeConnection,
                  name: updated.displayName,
                  displayName: updated.displayName,
                }
              : this.state.activeConnection,
        });
        return success(id, updated);
      }
      case 'savedDevice.delete': {
        const savedDeviceId = string(params.savedDeviceId);
        const current = savedDeviceId
          ? this.state.savedDevices.find((device) => device.savedDeviceId === savedDeviceId)
          : undefined;
        if (!current) return accepted(id);
        if (this.state.activeConnection?.savedDeviceId === savedDeviceId) {
          return failure(id, 'invalid_state', 'Disconnect the board before forgetting it');
        }
        this.sessionCatalog = this.sessionCatalog.filter((item) => item.deviceHistoryId !== current.deviceHistoryId);
        this.profiles.delete(current.savedDeviceId);
        this.change(
          {
            ...this.state,
            savedDevices: this.state.savedDevices.filter((device) => device.savedDeviceId !== savedDeviceId),
            settings:
              this.state.settings.autoConnectSavedDeviceId === savedDeviceId
                ? { ...this.state.settings, autoConnectSavedDeviceId: null, revision: this.state.settings.revision + 1 }
                : this.state.settings,
          },
          true
        );
        return accepted(id);
      }
      case 'session.extendPause': {
        if (Object.keys(params).length !== 1 || typeof params.sessionId !== 'string' || !params.sessionId)
          return failure(id, 'invalid_request', 'Session ID is required');
        const ride = this.state.pausedRide;
        if (!ride || ride.sessionId !== params.sessionId)
          return failure(id, 'invalid_state', 'Ride is no longer paused');
        const resumeUntil = new Date(
          Math.max(Date.parse(ride.resumeUntil), Date.now() + this.state.settings.rideResumeWindowMinutes * 60_000)
        ).toISOString();
        this.change({ ...this.state, pausedRide: { ...ride, resumeUntil } });
        this.scheduleRideExpiry();
        return accepted(id);
      }
      case 'session.end': {
        if (Object.keys(params).length !== 1 || typeof params.sessionId !== 'string')
          return failure(id, 'invalid_request', 'Session ID is required');
        if (
          this.state.activeConnection?.activeSession?.sessionId !== params.sessionId &&
          this.state.pausedRide?.sessionId !== params.sessionId
        )
          return failure(id, 'invalid_state', 'Ride is no longer current');
        this.cancelAutoConnect();
        this.finishRide(params.sessionId);
        return accepted(id);
      }
      case 'device.disconnect': {
        this.cancelAutoConnect();
        const deviceId = this.state.activeConnection?.deviceId;
        if (deviceId) this.refloatDrafts.delete(deviceId);
        if (deviceId && this.uiCheckpoint?.live?.deviceId === deviceId) this.uiCheckpoint = null;
        const activeSessionId = this.activeSessionId;
        if (activeSessionId) this.interruptionReasons.set(activeSessionId, 'pause');
        this.activeSessionId = undefined;
        const pausedRide =
          activeSessionId && this.state.activeConnection?.savedDeviceId
            ? {
                sessionId: activeSessionId,
                savedDeviceId: this.state.activeConnection.savedDeviceId,
                displayName: this.state.activeConnection.displayName ?? 'Board',
                resumeUntil: new Date(Date.now() + this.state.settings.rideResumeWindowMinutes * 60_000).toISOString(),
              }
            : null;
        this.change(
          {
            ...this.state,
            activeConnection: null,
            pausedRide,
          },
          Boolean(activeSessionId)
        );
        this.scheduleRideExpiry();
        return accepted(id);
      }
      case 'controller.shutdown':
        if (Object.keys(params).length !== 0) {
          return failure(id, 'invalid_request', 'Controller shutdown takes no parameters');
        }
        return this.shutdownController(id);
      case 'refloat.control.set': {
        if (
          Object.keys(params).sort().join(',') !== 'control,enabled' ||
          !isRefloatControl(params.control) ||
          typeof params.enabled !== 'boolean'
        ) {
          return failure(id, 'invalid_request', 'A supported control and boolean enabled value are required');
        }
        return this.setRefloatControl(id, params.control, params.enabled);
      }
      case 'refloat.fatalError.clear':
        if (Object.keys(params).length !== 0) {
          return failure(id, 'invalid_request', 'Fatal error clear takes no parameters');
        }
        return this.clearRefloatFatalError(id);
      case 'refloat.configuration.draft.get': {
        if (Object.keys(params).join(',') !== 'deviceId' || !string(params.deviceId))
          return failure(id, 'invalid_request', 'Invalid draft request');
        if (params.deviceId !== this.state.activeConnection?.deviceId || this.state.activeConnection?.state !== 'ready')
          return failure(id, 'invalid_state', 'Board is unavailable');
        return success(id, structuredClone(this.refloatDrafts.get(String(params.deviceId)) ?? null));
      }
      case 'refloat.configuration.draft.set': {
        if (
          Object.keys(params).length !== 3 ||
          Object.keys(params).some((key) => !['deviceId', 'baseRevision', 'draft'].includes(key)) ||
          !string(params.deviceId) ||
          !Number.isSafeInteger(params.baseRevision) ||
          !validRefloatEditorDraft(params.draft)
        )
          return failure(id, 'invalid_request', 'Invalid editor draft');
        if (
          params.deviceId !== this.state.activeConnection?.deviceId ||
          this.state.activeConnection?.state !== 'ready' ||
          JSON.stringify(params.draft.identity) !== JSON.stringify(refloatIdentity)
        )
          return failure(id, 'invalid_state', 'Configuration changed');
        if (params.baseRevision !== this.refloatCurrentRevision && params.baseRevision !== 1)
          return failure(id, 'conflict', 'Configuration changed');
        if (!this.refloatDrafts.has(String(params.deviceId)) && this.refloatDrafts.size >= 128)
          return failure(id, 'unavailable', 'Draft capacity reached');
        this.refloatDrafts.set(String(params.deviceId), structuredClone(params.draft));
        return success(id, { accepted: true });
      }
      case 'speedCalibration.start': {
        if (
          Object.keys(params).length !== 1 ||
          typeof params.diameterMm !== 'number' ||
          !Number.isFinite(params.diameterMm) ||
          params.diameterMm < 100 ||
          params.diameterMm > 600
        )
          return failure(id, 'invalid_request', 'Enter a valid wheel diameter');
        if (
          !this.state.activeConnection ||
          this.state.activeConnection.deviceKind !== 'board' ||
          this.state.activeConnection.state !== 'ready' ||
          ['collecting', 'refining'].includes(this.state.speedCalibration.status)
        )
          return failure(id, 'invalid_state', 'Connect a board before calibrating');
        if (
          !this.state.permissions.some(
            (p) => p.permission === 'location' && p.status === 'granted' && p.servicesEnabled !== false
          )
        )
          return failure(id, 'permission_required', 'Allow location before calibrating');
        this.calibrationDeadline = Date.now() + 180_000;
        this.change({
          ...this.state,
          speedCalibration: {
            ...emptySpeedCalibration,
            measurementStatus: 'waitingGps',
            status: 'collecting',
            currentDiameterMm: this.state.speedCalibration.currentDiameterMm,
            startingDiameterMm: this.state.speedCalibration.currentDiameterMm ?? params.diameterMm,
          },
        });
        return success(id, { accepted: true });
      }
      case 'speedCalibration.finish': {
        if (Object.keys(params).length) return failure(id, 'invalid_request', 'Unexpected parameters');
        const c = this.state.speedCalibration;
        if (c.status === 'ready' || c.status === 'applied') return success(id, { accepted: true });
        if (c.status !== 'refining' || c.recommendedDiameterMm === null)
          return failure(id, 'invalid_state', 'A reliable result is not ready');
        this.diagnostics.recordCalibrationComplete();
        this.change({ ...this.state, speedCalibration: { ...c, status: 'ready', measurementStatus: 'ready' } });
        return success(id, { accepted: true });
      }
      case 'speedCalibration.cancel': {
        if (Object.keys(params).length) return failure(id, 'invalid_request', 'Unexpected parameters');
        this.change({
          ...this.state,
          speedCalibration: {
            ...emptySpeedCalibration,
            currentDiameterMm: this.state.speedCalibration.currentDiameterMm,
          },
        });
        return success(id, { accepted: true });
      }
      case 'speedCalibration.apply': {
        if (Object.keys(params).length) return failure(id, 'invalid_request', 'Unexpected parameters');
        const c = this.state.speedCalibration;
        if (!c.applyAvailable) return failure(id, 'invalid_state', 'Wheel diameter cannot be applied');
        this.change({
          ...this.state,
          speedCalibration: {
            ...c,
            status: 'applied',
            currentDiameterMm: c.recommendedDiameterMm,
            applyAvailable: false,
            applyBlockReason: 'applied',
          },
        });
        return success(id, { accepted: true });
      }
      case 'refloat.configuration.open': {
        if (Object.keys(params).length !== 0)
          return failure(id, 'invalid_request', 'Configuration open takes no parameters');
        const summary = this.state.activeConnection?.refloatConfiguration;
        return summary ? success(id, summary) : failure(id, 'invalid_state', 'Refloat configuration is unavailable');
      }
      case 'refloat.configuration.schema': {
        if (Object.keys(params).some((key) => key !== 'cursor')) {
          return failure(id, 'invalid_request', 'Configuration schema parameters are invalid');
        }
        const summary = this.state.activeConnection?.refloatConfiguration;
        if (!summary || summary.availability !== 'ready') return failure(id, 'invalid_state', 'Schema is unavailable');
        const page = decodeRefloatPageCursor(params.cursor);
        if (page === null || page > 1) return failure(id, 'invalid_request', 'Schema cursor is invalid');
        return success(id, {
          identity: refloatIdentity,
          group: page === 0 ? 'General' : 'Lighting',
          subgroup: page === 0 ? 'Balance' : 'Startup defaults',
          fields: page === 0 ? refloatFields.slice(0, 1) : refloatFields.slice(1),
          nextCursor: page === 0 ? encodeRefloatPageCursor(1) : null,
        });
      }
      case 'refloat.configuration.read': {
        if (
          Object.keys(params).some((key) => !['source', 'refresh'].includes(key)) ||
          ('refresh' in params && typeof params.refresh !== 'boolean') ||
          (params.source !== 'current' && params.source !== 'default')
        ) {
          return failure(id, 'invalid_request', 'Configuration source must be current or default');
        }
        const active = this.state.activeConnection;
        const summary = active?.refloatConfiguration;
        if (
          !active ||
          !summary ||
          summary.availability !== 'ready' ||
          (params.refresh === false && active.state !== 'ready')
        )
          return failure(id, 'invalid_state', 'Configuration is unavailable');
        if (params.source === 'current' && active.refloatControls?.flywheelEnabled) {
          return failure(id, 'invalid_state', 'Current configuration is unavailable in flywheel mode');
        }
        const source = params.source;
        const values = source === 'current' ? this.refloatCurrentValues : defaultRefloatValues;
        if (params.refresh !== false || !(source === 'current' ? summary.currentLoaded : summary.defaultLoaded))
          this.change({
            ...this.state,
            activeConnection: {
              ...active,
              refloatConfiguration: {
                ...summary,
                currentLoaded: source === 'current' || summary.currentLoaded,
                defaultLoaded: source === 'default' || summary.defaultLoaded,
                writable: source === 'current' ? active.firmware?.accessMode === 'readWrite' : summary.writable,
              },
            },
          });
        return success(id, {
          identity: refloatIdentity,
          revision: source === 'current' ? this.refloatCurrentRevision : 1,
          source,
          values,
        });
      }
      case 'refloat.configuration.write':
        return this.writeRefloatConfiguration(id, params);
      case 'refloat.tune.list':
        return this.listRefloatTunes(id, params);
      case 'refloat.tune.get': {
        const tune = string(params.tuneId) ? this.tunes.get(String(params.tuneId)) : undefined;
        return tune ? success(id, tune) : failure(id, 'not_found', 'Tune was not found');
      }
      case 'refloat.tune.create':
        return this.createRefloatTune(id, params);
      case 'refloat.tune.update':
        return this.updateRefloatTune(id, params);
      case 'refloat.tune.delete':
        return this.deleteRefloatTune(id, params);
      case 'refloat.tune.apply': {
        const tune = string(params.tuneId) ? this.tunes.get(String(params.tuneId)) : undefined;
        if (!tune) return failure(id, 'not_found', 'Tune was not found');
        if (integer(params.expectedRevision) !== tune.revision) return failure(id, 'conflict', 'Tune revision changed');
        if (!sameRefloatTuneIdentity(tune.identity, refloatIdentity) || !validRefloatTuneValues(tune.values))
          return failure(id, 'invalid_state', 'Tune configuration is incompatible');
        return this.writeRefloatConfiguration(
          id,
          {
            packageVersion: refloatIdentity.packageVersion,
            schemaFingerprint: refloatIdentity.schemaFingerprint,
            wireSignature: refloatIdentity.wireSignature,
            baseRevision: params.baseRevision,
            values: { ...this.refloatCurrentValues, ...tune.values },
          },
          true
        );
      }
      case 'hermes.signIn':
      case 'hermes.disconnect': {
        if (Object.keys(params).length) return failure(id, 'invalid_request', 'Unexpected parameters');
        const connect = request.method === 'hermes.signIn';
        if (connect === (this.state.hermes.status === 'linked')) {
          return failure(id, connect ? 'conflict' : 'invalid_state', 'Ride Hermes account changed');
        }
        this.change({
          ...this.state,
          hermes: {
            status: connect ? 'linked' : 'signedOut',
            account: connect ? 'Demo rider' : null,
            generation: this.state.hermes.generation + 1,
            message: null,
          },
        });
        return success(id, { accepted: true });
      }
      case 'hermes.ride':
      case 'hermes.upload': {
        const upload = request.method === 'hermes.upload';
        const keys = upload ? ['sessionId', 'revision', 'generation', 'retry'] : ['sessionId'];
        if (
          !string(params.sessionId) ||
          Object.keys(params).length !== keys.length ||
          Object.keys(params).some((key) => !keys.includes(key)) ||
          (upload &&
            (integer(params.revision) === null ||
              integer(params.generation) === null ||
              typeof params.retry !== 'boolean'))
        )
          return failure(id, 'invalid_request', 'Invalid Ride Hermes request');
        if (this.state.hermes.status !== 'linked')
          return failure(id, upload ? 'conflict' : 'invalid_state', 'Sign in to Ride Hermes first');
        const found = this.findSession(params);
        if (!found) return failure(id, 'not_found', 'Session was not found');
        const metadata = sessionMetadata(found);
        const rideId = this.hermesReceipts.get(found.sessionId) ?? null;
        const reason =
          found.state === 'active' || !found.endedAt
            ? 'Finish this ride before uploading.'
            : !metadata.location.available
              ? 'This ride needs at least three recorded GPS points.'
              : (found.distanceM ?? 0) < 100
                ? 'This ride needs at least 100 metres of recorded distance.'
                : null;
        if (!upload)
          return success(id, {
            status: rideId ? 'confirmed' : 'ready',
            rideId,
            reason,
            generation: this.state.hermes.generation,
            revision: metadata.snapshot.historyRevision,
          });
        if (
          rideId ||
          params.generation !== this.state.hermes.generation ||
          params.revision !== metadata.snapshot.historyRevision
        )
          return failure(id, 'conflict', 'Ride Hermes submission changed');
        if (reason) return success(id, { accepted: false, reason });
        this.hermesReceipts.set(found.sessionId, `demo-${found.sessionId}`);
        return success(id, { accepted: true });
      }
      case 'announcements.openVoiceSettings': {
        if (Object.keys(params).length) return failure(id, 'invalid_request', 'Unexpected parameters');
        return this.state.announcementAudio.voiceSettingsAvailable
          ? success(id, { accepted: true })
          : failure(id, 'unavailable', 'System voice settings are unavailable');
      }
      case 'announcements.test': {
        if (Object.keys(params).length !== 1 || !['speed', 'load', 'combined'].includes(String(params.kind)))
          return failure(id, 'invalid_request', 'Invalid test');
        return success(id, {
          outcome:
            this.state.settings.announcements.volumePercent === 0 || this.state.announcementAudio.status === 'ready'
              ? 'finished'
              : 'unavailable',
        });
      }
      case 'settings.update': {
        const expectedRevision = number(params.expectedRevision);
        const patch = asObject(params.patch);
        if (expectedRevision === null || !patch) {
          return failure(id, 'invalid_request', 'Revision and patch are required');
        }
        if (expectedRevision !== this.state.settings.revision) {
          return failure(id, 'conflict', 'Settings revision changed');
        }
        const allowed = new Set([
          'autoConnectSavedDeviceId',
          'announcements',
          'idleProbeIntervalMs',
          'idlePersistIntervalMs',
          'ridingPersistIntervalMs',
          'postRideTailMs',
          'reconnectDurationMs',
          'rideResumeWindowMinutes',
          'minimumSessionDistance',
          'themePreference',
          'accentPreference',
          'unitPreference',
          'liveWidgetSlots',
          'sessionDisplayOptions',
          'historyGapThresholdSeconds',
          'locationRecordingEnabled',
          'safetyDisclaimerAccepted',
          'includeGpsLocationWhenExporting',
        ]);
        if ('autoConnectSavedDeviceId' in patch && patch.autoConnectSavedDeviceId !== null) {
          const target = patch.autoConnectSavedDeviceId;
          if (
            typeof target !== 'string' ||
            !target.length ||
            Buffer.byteLength(target, 'utf8') > 128 ||
            target.includes('\0')
          )
            return failure(id, 'invalid_request', 'Invalid auto-connect board');
          const board = this.state.savedDevices.find((board) => board.savedDeviceId === target);
          if (!board) return failure(id, 'not_found', 'Saved board was not found');
          if (!board.bluetoothIdentifier) return failure(id, 'invalid_state', 'Connect to the board locally first');
        }
        if ('announcements' in patch) {
          const a = patch.announcements as import('../src/lib/backend/contract.ts').AnnouncementSettings;
          if (
            !a ||
            Object.keys(a).length !== 10 ||
            typeof a.speedEnabled !== 'boolean' ||
            typeof a.loadEnabled !== 'boolean' ||
            typeof a.batteryChargeEnabled !== 'boolean' ||
            typeof a.footpadEnabled !== 'boolean' ||
            !Number.isInteger(a.footpadDelaySeconds) ||
            a.footpadDelaySeconds < 1 ||
            a.footpadDelaySeconds > 5 ||
            typeof a.lowerOtherAudio !== 'boolean' ||
            !Number.isFinite(a.speedThresholdKph) ||
            !(a.speedThresholdKph > 0 && a.speedThresholdKph <= 200) ||
            !Number.isFinite(a.loadThresholdPercent) ||
            !(a.loadThresholdPercent > 0 && a.loadThresholdPercent <= 100) ||
            !Number.isInteger(a.repeatIntervalSeconds) ||
            a.repeatIntervalSeconds < 1 ||
            a.repeatIntervalSeconds > 60 ||
            !Number.isInteger(a.volumePercent) ||
            a.volumePercent < 0 ||
            a.volumePercent > 100
          )
            return failure(id, 'invalid_request', 'Invalid announcement settings');
          if (!a.lowerOtherAudio && this.state.announcementAudio.loweringControl !== 'adjustable')
            return failure(id, 'unavailable', 'Audio lowering is automatic');
        }
        if (
          'rideResumeWindowMinutes' in patch &&
          (!Number.isInteger(patch.rideResumeWindowMinutes) ||
            (patch.rideResumeWindowMinutes as number) < 1 ||
            (patch.rideResumeWindowMinutes as number) > 1440)
        )
          return failure(id, 'invalid_request', 'Resume window must be 1–1440 whole minutes');
        const historyGap = patch.historyGapThresholdSeconds;
        if (
          !Object.keys(patch).length ||
          Object.keys(patch).some((key) => !allowed.has(key)) ||
          ('accentPreference' in patch &&
            !['purple', 'blue', 'teal', 'amber', 'rose'].includes(patch.accentPreference as string)) ||
          ('themePreference' in patch && !['system', 'light', 'dark'].includes(String(patch.themePreference))) ||
          ('sessionDisplayOptions' in patch &&
            (!patch.sessionDisplayOptions ||
              Object.keys(patch.sessionDisplayOptions).length !== 2 ||
              typeof (patch.sessionDisplayOptions as Record<string, unknown>).bothFootpadsOff !== 'boolean' ||
              typeof (patch.sessionDisplayOptions as Record<string, unknown>).oneFootpadOff !== 'boolean')) ||
          ('liveWidgetSlots' in patch &&
            (!Array.isArray(patch.liveWidgetSlots) ||
              patch.liveWidgetSlots.length !== 5 ||
              patch.liveWidgetSlots.some((field) => !liveWidgetFields.includes(field)))) ||
          ('unitPreference' in patch && !['metric', 'imperial'].includes(String(patch.unitPreference))) ||
          ('historyGapThresholdSeconds' in patch &&
            historyGap !== null &&
            (typeof historyGap !== 'number' ||
              !Number.isFinite(historyGap) ||
              historyGap < 0.1 ||
              historyGap > 3_600)) ||
          ('locationRecordingEnabled' in patch && typeof patch.locationRecordingEnabled !== 'boolean') ||
          ('safetyDisclaimerAccepted' in patch && typeof patch.safetyDisclaimerAccepted !== 'boolean') ||
          ('includeGpsLocationWhenExporting' in patch && typeof patch.includeGpsLocationWhenExporting !== 'boolean')
        ) {
          return failure(id, 'invalid_request', 'Settings patch is invalid');
        }
        const settings = {
          ...this.state.settings,
          ...patch,
          revision: this.state.settings.revision + 1,
        };
        const location = locationSummary(this.state.permissions, settings.locationRecordingEnabled);
        this.change({ ...this.state, settings, location });
        if ('autoConnectSavedDeviceId' in patch && patch.autoConnectSavedDeviceId === null) this.cancelAutoConnect();
        this.stepAutoConnect();
        return success(id, settings);
      }
      case 'boardProfile.get': {
        const profile = this.profiles.get(string(params.savedDeviceId) ?? '');
        return profile ? success(id, profile) : failure(id, 'not_found', 'Board Profile was not found');
      }
      case 'boardProfile.update': {
        const savedDeviceId = string(params.savedDeviceId);
        const expectedRevision = number(params.expectedRevision);
        const patch = asObject(params.patch);
        const current = savedDeviceId ? this.profiles.get(savedDeviceId) : undefined;
        if (savedDeviceId && !current) return failure(id, 'not_found', 'Board Profile was not found');
        if (!savedDeviceId || !current || expectedRevision === null || !patch) {
          return failure(id, 'invalid_request', 'Valid profile update parameters are required');
        }
        if (expectedRevision !== current.revision) {
          return failure(id, 'conflict', 'Board Profile revision changed');
        }
        if (patch.lastLiveView != null && !['normal', 'detailed', 'custom'].includes(patch.lastLiveView as string))
          return failure(id, 'invalid_request', 'Invalid last live view');
        if (patch.customDashboard != null && !validCustomDashboard(patch.customDashboard))
          return failure(id, 'invalid_request', 'Invalid custom dashboard');
        if (patch.appearance != null && !validBoardAppearance(patch.appearance))
          return failure(id, 'invalid_request', 'Invalid board appearance');
        if (
          'preferredCanId' in patch &&
          patch.preferredCanId !== null &&
          (integer(patch.preferredCanId) === null ||
            (integer(patch.preferredCanId) ?? -1) < 0 ||
            (integer(patch.preferredCanId) ?? 254) > 253)
        ) {
          return failure(id, 'invalid_request', 'Preferred CAN ID must be 0 through 253');
        }
        if (
          'preferredBmsCanId' in patch &&
          patch.preferredBmsCanId !== null &&
          (integer(patch.preferredBmsCanId) === null ||
            (integer(patch.preferredBmsCanId) ?? -1) < 0 ||
            (integer(patch.preferredBmsCanId) ?? 254) > 253)
        ) {
          return failure(id, 'invalid_request', 'Preferred BMS CAN ID must be 0 through 253');
        }
        if (
          'liveWidgetSlots' in patch &&
          (!Array.isArray(patch.liveWidgetSlots) ||
            patch.liveWidgetSlots.length !== 5 ||
            patch.liveWidgetSlots.some((field) => !liveWidgetFields.includes(field)))
        )
          return failure(id, 'invalid_request', 'Invalid live box layout');
        if (patch.batteryCellProfileId != null && !batteryCellProfiles.some((p) => p.id === patch.batteryCellProfileId))
          return failure(id, 'invalid_request', 'Unknown battery cell profile');
        if (
          patch.batteryMinimumCellVoltageV != null &&
          (typeof patch.batteryMinimumCellVoltageV !== 'number' ||
            !Number.isFinite(patch.batteryMinimumCellVoltageV) ||
            patch.batteryMinimumCellVoltageV < 2.7 ||
            patch.batteryMinimumCellVoltageV >= 4.2)
        )
          return failure(id, 'invalid_request', 'Empty voltage must be from 2.7 V to below 4.2 V');
        let values;
        try {
          values = applyBatteryPatch(current.values, patch);
        } catch {
          return failure(id, 'invalid_request', 'Invalid battery configuration');
        }
        const updated = {
          ...current,
          revision: current.revision + 1,
          values,
          missingFields: ['seriesCount', 'parallelCount', 'motor'].filter((field) => values[field] == null),
        };
        if (new TextEncoder().encode(JSON.stringify(values)).length > 16384)
          return failure(id, 'invalid_request', 'Board Profile is too large');
        this.profiles.set(savedDeviceId, updated);
        this.change({
          ...this.state,
          savedDevices: this.state.savedDevices.map((device) =>
            device.savedDeviceId === savedDeviceId
              ? {
                  ...device,
                  profileComplete: updated.missingFields.length === 0,
                  appearance: (values.appearance ?? defaultBoardAppearance) as typeof defaultBoardAppearance,
                }
              : device
          ),
        });
        return success(id, updated);
      }
      case 'session.marker.add': {
        const sessionId = string(params.sessionId);
        const operationId = string(params.operationId);
        const found = this.sessionCatalog.find((s) => s.sessionId === sessionId);
        if (!found || sessionId !== this.activeSessionId)
          return failure(id, 'invalid_state', 'No active saved session');
        if (!operationId || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(operationId))
          return failure(id, 'invalid_request', 'Invalid operation ID');
        const rows = this.rideMarkers.get(sessionId) ?? [];
        let marker = rows.find((m) => m.operationId === operationId);
        if (!marker) {
          const elapsedMs = Math.max(found.totalElapsedMs, Date.now() - Date.parse(found.startedAt));
          if (rows.length >= 1000 || (rows.length && elapsedMs - rows.at(-1)!.elapsedMs < 500))
            return failure(id, 'invalid_request', 'Marker limit reached');
          marker = { sequence: found.eventCount, elapsedMs, observedAtMs: Date.now(), operationId, location: null };
          rows.push(marker);
          this.rideMarkers.set(sessionId, rows);
          found.eventCount++;
          found.totalElapsedMs = elapsedMs;
          this.change({
            ...this.state,
            activeConnection: this.state.activeConnection
              ? { ...this.state.activeConnection, activeSession: found }
              : null,
          });
        }
        return success(id, { marker, snapshot: sessionMetadata(found).snapshot });
      }
      case 'session.get': {
        const found = this.findSession(params);
        return found
          ? success(id, {
              ...sessionMetadata(found),
              recordingBreaks: structuredClone(this.recordingBreaks.get(found.sessionId) ?? []),
              connectionContextCount: this.connectionContexts.get(found.sessionId)?.length ?? 0,
              markerCount: this.rideMarkers.get(found.sessionId)?.length ?? 0,
            })
          : failure(id, 'not_found', 'Session was not found');
      }
      case 'session.list': {
        const savedDeviceId = string(params.savedDeviceId);
        const limit = integer(params.limit);
        if (!savedDeviceId) {
          return failure(id, 'invalid_request', 'savedDeviceId is required');
        }
        if (limit === null || limit < 1 || limit > MAX_SESSION_LIST_PAGE) {
          return failure(id, 'invalid_request', 'Session page size must be 1 through 100');
        }
        const board = this.state.savedDevices.find((value) => value.savedDeviceId === savedDeviceId);
        if (!board) return failure(id, 'not_found', 'Saved board was not found');
        const page = this.sessionList(board.deviceHistoryId, params.cursor, limit);
        return page.error ? failure(id, page.error.code, page.error.message) : success(id, page.value);
      }
      case 'session.export.status':
      case 'session.export.cancel': {
        const operationId = string(params.operationId);
        if (
          !operationId ||
          !/^[a-zA-Z0-9-]{1,128}$/.test(operationId) ||
          Object.keys(params).some((key) => key !== 'operationId')
        )
          return failure(id, 'invalid_request', 'Invalid operation ID');
        if (this.exportProgress?.operationId !== operationId) return failure(id, 'not_found', 'Export was not found');
        if (request.method === 'session.export.cancel' && this.exportProgress.phase === 'exporting')
          this.exportProgress.phase = 'cancelled';
        return success(id, { ...this.exportProgress });
      }
      case 'app.clear': {
        if (Object.keys(params).length) return failure(id, 'invalid_request', 'Unexpected parameters');
        if (!this.appIdle()) return failure(id, 'invalid_state', 'Disconnect and end any paused ride first');
        if (this.exportProgress?.phase === 'exporting') return failure(id, 'unavailable', 'An export is running');
        this.sessionCatalog = [];
        this.profiles.clear();
        this.tunes.clear();
        this.refloatDrafts.clear();
        this.rideMarkers.clear();
        this.connectionContexts.clear();
        this.recordingBreaks.clear();
        this.interruptionReasons.clear();
        this.uiCheckpoint = null;
        const defaults = new MockBackend().state.settings;
        this.autoConnect = 'closed';
        this.change(
          {
            ...this.state,
            savedDevices: [],
            settings: {
              ...defaults,
              revision: this.state.settings.revision + 1,
              safetyDisclaimerAccepted: this.state.settings.safetyDisclaimerAccepted,
            },
          },
          true
        );
        return accepted(id);
      }
      case 'app.export': {
        if (Object.keys(params).some((key) => key !== 'operationId'))
          return failure(id, 'invalid_request', 'Unexpected parameters');
        if (!this.appIdle()) return failure(id, 'invalid_state', 'Disconnect and end any paused ride first');
        if (params.operationId !== undefined) {
          if (typeof params.operationId !== 'string' || !this.beginBoardExportProgress(params.operationId, 'app'))
            return failure(id, 'unavailable', 'Invalid or busy export');
          this.advanceBoardExport(params.operationId, this.appSessionIds().length);
        }
        return success(id, { fileName: 'float-view-app-transfer.zip', delivery: 'staged' });
      }
      case 'session.export': {
        const hasSession = Object.hasOwn(params, 'sessionId');
        const hasBoard = Object.hasOwn(params, 'savedDeviceId');
        if (
          (Object.hasOwn(params, 'operationId') &&
            (!hasBoard ||
              typeof params.operationId !== 'string' ||
              !/^[a-zA-Z0-9-]{1,128}$/.test(params.operationId))) ||
          hasSession === hasBoard ||
          !['csv', 'float-view-archive'].includes(String(params.format)) ||
          Object.keys(params).some((key) => !['sessionId', 'savedDeviceId', 'format', 'operationId'].includes(key)) ||
          !(hasBoard ? string(params.savedDeviceId) : string(params.sessionId))
        )
          return failure(id, 'invalid_request', 'Choose one session or saved board and an export format');
        if (hasBoard) {
          const sessions = this.boardExportSessions(string(params.savedDeviceId)!);
          if (sessions === null) return failure(id, 'not_found', 'Saved board was not found');
          if (!sessions.length || sessions.length > 10_000)
            return failure(id, 'unavailable', 'No exportable sessions or export limit exceeded');
          if (typeof params.operationId === 'string') {
            if (!this.beginBoardExportProgress(params.operationId, string(params.savedDeviceId)!))
              return failure(id, 'unavailable', 'Export is already running');
            this.advanceBoardExport(params.operationId, sessions.length);
          }
          return success(id, { fileName: `float-view-all-sessions-${params.format}.zip`, delivery: 'staged' });
        }
        const found = this.findSession(params);
        if (!found) return failure(id, 'not_found', 'Session was not found');
        if (found.state === 'active') return failure(id, 'invalid_state', 'End the ride before exporting');
        return success(id, {
          fileName: `${string(params.sessionId)}.${params.format === 'csv' ? 'csv.zip' : 'floatview'}`,
          delivery: 'staged',
        });
      }
      case 'session.delete': {
        const found = this.findSession(params);
        if (!found) return accepted(id);
        this.sessionCatalog = this.sessionCatalog.filter((item) => item.sessionId !== found.sessionId);
        this.rideMarkers.delete(found.sessionId);
        this.connectionContexts.delete(found.sessionId);
        this.recordingBreaks.delete(found.sessionId);
        this.interruptionReasons.delete(found.sessionId);
        this.change(
          {
            ...this.state,
          },
          true
        );
        return accepted(id);
      }
      case 'session.delete.cancel':
        return this.operation?.operationId === string(params.operationId)
          ? success(id, this.operation)
          : failure(id, 'not_found', 'Deletion operation was not found');
      case 'session.prune.preview': {
        const target = integer(params.targetResolutionSeconds);
        if (!target || target < 1 || target > 300)
          return failure(id, 'invalid_request', 'Prune resolution must be 1 through 300 seconds');
        const found = params.scope === 'one' ? this.findSession(params) : undefined;
        if (params.scope === 'one' && !found) return failure(id, 'not_found', 'Session was not found');
        const operation = this.startOperation(
          'prunePreview',
          found?.sessionId ?? null,
          params.scope === 'all' ? 'all' : 'one',
          target
        );
        const preview: SessionPrunePreview = {
          operation,
          recordedSampleCount:
            found?.sampleCount ?? this.sessionCatalog.reduce((sum, item) => sum + item.sampleCount, 0),
          estimatedStoredSampleCount: found
            ? Math.min(found.sampleCount, Math.ceil(found.totalElapsedMs / (target * 1000)) * 8 + 2)
            : 0,
          estimatedReclaimableBytes: found ? Math.max(0, found.sampleCount - 2) * 256 : null,
          skipped: false,
          skipReason: null,
        };
        return success(id, preview);
      }
      case 'session.prune.start': {
        const target = integer(params.targetResolutionSeconds);
        if (!target || target < 1 || target > 300)
          return failure(id, 'invalid_request', 'Prune resolution must be 1 through 300 seconds');
        const found = params.scope === 'one' ? this.findSession(params) : undefined;
        if (params.scope === 'one' && !found) return failure(id, 'not_found', 'Session was not found');
        return success(
          id,
          this.startOperation('prune', found?.sessionId ?? null, params.scope === 'all' ? 'all' : 'one', target)
        );
      }
      case 'session.prune.cancel':
        return this.operation?.operationId === string(params.operationId)
          ? success(id, this.cancelOperation())
          : failure(id, 'not_found', 'Prune operation was not found');
      default:
        return failure(id, 'invalid_request', 'Unknown method');
    }
  }

  simulateSpeedCalibrationProgress(
    status: AppState['speedCalibration']['measurementStatus'],
    acceptedSamples: number,
    progressPercent: number
  ): void {
    const c = this.state.speedCalibration;
    if (
      !['collecting', 'refining'].includes(c.status) ||
      !Number.isInteger(acceptedSamples) ||
      acceptedSamples < c.acceptedSamples ||
      acceptedSamples > 180 ||
      !Number.isInteger(progressPercent) ||
      progressPercent < c.progressPercent ||
      progressPercent > (c.status === 'refining' ? 100 : 95)
    )
      return;
    this.change({
      ...this.state,
      speedCalibration: { ...c, measurementStatus: status, acceptedSamples, progressPercent },
    });
  }

  /** Native fixture observation: no browser or public API may manufacture a GPS result. */
  simulateSpeedCalibrationResult(recommendedMm: number, supported = true): void {
    const c = this.state.speedCalibration;
    if (
      !['collecting', 'refining'].includes(c.status) ||
      !Number.isFinite(recommendedMm) ||
      recommendedMm < 100 ||
      recommendedMm > 600
    )
      return;
    this.calibrationWritable = supported;
    this.change({
      ...this.state,
      speedCalibration: {
        ...c,
        status: 'refining',
        acceptedSamples: Math.max(30, c.acceptedSamples),
        progressPercent: 100,
        measurementStatus: 'ready',
        recommendedDiameterMm: recommendedMm,
      },
    });
  }

  publishTelemetry(): void {
    const active = this.state.activeConnection;
    if (!active || active.state !== 'ready') return;
    const sequence = (active.latestSample?.sequence ?? active.activeSession?.sampleCount ?? 0) + 1;
    const elapsedMs = active.latestSample
      ? active.latestSample.elapsedMs + this.state.settings.ridingPersistIntervalMs
      : Math.max(
          (active.activeSession?.totalElapsedMs ?? 0) + this.state.settings.ridingPersistIntervalMs,
          active.activeSession ? Date.now() - Date.parse(active.activeSession.startedAt) : 0
        );
    const latestSample = {
      sequence,
      observedAt: new Date().toISOString(),
      slowObservedAt: new Date(Date.now() - 250).toISOString(),
      elapsedMs,
      ridingElapsedMs:
        (active.latestSample?.ridingElapsedMs ?? active.activeSession?.ridingElapsedMs ?? 0) +
        (active.latestSample?.rideState === 'riding' ? this.state.settings.ridingPersistIntervalMs : 0),
      rideState: 'riding' as const,
      packageState: 'running' as const,
      packageMode: 'normal' as const,
      footpadState: 'both' as const,
      stopCondition: 'none' as const,
      setpointAdjustment: 'none' as const,
      wheelslip: false,
      darkride: false,
      charging: false,
      alertReason: 'none' as const,
      firmwareFault: null,
      imuTimeoutActive: null,
      imuTimeoutHistory: [],
      fatalErrorLatched: active.refloatControls?.fatalErrorLatched ?? null,
      lastFirmwareFault: null,
      faultHistory: [],
      packVoltageV: 58.4 - sequence * 0.002,
      load: { duty: 0.42, motor: 0.2, battery: 0.18, winner: { source: 'duty' as const, fraction: 0.42 } },
      dutyCycle: 0.42,
      controllerTempC: 38.2,
      motorTempC: 41.7,
      motorCurrentA: 18.6,
      batteryCurrentA: 8.4,
      erpm: 3240,
      speedKph: 24.3,
      maxSpeedKph: Math.max(active.latestSample?.maxSpeedKph ?? (active.activeSession?.maxSpeedMps ?? 0) * 3.6, 24.3),
      pitchDeg: 1.4,
      balancePitchDeg: 1.1,
      rollDeg: 0.6,
      directionalMotorCurrentA: 17.9,
      filteredMotorCurrentA: 17.4,
      requestedBalanceCurrentA: 20.2,
      boosterCurrentA: 1.2,
      fieldWeakeningCurrentA: 0,
      footpadAdc1V: 2.8,
      footpadAdc2V: 2.75,
      remoteInput: 0,
      setpointDeg: 1,
      atrSetpointDeg: 0.4,
      brakeTiltSetpointDeg: 0,
      torqueTiltSetpointDeg: 0.6,
      turnTiltSetpointDeg: 0,
      remoteSetpointDeg: 0,
      atrAccelerationDifferenceErpmPerSecond: 180,
      atrSpeedBoost: 0.05,
      distanceM:
        (active.latestSample?.distanceM ?? active.activeSession?.distanceM ?? 0) +
        (active.latestSample?.speedKph == null
          ? 0
          : ((Math.abs(active.latestSample.speedKph) + 24.3) * 0.5 * this.state.settings.ridingPersistIntervalMs) /
            3600),
      odometerM: 12_345 + sequence * 0.675,
      ampHoursDrawnAh: 18.4,
      ampHoursChargedAh: 2.7,
      wattHoursDrawnWh: 812,
      wattHoursChargedWh: 119,
      batteryLevel: 0.68,
      chargingCurrentA: 0,
      chargingVoltageV: 0,
      extensions: {},
    };
    const activeSession = active.activeSession
      ? {
          ...active.activeSession,
          sampleCount: sequence,
          ridingElapsedMs: latestSample.ridingElapsedMs,
          distanceM: latestSample.distanceM,
          totalElapsedMs: elapsedMs,
          maxSpeedMps: latestSample.maxSpeedKph / 3.6,
          maxDutyCycle: latestSample.dutyCycle,
        }
      : null;
    if (activeSession) {
      this.sessionCatalog = this.sessionCatalog.map((item) =>
        item.sessionId === activeSession.sessionId ? activeSession : item
      );
    }
    const latestLocation =
      active.trackingMode === 'saved'
        ? {
            latitude: -33.8688,
            longitude: 151.2093,
            accuracyM: 12,
            altitudeM: 24,
            observedAt: latestSample.observedAt,
          }
        : null;
    this.change({
      ...this.state,
      activeConnection: {
        ...active,
        latestSample,
        latestLocation,
        activeSession,
        refloatControls: active.refloatControls ? { ...active.refloatControls, fatalErrorClearable: false } : null,
        controllerActions: { shutdownAvailable: false, pendingAction: null },
      },
    });
  }

  get telemetryCadenceMs(): number {
    return this.state.settings.ridingPersistIntervalMs;
  }

  simulatePermissions(permissions: AppState['permissions']): void {
    this.change({
      ...this.state,
      permissions,
      location: locationSummary(permissions, this.state.settings.locationRecordingEnabled),
    });
    this.stepAutoConnect();
  }

  simulateConnectionState(state: 'ready' | 'reconnecting', foreground = true): void {
    const active = this.state.activeConnection;
    if (!active) return;
    if (
      state === 'reconnecting' &&
      active.activeSession &&
      this.interruptionReasons.get(active.activeSession.sessionId) !== 'pause'
    )
      this.interruptionReasons.set(active.activeSession.sessionId, 'connectionLoss');
    if (state === 'reconnecting' && !foreground) {
      this.refloatDrafts.delete(active.deviceId);
      if (this.uiCheckpoint?.live?.deviceId === active.deviceId) this.uiCheckpoint = null;
    }
    const refloatControls =
      state === 'reconnecting'
        ? {
            status: 'loading' as const,
            writable: false,
            packageEnabled: null,
            flywheelEnabled: null,
            lightingAvailable: false,
            ledsEnabled: null,
            headlightsEnabled: null,
            fatalErrorClearAvailable: false,
            imuTimeoutAvailable: false,
            fatalErrorLatched: null,
            fatalErrorActive: null,
            fatalErrorClearable: null,
            pendingAction: null,
          }
        : readyRefloatControls();
    this.change({
      ...this.state,
      activeConnection: {
        ...active,
        state,
        refloatControls,
        controllerActions: {
          shutdownAvailable: shutdownAvailable({ ...active, state, refloatControls }),
          pendingAction: null,
        },
      },
    });
  }

  simulateRefloatControls(patch: Partial<RefloatControls>): void {
    const active = this.state.activeConnection;
    if (!active?.refloatControls) return;
    const refloatControls = { ...active.refloatControls, ...patch };
    this.change({
      ...this.state,
      activeConnection: {
        ...active,
        refloatControls,
        controllerActions: {
          shutdownAvailable: shutdownAvailable({ ...active, refloatControls }),
          pendingAction: active.controllerActions.pendingAction,
        },
      },
    });
  }

  simulateRefloatTimeout(): void {
    this.refloatTimeoutOnce = true;
  }

  simulateShutdownOutcome(outcome: 'no-op' | 'disconnect'): void {
    this.shutdownOutcome = outcome;
  }

  simulateRideState(rideState: 'idle' | 'riding' | 'unknown'): void {
    const active = this.state.activeConnection;
    if (!active?.latestSample) return;
    const latestSample = {
      ...active.latestSample,
      rideState,
      ...(rideState === 'idle'
        ? { footpadState: 'none' as const, packageState: 'ready' as const, packageMode: 'normal' as const }
        : {}),
    };
    const available = shutdownAvailable({ ...active, latestSample });
    this.change({
      ...this.state,
      activeConnection: {
        ...active,
        latestSample,
        controllerActions: { shutdownAvailable: available, pendingAction: null },
      },
    });
  }

  simulateExternalLighting(ledsEnabled: boolean, headlightsEnabled: boolean): void {
    const controls = this.state.activeConnection?.refloatControls;
    if (!controls || !controls.lightingAvailable) return;
    if (controls.ledsEnabled === ledsEnabled && controls.headlightsEnabled === headlightsEnabled) return;
    this.simulateRefloatControls({ ledsEnabled, headlightsEnabled });
  }

  simulateBmsState(bms: BmsState): void {
    const active = this.state.activeConnection;
    if (!active || !validBmsState(bms)) return;
    this.change({ ...this.state, activeConnection: { ...active, bms } });
  }

  simulateBmsAttached(snapshot: BmsSnapshot, connection: BmsState['connection'] = { kind: 'direct' }): void {
    if (!connection) return;
    this.simulateBmsState({ status: 'attached', connection, candidates: [], latestSnapshot: snapshot });
  }

  simulateStandaloneBms(snapshot: BmsSnapshot): void {
    const active = this.state.activeConnection;
    if (!active) return;
    const activeSessionId = active.activeSession?.sessionId;
    this.activeSessionId = undefined;
    if (activeSessionId) this.sessionCatalog = this.sessionCatalog.filter((item) => item.sessionId !== activeSessionId);
    this.change(
      {
        ...this.state,
        activeConnection: {
          ...active,
          state: 'ready',
          deviceKind: 'bms',
          firmware: null,
          transportFirmware: { vescVersion: '6.00', hardwareName: 'VBMS', firmwareName: null, testVersion: 0 },
          controllerConnection: null,
          controllerCandidates: [],
          connectionIssue: null,
          bms: { status: 'attached', connection: { kind: 'direct' }, candidates: [], latestSnapshot: snapshot },
          refloatControls: null,
          refloatConfiguration: null,
          controllerActions: { shutdownAvailable: false, pendingAction: null },
          activeSession: null,
          latestSample: null,
          batteryEstimate: emptyEstimate(),
          batteryWarning: null,
          liveWidgetSlots: [...defaultLiveWidgetSlots],
          latestLocation: null,
          currentLimits: null,
        },
      },
      Boolean(activeSessionId)
    );
  }

  simulateBmsAmbiguous(candidates: BmsCandidate[]): void {
    this.simulateBmsState({
      status: 'ambiguous',
      connection: null,
      candidates: [...candidates].sort(compareBmsCandidates),
      latestSnapshot: null,
    });
  }

  simulateIdentifying(): void {
    const active = this.state.activeConnection;
    if (!active) return;
    const activeSessionId = active.activeSession?.sessionId;
    this.activeSessionId = undefined;
    if (activeSessionId) this.sessionCatalog = this.sessionCatalog.filter((item) => item.sessionId !== activeSessionId);
    this.change(
      {
        ...this.state,
        activeConnection: {
          ...active,
          state: 'identifying',
          savedDeviceId: active.trackingMode === 'saved' ? active.savedDeviceId : null,
          controllerConnection: null,
          controllerCandidates: [],
          connectionIssue: null,
          activeSession: null,
          firmware: null,
        },
      },
      Boolean(activeSessionId)
    );
  }

  simulateCanReady(canId: number): void {
    const active = this.state.activeConnection;
    if (!active || !Number.isInteger(canId) || canId < 0 || canId > 253) return;
    this.change({
      ...this.state,
      activeConnection: {
        ...active,
        state: 'ready',
        controllerConnection: { kind: 'can', canId },
        transportFirmware: {
          vescVersion: '6.06',
          hardwareName: 'VESC Express T',
          firmwareName: 'VESC Express',
          testVersion: 0,
        },
        firmware: active.firmware ? { ...active.firmware, hardwareName: 'Thor300' } : null,
        controllerCandidates: [],
        connectionIssue: null,
      },
    });
  }

  simulateControllerSelection(candidates: ControllerCandidate[]): void {
    const active = this.state.activeConnection;
    if (!active || candidates.length < 2 || candidates.length > 16) return;
    this.pendingCandidates = [...candidates].sort((left, right) => left.canId - right.canId);
    this.change({
      ...this.state,
      activeConnection: {
        ...active,
        state: 'selecting_controller',
        controllerConnection: null,
        controllerCandidates: this.pendingCandidates,
        connectionIssue: null,
        activeSession: null,
      },
    });
  }

  simulateCanReplyConflict(): void {
    const active = this.state.activeConnection;
    if (!active) throw new Error('No active connection');
    this.change({
      ...this.state,
      activeConnection: {
        ...active,
        connectionWarning: {
          code: 'possible_can_id_conflict',
          message:
            'Duplicate CAN replies may prevent live values and Refloat configuration from loading. Check that your Bluetooth gateway, motor controller, and every receiver/accessory use different CAN IDs, then reconnect.',
        },
      },
    });
  }

  simulateConnectionFailure(
    code: ConnectionIssueCode,
    message: string,
    refloatCompatibility?: import('../src/lib/backend/contract.ts').RefloatCompatibility
  ): void {
    const active = this.state.activeConnection;
    if (!active) return;
    const activeSessionId = active.activeSession?.sessionId;
    this.activeSessionId = undefined;
    if (activeSessionId) {
      this.sessionCatalog = this.sessionCatalog
        .map((item) =>
          item.sessionId === activeSessionId
            ? { ...item, endedAt: new Date().toISOString(), state: 'interrupted' as const, integrity: 'gaps' as const }
            : item
        )
        .filter((item) => code === 'controller_changed' || item.sessionId !== activeSessionId);
    }
    this.change(
      {
        ...this.state,
        activeConnection: {
          ...active,
          state: 'failed',
          connectionIssue: {
            code,
            message: message.slice(0, 1_024),
            ...(code === 'unsupported_refloat' && refloatCompatibility
              ? { refloatCompatibility: structuredClone(refloatCompatibility) }
              : {}),
          },
          controllerCandidates: [],
          activeSession: null,
        },
      },
      Boolean(activeSessionId)
    );
  }

  private findSession(params: Record<string, unknown>) {
    const sessionId = string(params.sessionId);
    return this.sessionCatalog.find((item) => item.sessionId === sessionId);
  }

  private writeRefloatConfiguration(id: number, params: Record<string, unknown>, tuneApply = false): Response {
    const active = this.state.activeConnection;
    const summary = active?.refloatConfiguration;
    const values = asObject(params.values);
    const ridingTune = tuneApply && supportsRidingTuneApply(summary?.packageVersion);
    const sample = active?.latestSample;
    const stateAllowed = ridingTune
      ? (sample?.rideState === 'idle' || sample?.rideState === 'riding') &&
        (sample.packageState === 'ready' || sample.packageState === 'running')
      : sample?.rideState === 'idle' && sample.footpadState === 'none' && sample.packageState === 'ready';
    if (
      typeof params.packageVersion !== 'string' ||
      typeof params.schemaFingerprint !== 'string' ||
      integer(params.wireSignature) === null ||
      integer(params.baseRevision) === null ||
      !values ||
      !validRefloatValues(values)
    )
      return failure(id, 'invalid_request', 'Complete typed configuration values are required');
    if (
      !active ||
      !summary ||
      !summary.writable ||
      summary.pendingOperation !== null ||
      active.state !== 'ready' ||
      active.refloatControls?.flywheelEnabled ||
      active.refloatControls?.pendingAction !== null ||
      active.controllerActions.pendingAction !== null ||
      !stateAllowed ||
      sample?.packageMode !== 'normal'
    )
      return failure(id, 'invalid_state', 'Configuration write is unavailable');
    if (
      params.packageVersion !== refloatIdentity.packageVersion ||
      params.schemaFingerprint !== refloatIdentity.schemaFingerprint ||
      params.wireSignature !== refloatIdentity.wireSignature ||
      params.baseRevision !== this.refloatCurrentRevision
    )
      return failure(id, 'conflict', 'Configuration identity or base revision changed');
    this.refloatCurrentRevision += 1;
    this.refloatCurrentValues = {
      ...(values as Record<string, RefloatConfigurationValue>),
      'meta.is_default': { type: 'boolean', value: false },
    };
    this.change({
      ...this.state,
      activeConnection: {
        ...active,
        refloatConfiguration: { ...summary, currentLoaded: true, pendingOperation: null },
      },
    });
    return success(id, {
      identity: refloatIdentity,
      revision: this.refloatCurrentRevision,
      source: 'current',
      values: this.refloatCurrentValues,
    });
  }

  private listRefloatTunes(id: number, params: Record<string, unknown>): Response {
    const identity = validRefloatIdentity(params.identity);
    const limit = integer(params.limit);
    const offset = decodeTuneCursor(params.cursor, identity);
    if (
      (params.identity !== null && !identity) ||
      limit === null ||
      limit < 1 ||
      limit > MAX_REFLOAT_TUNE_LIST_PAGE ||
      offset === null
    ) {
      return failure(id, 'invalid_request', 'Tune list parameters are invalid');
    }
    const matching = [...this.tunes.values()]
      .filter((tune) => !identity || sameRefloatTuneIdentity(tune.identity, identity))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.tuneId.localeCompare(right.tuneId));
    const items = matching.slice(offset, offset + limit).map((tune) => ({
      tuneId: tune.tuneId,
      revision: tune.revision,
      name: tune.name,
      description: tune.description,
      identity: tune.identity,
      createdAt: tune.createdAt,
      updatedAt: tune.updatedAt,
    }));
    return success(id, {
      items,
      nextCursor: offset + limit < matching.length ? encodeTuneCursor(offset + limit, identity) : null,
    });
  }

  private createRefloatTune(id: number, params: Record<string, unknown>): Response {
    const name = boundedText(params.name, MAX_REFLOAT_TUNE_NAME_BYTES, false);
    const description = boundedText(params.description, MAX_REFLOAT_TUNE_DESCRIPTION_BYTES, true);
    const identity = validRefloatIdentity(params.identity);
    const values = asObject(params.values);
    if (
      typeof name !== 'string' ||
      description === undefined ||
      !identity ||
      !sameRefloatIdentity(identity, refloatIdentity) ||
      integer(params.sourceRevision) !== this.refloatCurrentRevision ||
      !values ||
      !validRefloatTuneValues(values)
    )
      return failure(id, 'invalid_request', 'Tune create parameters are invalid or stale');
    const now = new Date().toISOString();
    const tune: RefloatTune = {
      tuneId: `tune-${this.nextTune++}`,
      revision: 1,
      name,
      description,
      identity: { ...identity, packageVersion: tunePackageVersion(identity.packageVersion) },
      values: values as Record<string, RefloatConfigurationValue>,
      createdAt: now,
      updatedAt: now,
    };
    this.tunes.set(tune.tuneId, tune);
    return success(id, tune);
  }

  private updateRefloatTune(id: number, params: Record<string, unknown>): Response {
    const tuneId = string(params.tuneId);
    const current = tuneId ? this.tunes.get(tuneId) : undefined;
    if (!current) return failure(id, 'not_found', 'Tune was not found');
    if (integer(params.expectedRevision) !== current.revision) return failure(id, 'conflict', 'Tune revision changed');
    const name = boundedText(params.name, MAX_REFLOAT_TUNE_NAME_BYTES, false);
    const description = boundedText(params.description, MAX_REFLOAT_TUNE_DESCRIPTION_BYTES, true);
    const values = asObject(params.values);
    const unchanged =
      values &&
      Object.keys(values).length === Object.keys(current.values).length &&
      Object.entries(current.values).every(([key, value]) => {
        const proposed = asObject(values[key]);
        return (
          proposed &&
          Object.keys(proposed).sort().join(',') === 'type,value' &&
          proposed.type === value.type &&
          proposed.value === value.value
        );
      });
    if (
      typeof name !== 'string' ||
      description === undefined ||
      !values ||
      (!unchanged && (!sameRefloatTuneIdentity(current.identity, refloatIdentity) || !validRefloatTuneValues(values)))
    ) {
      return failure(id, 'invalid_request', 'Tune update parameters are invalid');
    }
    const updated = {
      ...current,
      revision: current.revision + 1,
      name,
      description,
      values: values as Record<string, RefloatConfigurationValue>,
      updatedAt: new Date().toISOString(),
    };
    this.tunes.set(tuneId!, updated);
    return success(id, updated);
  }

  private deleteRefloatTune(id: number, params: Record<string, unknown>): Response {
    const tuneId = string(params.tuneId);
    const current = tuneId ? this.tunes.get(tuneId) : undefined;
    if (!current) return accepted(id);
    if (integer(params.expectedRevision) !== current.revision) return failure(id, 'conflict', 'Tune revision changed');
    this.tunes.delete(tuneId!);
    return accepted(id);
  }

  private setRefloatControl(id: number, control: RefloatControl, enabled: boolean): Response {
    const active = this.state.activeConnection;
    const controls = active?.refloatControls;
    if (
      !active ||
      active.state !== 'ready' ||
      !controls ||
      controls.status === 'unavailable' ||
      controls.flywheelEnabled === null ||
      !controls.writable
    ) {
      return failure(id, 'invalid_state', 'Refloat controls are not writable');
    }
    if (controls.pendingAction !== null) return failure(id, 'invalid_state', 'Another Refloat action is pending');
    if (controls.flywheelEnabled && !(control === 'flywheel' && !enabled)) {
      return failure(id, 'invalid_state', 'Only flywheel disable is available in flywheel mode');
    }
    if (
      (control === 'leds' || control === 'headlights') &&
      (!controls.lightingAvailable || controls.ledsEnabled === null || controls.headlightsEnabled === null)
    ) {
      return failure(id, 'invalid_state', 'Refloat lighting is unavailable');
    }
    const activeFlywheelDisable = control === 'flywheel' && !enabled && controls.flywheelEnabled === true;
    if (
      (control === 'package' || (control === 'flywheel' && !activeFlywheelDisable)) &&
      active.latestSample?.rideState === 'riding'
    ) {
      return failure(id, 'invalid_state', 'The board must be idle for this control');
    }
    const field = refloatControlField(control);
    if (controls[field] === null) return failure(id, 'invalid_state', 'The control state is unavailable');
    if (controls[field] === enabled) return success(id, controls);
    const result = this.completeRefloatAction(id, control, { [field]: enabled });
    if (control === 'flywheel' && 'result' in result) {
      const completed = this.state.activeConnection;
      const summary = completed?.refloatConfiguration;
      if (completed && summary) {
        if (enabled) {
          this.change({
            ...this.state,
            activeConnection: {
              ...completed,
              refloatConfiguration: { ...summary, currentLoaded: false, writable: false, pendingOperation: null },
            },
          });
        } else {
          this.change({
            ...this.state,
            activeConnection: {
              ...completed,
              refloatConfiguration: { ...summary, currentLoaded: true, writable: true, pendingOperation: null },
            },
          });
        }
      }
    }
    return result;
  }

  private clearRefloatFatalError(id: number): Response {
    const active = this.state.activeConnection;
    const controls = active?.refloatControls;
    if (
      !active ||
      active.state !== 'ready' ||
      !controls ||
      controls.status === 'unavailable' ||
      !controls.writable ||
      controls.pendingAction !== null ||
      controls.flywheelEnabled !== false ||
      !controls.fatalErrorClearAvailable ||
      controls.fatalErrorLatched !== true ||
      controls.fatalErrorActive !== false ||
      controls.fatalErrorClearable !== true ||
      active.latestSample?.rideState === 'riding'
    ) {
      return failure(id, 'invalid_state', 'The fatal error is not clearable');
    }
    return this.completeRefloatAction(id, 'clearFatalError', {
      fatalErrorLatched: false,
      fatalErrorClearable: false,
    });
  }

  private shutdownController(id: number): Response {
    const active = this.state.activeConnection;
    const actions = active?.controllerActions;
    if (
      !active ||
      active.state !== 'ready' ||
      !actions?.shutdownAvailable ||
      actions.pendingAction !== null ||
      active.latestSample?.rideState !== 'idle' ||
      active.refloatControls?.pendingAction !== null ||
      active.refloatControls?.flywheelEnabled === true
    ) {
      return failure(id, 'invalid_state', 'Controller shutdown is unavailable');
    }
    this.change({
      ...this.state,
      activeConnection: {
        ...active,
        controllerActions: { shutdownAvailable: false, pendingAction: 'shutdown' },
      },
    });
    if (this.shutdownOutcome === 'disconnect') {
      this.shutdownOutcome = 'no-op';
      this.change({ ...this.state, activeConnection: null });
      return accepted(id);
    }
    const pending = this.state.activeConnection!;
    this.change({
      ...this.state,
      activeConnection: {
        ...pending,
        controllerActions: { shutdownAvailable: true, pendingAction: null },
      },
    });
    return accepted(id);
  }

  private completeRefloatAction(
    id: number,
    action: RefloatPendingAction,
    confirmed: Partial<RefloatControls>
  ): Response {
    const active = this.state.activeConnection!;
    const controls = active.refloatControls!;
    this.change({
      ...this.state,
      activeConnection: { ...active, refloatControls: { ...controls, pendingAction: action } },
    });
    const pendingActive = this.state.activeConnection!;
    const pendingControls = pendingActive.refloatControls!;
    if (this.refloatTimeoutOnce) {
      this.refloatTimeoutOnce = false;
      const unchanged = { ...pendingControls, pendingAction: null };
      this.change({
        ...this.state,
        activeConnection: { ...pendingActive, refloatControls: unchanged },
      });
      return failure(id, 'unavailable', 'Refloat control confirmation timed out');
    }
    const complete = { ...pendingControls, ...confirmed, pendingAction: null };
    this.change({
      ...this.state,
      activeConnection: { ...pendingActive, refloatControls: complete },
    });
    return success(id, complete);
  }

  appIdle(): boolean {
    return !this.state.activeConnection && !this.state.pausedRide && !this.operation;
  }
  appSessionIds(): string[] {
    return this.sessionCatalog.map((s) => s.sessionId);
  }
  appManifest() {
    if (!this.appIdle()) throw new Error('Disconnect and end any paused ride first');
    return structuredClone({
      format: 'float-view-app-transfer',
      version: 1,
      settings: {
        ...this.state.settings,
        revision: 0,
        safetyDisclaimerAccepted: false,
        autoConnectSavedDeviceId: null,
      },
      autoConnectHistoryId:
        this.state.savedDevices.find((b) => b.savedDeviceId === this.state.settings.autoConnectSavedDeviceId)
          ?.deviceHistoryId ?? null,
      boards: this.state.savedDevices.map((b) => ({
        deviceHistoryId: b.deviceHistoryId,
        name: b.displayName,
        customName: b.customDisplayName,
        profile: this.profiles.get(b.savedDeviceId)?.values ?? {},
      })),
      tunes: [...this.tunes.values()],
      sessions: this.sessionCatalog,
    });
  }
  importAppManifest(value: ReturnType<MockBackend['appManifest']>, applySettings: boolean) {
    if (
      !this.appIdle() ||
      value.format !== 'float-view-app-transfer' ||
      value.version !== 1 ||
      value.boards.length > 50 ||
      value.sessions.length > 10000 ||
      value.tunes.length > 1000
    )
      throw new Error('Invalid app transfer');
    const summary = {
      boardsAdded: 0,
      boardsSkipped: 0,
      sessionsAdded: 0,
      sessionsSkipped: 0,
      tunesAdded: 0,
      tunesSkipped: 0,
      settingsImported: applySettings,
    };
    const histories = new Set(value.boards.map((b) => b.deviceHistoryId));
    if (
      histories.size !== value.boards.length ||
      new Set(value.sessions.map((s) => s.sessionId)).size !== value.sessions.length
    )
      throw new Error('Duplicate identity');
    for (const incoming of value.sessions) {
      const existing = this.sessionCatalog.find((s) => s.sessionId === incoming.sessionId);
      if (
        !histories.has(incoming.deviceHistoryId) ||
        (existing && existing.deviceHistoryId !== incoming.deviceHistoryId)
      )
        throw new Error('Conflicting session board identity');
    }
    const boards = [...this.state.savedDevices];
    for (const b of value.boards) {
      if (boards.some((e) => e.deviceHistoryId === b.deviceHistoryId)) {
        summary.boardsSkipped++;
        continue;
      }
      const savedDeviceId = `saved-${b.deviceHistoryId}`;
      boards.push({
        ...savedBoard,
        savedDeviceId,
        deviceHistoryId: b.deviceHistoryId,
        displayName: b.name,
        customDisplayName: b.customName,
        advertisedName: b.name,
        bluetoothIdentifier: null,
        lastSeenAt: null,
        lastConnectedAt: null,
        summary: emptySummary(),
      });
      this.profiles.set(savedDeviceId, {
        savedDeviceId,
        revision: 0,
        values: structuredClone(b.profile),
        missingFields: [],
      });
      summary.boardsAdded++;
    }
    for (const tune of value.tunes) {
      if (this.tunes.has(tune.tuneId)) summary.tunesSkipped++;
      else {
        this.tunes.set(tune.tuneId, {
          ...structuredClone(tune),
          identity: { ...tune.identity, packageVersion: tunePackageVersion(tune.identity.packageVersion) },
        });
        summary.tunesAdded++;
      }
    }
    for (const incoming of value.sessions) {
      if (this.hasSession(incoming.sessionId)) summary.sessionsSkipped++;
      else {
        this.sessionCatalog.push(structuredClone(incoming));
        summary.sessionsAdded++;
      }
    }
    const settings = applySettings
      ? {
          ...value.settings,
          revision: this.state.settings.revision + 1,
          safetyDisclaimerAccepted: this.state.settings.safetyDisclaimerAccepted,
          autoConnectSavedDeviceId:
            boards.find((b) => b.deviceHistoryId === value.autoConnectHistoryId)?.savedDeviceId ?? null,
        }
      : this.state.settings;
    this.autoConnect = 'closed';
    this.change({ ...this.state, savedDevices: boards, settings }, true);
    return summary;
  }

  boardExportSessions(savedDeviceId: string): string[] | null {
    const board = this.state.savedDevices.find((value) => value.savedDeviceId === savedDeviceId);
    if (!board) return null;
    return this.sessionCatalog
      .filter((session) => session.deviceHistoryId === board.deviceHistoryId && session.state !== 'active')
      .map((session) => session.sessionId);
  }

  hasSession(sessionId: string): boolean {
    return Boolean(this.findSession({ sessionId }));
  }

  archiveIdentity(sessionId: string): { deviceHistoryId: string; displayName: string } | null {
    const found = this.findSession({ sessionId });
    return found ? { deviceHistoryId: found.deviceHistoryId, displayName: found.displayName } : null;
  }

  importSession(archive: Uint8Array): string {
    const imported = parseArchiveIdentity(archive);
    const existing = this.sessionCatalog.find((s) => s.sessionId === imported.sessionId);
    if (existing) {
      if (existing.deviceHistoryId !== imported.deviceHistoryId) throw new Error('Conflicting session board identity');
      return existing.sessionId;
    }
    let importedBoard = this.state.savedDevices.find((value) => value.deviceHistoryId === imported.deviceHistoryId);
    if (!importedBoard) {
      importedBoard = {
        appearance: { ...defaultBoardAppearance },
        savedDeviceId: `saved-${imported.deviceHistoryId}`,
        deviceHistoryId: imported.deviceHistoryId,
        revision: 0,
        displayName: imported.displayName,
        customDisplayName: null,
        advertisedName: imported.displayName,
        bluetoothIdentifier: null,
        lastSeenAt: null,
        lastConnectedAt: null,
        profileComplete: false,
        summary: emptySummary(),
      };
      this.state = { ...this.state, savedDevices: [...this.state.savedDevices, importedBoard] };
      this.profiles.set(importedBoard.savedDeviceId, {
        savedDeviceId: importedBoard.savedDeviceId,
        revision: 0,
        values: {},
        missingFields: ['seriesCount', 'parallelCount', 'motor'],
      });
    }
    const sessionId = imported.sessionId;
    const startedAt = new Date().toISOString();
    this.sessionCatalog = [
      {
        ...session,
        sessionId,
        deviceHistoryId: importedBoard.deviceHistoryId,
        displayName: importedBoard.displayName,
        startedAt,
        endedAt: new Date(Date.parse(startedAt) + 149_999_000).toISOString(),
        sampleCount: 150_000,
        eventCount: 2,
        ridingElapsedMs: 134_999_000,
        totalElapsedMs: 149_999_000,
        distanceM: 810_000,
        maxSpeedMps: 10,
        maxDutyCycle: 0.849,
      },
      ...this.sessionCatalog,
    ];
    this.change({ ...this.state, savedDevices: this.refreshSummaries(this.sessionCatalog) }, true);
    return sessionId;
  }

  private sessionList(
    deviceHistoryId: string,
    cursor: unknown,
    limit: number
  ):
    | { value: SessionListPage; error?: undefined }
    | { value?: undefined; error: { code: BackendError['code']; message: string } } {
    const ordered = this.sessionCatalog
      .filter((item) => item.deviceHistoryId === deviceHistoryId)
      .sort(compareSessions);
    let start = 0;
    if (cursor !== undefined && cursor !== null) {
      if (typeof cursor !== 'string' || Buffer.byteLength(cursor, 'utf8') > MAX_SESSION_LIST_CURSOR_BYTES) {
        return { error: { code: 'invalid_request', message: 'Session cursor is invalid' } };
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
      } catch {
        return { error: { code: 'invalid_request', message: 'Session cursor is invalid' } };
      }
      const context = asObject(decoded);
      const lastStartedAt = context ? string(context.lastStartedAt) : null;
      const lastSessionId = context ? string(context.lastSessionId) : null;
      if (
        !context ||
        context.version !== 1 ||
        context.query !== 'startedAt.desc.sessionId.desc' ||
        context.deviceHistoryId !== deviceHistoryId ||
        !lastStartedAt ||
        !lastSessionId
      ) {
        return { error: { code: 'invalid_request', message: 'Session cursor is invalid' } };
      }
      if (context.catalogRevision !== this.state.sessionCatalogRevision) {
        return { error: { code: 'conflict', message: 'Session cursor is stale' } };
      }
      start = ordered.findIndex((item) => item.startedAt === lastStartedAt && item.sessionId === lastSessionId) + 1;
      if (start === 0) return { error: { code: 'conflict', message: 'Session cursor no longer matches the catalog' } };
    }
    const items = ordered.slice(start, start + limit);
    const last = items.at(-1);
    const nextCursor =
      start + items.length < ordered.length && last
        ? Buffer.from(
            JSON.stringify({
              version: 1,
              query: 'startedAt.desc.sessionId.desc',
              deviceHistoryId,
              catalogRevision: this.state.sessionCatalogRevision,
              lastStartedAt: last.startedAt,
              lastSessionId: last.sessionId,
            }),
            'utf8'
          ).toString('base64')
        : null;
    return { value: { items, catalogRevision: this.state.sessionCatalogRevision, nextCursor } };
  }

  private startOperation(
    kind: SessionOperationState['kind'],
    sessionId: string | null,
    scope: SessionOperationState['scope'],
    targetResolutionSeconds: number
  ): SessionOperationState {
    const operation: SessionOperationState = {
      operationId: `${kind}-${this.state.revision + 1}`,
      kind,
      status: kind === 'prunePreview' ? 'completed' : 'queued',
      sessionId,
      scope,
      targetResolutionSeconds,
      completedSessions: kind === 'prunePreview' ? (scope === 'one' ? 1 : this.sessionCatalog.length) : 0,
      eligibleSessions: scope === 'one' ? 1 : this.sessionCatalog.length,
      error: null,
    };
    this.operation = operation;
    this.change({ ...this.state, sessionOperation: operation });
    if (kind === 'prune') {
      this.advancePrune(operation, 'running');
    }
    return operation;
  }

  private advancePrune(operation: SessionOperationState, status: 'running' | 'reclaiming' | 'completed') {
    this.operationTimer = setTimeout(() => {
      this.operationTimer = undefined;
      if (this.operation?.operationId !== operation.operationId || this.operation.status === 'cancelled') return;
      const next: SessionOperationState = {
        ...operation,
        status,
        completedSessions: status === 'completed' ? (operation.eligibleSessions ?? 0) : 0,
      };
      this.operation = next;
      this.change({
        ...this.state,
        sessionCatalogRevision: this.state.sessionCatalogRevision + (status === 'completed' ? 1 : 0),
        sessionOperation: next,
      });
      if (status !== 'completed') this.advancePrune(operation, status === 'running' ? 'reclaiming' : 'completed');
    }, 10);
    this.operationTimer.unref?.();
  }

  private cancelOperation(): SessionOperationState {
    const operation = this.operation!;
    if (this.operationTimer) clearTimeout(this.operationTimer);
    this.operationTimer = undefined;
    const cancelled = { ...operation, status: 'cancelled' as const };
    this.operation = cancelled;
    this.change({ ...this.state, sessionOperation: cancelled });
    return cancelled;
  }

  simulateAdvertising(advertising: boolean): void {
    this.advertising = advertising;
    if (advertising) this.simulateDiscovery(discoveredBoard);
  }

  simulateForeground(foreground: boolean): void {
    if (foreground === this.foreground) return;
    this.foreground = foreground;
    if (!foreground) this.cancelAutoConnect();
    else {
      this.autoConnect = this.state.activeConnection ? 'closed' : 'waiting';
      this.stepAutoConnect();
    }
  }

  /** Fresh scan input; a state read or socket recreation never replays it. */
  simulateDiscovery(device: DiscoveredDevice): void {
    this.change({ ...this.state, discoveredDevices: [device] });
    this.observeAutoConnect(device);
  }

  private cancelAutoConnect(): void {
    this.autoConnect = 'closed';
    if (this.autoConnectTimer) clearTimeout(this.autoConnectTimer);
    this.autoConnectTimer = undefined;
    if (this.state.bluetooth.scanning)
      this.change({ ...this.state, bluetooth: { ...this.state.bluetooth, scanning: false } });
  }

  simulateBluetooth(bluetooth: Partial<AppState['bluetooth']>): void {
    this.change({ ...this.state, bluetooth: { ...this.state.bluetooth, ...bluetooth } });
    this.stepAutoConnect();
  }

  private autoConnectReady(): boolean {
    const bt = this.state.bluetooth;
    return (
      this.state.settings.safetyDisclaimerAccepted &&
      bt.radio === 'powered_on' &&
      ['granted', 'not_required'].includes(bt.scanPermission) &&
      ['granted', 'not_required'].includes(bt.connectPermission) &&
      !this.state.permissions.some(
        (p) =>
          p.permission === 'location' &&
          !p.optional &&
          (p.status !== 'granted' || p.accuracy !== 'precise' || p.servicesEnabled !== true)
      )
    );
  }

  private stepAutoConnect(): void {
    if (!this.foreground || this.state.activeConnection) return;
    if (typeof this.autoConnect === 'number' && Date.now() >= this.autoConnect) {
      this.cancelAutoConnect();
      return;
    }
    if (!this.autoConnectReady()) {
      if (typeof this.autoConnect === 'number' && this.state.bluetooth.scanning)
        this.change({ ...this.state, bluetooth: { ...this.state.bluetooth, scanning: false } });
      return;
    }
    if (!this.state.settings.autoConnectSavedDeviceId || this.autoConnect === 'closed') return;
    if (this.autoConnect === 'waiting') {
      this.autoConnect = Date.now() + 15_000;
      this.autoConnectTimer = setTimeout(() => this.cancelAutoConnect(), 15_000);
      this.autoConnectTimer.unref?.();
    }
    this.change({ ...this.state, bluetooth: { ...this.state.bluetooth, scanning: true } });
    if (this.advertising) this.simulateDiscovery(discoveredBoard);
  }

  private observeAutoConnect(device: DiscoveredDevice): void {
    if (
      typeof this.autoConnect !== 'number' ||
      Date.now() >= this.autoConnect ||
      !this.foreground ||
      !this.autoConnectReady() ||
      this.state.activeConnection
    )
      return;
    const board = this.state.savedDevices.find((b) => b.savedDeviceId === this.state.settings.autoConnectSavedDeviceId);
    if (
      !board?.bluetoothIdentifier ||
      device.savedDeviceId !== board.savedDeviceId ||
      device.deviceId !== discoveredBoard.deviceId
    )
      return;
    this.cancelAutoConnect();
    this.handle({ id: 0, method: 'device.connect', params: { deviceId: device.deviceId, trackingMode: 'saved' } });
  }

  private scheduleDiscoveryExpiry() {
    if (this.discoveryExpiryTimer) clearTimeout(this.discoveryExpiryTimer);
    this.discoveryExpiryTimer = setTimeout(() => {
      this.discoveryExpiryTimer = undefined;
      if (!this.state.discoveredDevices.length) return;
      this.change({ ...this.state, discoveredDevices: [] });
    }, 120_000);
    this.discoveryExpiryTimer.unref();
  }

  private change(next: AppState, catalogChanged = false) {
    const active = next.activeConnection;
    const previous = this.state.activeConnection;
    if (
      active?.state === 'ready' &&
      (previous?.state !== 'ready' ||
        previous.activeSession?.sessionId !== active.activeSession?.sessionId ||
        JSON.stringify(previous.controllerConnection) !== JSON.stringify(active.controllerConnection))
    )
      this.captureConnectionContext(active, previous?.state !== 'ready');
    const estimate = this.battery.update(
      next.activeConnection,
      this.profiles.get(next.activeConnection?.savedDeviceId ?? '')
    );
    if (next.activeConnection)
      next = {
        ...next,
        activeConnection: {
          ...next.activeConnection,
          batteryEstimate: estimate,
          latestLocation:
            next.activeConnection.latestLocation &&
            (!next.settings.locationRecordingEnabled ||
              !['authorized', 'foregroundOnly'].includes(next.location.status) ||
              next.activeConnection.state !== 'ready' ||
              next.activeConnection.latestSample?.rideState !== 'riding')
              ? { ...next.activeConnection.latestLocation, altitudeM: null }
              : next.activeConnection.latestLocation,
          liveWidgetSlots:
            next.activeConnection.trackingMode === 'saved'
              ? ((this.profiles.get(next.activeConnection.savedDeviceId ?? '')?.values.liveWidgetSlots as
                  | LiveWidgetSlots
                  | undefined) ?? [...defaultLiveWidgetSlots])
              : next.settings.liveWidgetSlots,
        },
      };
    const updatedActive = next.activeConnection;
    if (updatedActive?.refloatConfiguration) {
      next = {
        ...next,
        activeConnection: {
          ...updatedActive,
          refloatConfiguration: {
            ...updatedActive.refloatConfiguration,
            writeBlockReason: configurationWriteBlockReason(updatedActive),
          },
        },
      };
    }
    if (!active || active.state !== 'ready' || active.deviceId !== previous?.deviceId) {
      this.calibrationDeadline = null;
      next = {
        ...next,
        speedCalibration: { ...emptySpeedCalibration, currentDiameterMm: this.calibrationWritable ? 280 : null },
      };
    } else {
      let c = next.speedCalibration;
      if (
        ['collecting', 'refining'].includes(c.status) &&
        this.calibrationDeadline !== null &&
        Date.now() >= this.calibrationDeadline
      ) {
        c = { ...c, status: c.recommendedDiameterMm === null ? 'insufficient' : 'ready' };
        if (c.status === 'ready') this.diagnostics.recordCalibrationComplete();
        else this.diagnostics.recordCalibrationFailure();
      }
      if (!['collecting', 'refining'].includes(c.status)) this.calibrationDeadline = null;
      const reason =
        c.status === 'applied'
          ? 'applied'
          : !this.calibrationWritable
            ? 'unsupportedSetup'
            : active.latestSample?.rideState !== 'idle'
              ? 'stopRiding'
              : c.status !== 'ready' || c.recommendedDiameterMm === null
                ? 'notReady'
                : null;
      next = { ...next, speedCalibration: { ...c, applyAvailable: reason === null, applyBlockReason: reason } };
    }
    this.state = {
      ...next,
      savedDevices: catalogChanged ? this.refreshSummaries(this.sessionCatalog, next.savedDevices) : next.savedDevices,
      revision: this.state.revision + 1,
      sessionCatalogRevision: catalogChanged
        ? this.state.sessionCatalogRevision + 1
        : this.state.sessionCatalogRevision,
    };
    this.publish({ event: 'state.changed', data: this.state });
  }

  private refreshSummaries(catalog: SessionSummary[], savedDevices = this.state.savedDevices) {
    return savedDevices.map((device) => {
      const sessions = catalog.filter((item) => item.deviceHistoryId === device.deviceHistoryId);
      const distances = sessions
        .map((item) => item.distanceM)
        .filter((value): value is number => typeof value === 'number');
      return {
        ...device,
        summary: {
          sessionCount: sessions.length,
          totalStorageBytes: sessions.reduce((total, item) => total + 4096 + item.sampleCount * 256, 0),
          totalRidingElapsedMs: sessions.reduce((total, item) => total + item.ridingElapsedMs, 0),
          totalDistanceM: distances.length ? distances.reduce((total, value) => total + value, 0) : null,
          mostRecentSessionAt: sessions.slice().sort(compareSessions)[0]?.startedAt ?? null,
        },
      };
    });
  }
}

function success(id: number, result: unknown): Response {
  return { id, result };
}

function accepted(id: number): Response {
  return success(id, { accepted: true });
}

function failure(id: number, code: BackendError['code'], message: string): Response {
  return { id, error: { code, message } };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function validRefloatIdentity(value: unknown): RefloatConfigurationIdentity | null {
  const identity = asObject(value);
  if (
    !identity ||
    identity.packageName !== 'refloat' ||
    typeof identity.packageVersion !== 'string' ||
    typeof identity.schemaFingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/.test(identity.schemaFingerprint) ||
    integer(identity.wireSignature) === null ||
    Number(identity.wireSignature) < 0 ||
    Number(identity.wireSignature) > 0xffff_ffff
  )
    return null;
  return identity as unknown as RefloatConfigurationIdentity;
}

function sameRefloatIdentity(left: RefloatConfigurationIdentity, right: RefloatConfigurationIdentity): boolean {
  return (
    left.packageName === right.packageName &&
    left.packageVersion === right.packageVersion &&
    left.schemaFingerprint === right.schemaFingerprint &&
    left.wireSignature === right.wireSignature
  );
}

function validRefloatValuesFor(fields: RefloatConfigurationField[], value: Record<string, unknown>): boolean {
  const expected = fields.map((field) => field.name).sort();
  if (Object.keys(value).sort().join('\0') !== expected.join('\0')) return false;
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_REFLOAT_CONFIGURATION_JSON_BYTES) return false;
  return fields.every((field) => {
    const typed = asObject(value[field.name]);
    if (!typed || Object.keys(typed).sort().join(',') !== 'type,value') return false;
    switch (field.type) {
      case 'double':
        return (
          typed.type === 'double' &&
          typeof typed.value === 'number' &&
          Number.isFinite(typed.value) &&
          typed.value >= (field.minimum ?? -Infinity) &&
          typed.value <= (field.maximum ?? Infinity)
        );
      case 'integer':
      case 'enum':
      case 'bitfield':
        return typed.type === 'integer' && Number.isSafeInteger(typed.value);
      case 'boolean':
        return typed.type === 'boolean' && typeof typed.value === 'boolean';
      case 'string':
        return (
          typed.type === 'string' && typeof typed.value === 'string' && Buffer.byteLength(typed.value, 'utf8') <= 4_096
        );
    }
  });
}

function validRefloatValues(value: Record<string, unknown>): boolean {
  return validRefloatValuesFor(refloatFields, value);
}

function validRefloatTuneValues(value: Record<string, unknown>): boolean {
  return validRefloatValuesFor(
    refloatFields.filter((field) => field.tunable),
    value
  );
}

function boundedText(value: unknown, maximumBytes: number, nullable: boolean): string | null | undefined {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || Buffer.byteLength(trimmed, 'utf8') > maximumBytes) return nullable ? undefined : null;
  return trimmed;
}

function encodeRefloatPageCursor(page: number): string {
  return Buffer.from(JSON.stringify({ page, fingerprint: refloatIdentity.schemaFingerprint }), 'utf8').toString(
    'base64'
  );
}

function decodeRefloatPageCursor(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_REFLOAT_CONFIGURATION_CURSOR_BYTES)
    return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as Record<string, unknown>;
    return decoded.fingerprint === refloatIdentity.schemaFingerprint && Number.isInteger(decoded.page)
      ? Number(decoded.page)
      : null;
  } catch {
    return null;
  }
}

function encodeTuneCursor(offset: number, identity: RefloatConfigurationIdentity | null): string {
  return Buffer.from(JSON.stringify({ offset, identity }), 'utf8').toString('base64');
}

function decodeTuneCursor(value: unknown, identity: RefloatConfigurationIdentity | null): number | null {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_REFLOAT_TUNE_CURSOR_BYTES) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as Record<string, unknown>;
    return (identity === null
      ? decoded.identity === null
      : !!validRefloatIdentity(decoded.identity) &&
        sameRefloatTuneIdentity(decoded.identity as RefloatConfigurationIdentity, identity)) &&
      Number.isInteger(decoded.offset) &&
      Number(decoded.offset) >= 0
      ? Number(decoded.offset)
      : null;
  } catch {
    return null;
  }
}

function isRefloatControl(value: unknown): value is RefloatControl {
  return value === 'package' || value === 'flywheel' || value === 'leds' || value === 'headlights';
}

function refloatControlField(
  control: RefloatControl
): 'packageEnabled' | 'flywheelEnabled' | 'ledsEnabled' | 'headlightsEnabled' {
  switch (control) {
    case 'package':
      return 'packageEnabled';
    case 'flywheel':
      return 'flywheelEnabled';
    case 'leds':
      return 'ledsEnabled';
    case 'headlights':
      return 'headlightsEnabled';
  }
}

function shutdownAvailable(active: ActiveConnection): boolean {
  return (
    active.state === 'ready' &&
    active.firmware?.accessMode === 'readWrite' &&
    ['6.05', '6.06', '7.00'].includes(active.firmware.vescVersion) &&
    active.latestSample?.rideState === 'idle' &&
    active.refloatControls?.flywheelEnabled !== true &&
    active.refloatControls?.pendingAction === null &&
    active.controllerActions.pendingAction === null
  );
}

function validBmsConnection(value: BmsState['connection']): boolean {
  return (
    value === null ||
    value.kind === 'direct' ||
    (value.kind === 'can' && Number.isInteger(value.canId) && value.canId >= 0 && value.canId <= 253)
  );
}

function compareBmsCandidates(left: BmsCandidate, right: BmsCandidate): number {
  const leftId = left.connection.kind === 'can' ? left.connection.canId : -1;
  const rightId = right.connection.kind === 'can' ? right.connection.canId : -1;
  return leftId - rightId;
}

function validBmsState(value: BmsState): boolean {
  if (!validBmsConnection(value.connection) || value.candidates.length > 16) return false;
  if (value.candidates.some((candidate) => !validBmsConnection(candidate.connection))) return false;
  const snapshot = value.latestSnapshot;
  if (snapshot) {
    if (
      snapshot.cellVoltagesV.length > 50 ||
      snapshot.balancing.length !== snapshot.cellVoltagesV.length ||
      snapshot.temperaturesC.length > 50 ||
      !Number.isFinite(snapshot.highestCircuitryTemperatureC) ||
      (snapshot.status !== null && new TextEncoder().encode(snapshot.status).length > 40) ||
      !Number.isInteger(snapshot.reportedCanId) ||
      snapshot.reportedCanId < 0 ||
      snapshot.reportedCanId > 253
    )
      return false;
    const numbers = Object.entries(snapshot)
      .filter(([key]) => !['observedAt', 'balancing', 'status', 'dataVersion'].includes(key))
      .flatMap(([, item]) => (Array.isArray(item) ? item : [item]));
    if (numbers.some((item) => typeof item !== 'number' || !Number.isFinite(item))) return false;
  }
  switch (value.status) {
    case 'not_found':
      return value.connection === null && value.candidates.length === 0 && snapshot === null;
    case 'attached':
      return value.connection !== null && value.candidates.length === 0 && snapshot !== null;
    case 'ambiguous':
      return value.connection === null && value.candidates.length >= 2 && snapshot === null;
    case 'discovering':
    case 'unavailable':
      return true;
  }
}

function compareSessions(left: SessionSummary, right: SessionSummary): number {
  const startedAt = right.startedAt.localeCompare(left.startedAt);
  return startedAt || right.sessionId.localeCompare(left.sessionId);
}

function emptySummary(): BoardHistorySummary {
  return {
    sessionCount: 0,
    totalRidingElapsedMs: 0,
    totalDistanceM: null,
    mostRecentSessionAt: null,
    totalStorageBytes: 0,
  };
}

function parseArchiveIdentity(archive: Uint8Array): {
  sessionId: string;
  deviceHistoryId: string;
  displayName: string;
} {
  try {
    const text = new TextDecoder().decode(archive);
    const value = JSON.parse(text) as { sessionId?: unknown; deviceHistoryId?: unknown; displayName?: unknown };
    if (
      typeof value.sessionId !== 'string' ||
      !/^[A-Za-z0-9-]{1,128}$/.test(value.sessionId) ||
      typeof value.deviceHistoryId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.deviceHistoryId)
    ) {
      throw new Error('Session archive is missing a valid board identity');
    }
    return {
      sessionId: value.sessionId,
      deviceHistoryId: value.deviceHistoryId,
      displayName:
        typeof value.displayName === 'string' && value.displayName.trim()
          ? value.displayName.trim().slice(0, 128)
          : 'Imported board',
    };
  } catch {
    throw new Error('Session archive is missing a valid board identity');
  }
}

function configurationWriteBlockReason(active: ActiveConnection): RefloatConfigurationWriteBlockReason | null {
  const summary = active.refloatConfiguration!;
  if (active.state !== 'ready') return 'reconnecting';
  if (summary.availability === 'loading') return 'loading';
  if (summary.availability !== 'ready') return 'unavailable';
  if (active.firmware?.accessMode !== 'readWrite') return 'readOnly';
  if (
    summary.pendingOperation !== null ||
    active.refloatControls?.pendingAction != null ||
    active.controllerActions.pendingAction !== null
  )
    return 'busy';
  const sample = active.latestSample;
  if (active.refloatControls?.flywheelEnabled || sample?.packageMode === 'flywheel') return 'flywheel';
  if (active.refloatControls?.imuTimeoutAvailable) {
    if (sample?.imuTimeoutActive === true) return 'imuTimeoutActive';
    if (sample?.imuTimeoutActive !== false) return 'imuTimeoutUnconfirmed';
  }
  if (!sample || sample.rideState === 'unknown' || !sample.packageState || !sample.packageMode) return 'stateUnknown';
  if (sample.rideState === 'riding') return 'riding';
  if (sample.rideState !== 'idle' || sample.packageState !== 'ready') return 'packageNotReady';
  if (sample.packageMode !== 'normal') return 'modeNotNormal';
  if (!summary.currentLoaded) return 'currentRequired';
  return null;
}
