import { defaultLiveWidgetSlots } from './contract';
import type { SessionExportProgress, ExportResult } from './contract';
import { validateRideMarker } from './session-data';
import type {
  AppState,
  AppImportSummary,
  UiCheckpoint,
  PermissionRow,
  BluetoothState,
  BoardProfile,
  SessionMetadata,
  SessionListPage,
  SessionPrunePreview,
  SessionSummary,
  Settings,
  LiveWidgetField,
  LiveWidgetSlots,
  RefloatControl,
  RefloatConfigurationIdentity,
  RefloatEditorDraft,
  RefloatConfigurationSchemaPage,
  RefloatConfigurationSummary,
  RefloatConfigurationValue,
  RefloatConfigurationValues,
  RefloatTune,
  RefloatTuneListPage,
} from '$lib/backend/contract';
import { connectBootstrap, loadBootstrap, type FrontendPlatform } from './bootstrap';
import { ApiRequestError, ApiRequestTimeoutError, type ApiClient } from './client';
import { SessionDataClient } from './session-data-client';
import { SessionReviewController } from './session-controller';
import { SessionExportClient, triggerBrowserDownload, type SessionExportFormat } from './session-export-client';
import { SessionImportClient } from './session-import-client';
import type { SessionDataRequest, SessionDataResult } from './session-data';

export type BackendConnectionStatus = 'starting' | 'connected' | 'reconnecting' | 'failed';
export type PermissionOutcome = 'ready' | 'pending' | 'denied' | 'restricted';
export type TrackingMode = 'saved' | 'guest';

export function permissionOutcome(state: BluetoothState): PermissionOutcome {
  switch (state.scanPermission) {
    case 'granted':
    case 'not_required':
      return 'ready';
    case 'denied':
      return 'denied';
    case 'restricted':
      return 'restricted';
    default:
      return 'pending';
  }
}

export class BackendState {
  boardExport = $state<
    | (Omit<SessionExportProgress, 'phase'> & {
        phase: SessionExportProgress['phase'] | 'preparing' | 'downloading';
        cancelRequested: boolean;
        app: boolean;
      })
    | null
  >(null);
  private exportAbort: AbortController | null = null;

  async cancelBoardExport(): Promise<void> {
    const current = this.boardExport;
    if (!current || current.cancelRequested) return;
    if (current.phase === 'downloading' || (current.phase === 'ready' && this.platform === 'web')) {
      current.cancelRequested = true;
      this.exportAbort?.abort();
      return;
    }
    if (current.phase === 'ready') return;
    current.cancelRequested = true;
  }

  private pruneRefresh: { operationId: string; sessionId: string } | null = null;
  status = $state<BackendConnectionStatus>('starting');
  snapshot = $state<AppState | null>(null);
  error = $state<string | null>(null);
  scanError = $state<string | null>(null);
  scanPermissionPending = $state(false);
  permissionError = $state<string | null>(null);
  permissionBusy = $state(false);
  selectedSession = $state<SessionSummary | null>(null);
  sessionNotFound = $state(false);
  boardProfileNotFound = $state(false);
  sessionMetadata = $state<SessionMetadata | null>(null);
  selectedBoardProfile = $state<BoardProfile | null>(null);
  exportStatus = $state<string | null>(null);
  busy = $state(false);
  sessionImporting = $state(false);
  platform = $state<FrontendPlatform>('web');
  private boardProfileGeneration = 0;
  private client: ApiClient | null = null;
  private sessionDataClient: SessionDataClient | null = null;
  private sessionExportClient: SessionExportClient | null = null;
  private sessionImportClient: SessionImportClient | null = null;
  private connecting: Promise<void> | null = null;
  private unsubscribeClosed: (() => void) | null = null;
  private unsubscribeState: (() => void) | null = null;
  private diagnosticReport: { id: string; expires: number; client: ApiClient } | null = null;
  private diagnosticExportWork: Promise<ExportResult> | null = null;

  constructor(
    private readonly bootstrapLoader = loadBootstrap,
    private readonly bootstrapConnector = connectBootstrap
  ) {}

  get savedDevices() {
    return this.snapshot?.savedDevices ?? [];
  }

  get discoveredDevices() {
    return this.snapshot?.discoveredDevices ?? [];
  }

  get scanning() {
    return this.snapshot?.bluetooth.scanning ?? false;
  }

  get firmware() {
    return this.snapshot?.activeConnection?.firmware ?? null;
  }

  get refloatControls() {
    return this.snapshot?.activeConnection?.refloatControls ?? null;
  }

  get sessionCatalogRevision() {
    return this.snapshot?.sessionCatalogRevision ?? 0;
  }

  get settings() {
    return this.snapshot?.settings ?? null;
  }

  async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = this.connectNow();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connectNow(): Promise<void> {
    this.diagnosticReport = null;
    this.diagnosticExportWork = null;
    this.status = this.client ? 'reconnecting' : 'starting';
    this.unsubscribeClosed?.();
    this.unsubscribeState?.();
    this.client?.close();
    this.client = null;
    try {
      const bootstrap = await this.bootstrapLoader();
      this.client = await this.bootstrapConnector(bootstrap);
      this.sessionDataClient = new SessionDataClient(bootstrap);
      this.sessionExportClient = new SessionExportClient(bootstrap);
      this.sessionImportClient = new SessionImportClient(bootstrap);
      this.platform = bootstrap.platform ?? 'web';
      this.unsubscribeClosed = this.client.onClosed(() => {
        this.diagnosticReport = null;
        this.diagnosticExportWork = null;
        this.status = 'failed';
        this.permissionError = 'Disconnected. Reconnect to update access.';
      });
      this.unsubscribeState = this.client.onStateChanged((state) => this.acceptState(state));
      this.acceptState(await this.client.request('state.get', {}));
      this.status = 'connected';
      this.permissionError = null;
      this.error = null;
    } catch (error) {
      this.status = 'failed';
      this.error = message(error);
    }
  }

  async speedCalibration(action: 'start' | 'finish' | 'cancel' | 'apply', diameterMm?: number): Promise<boolean> {
    return this.run(async (client) => {
      if (action === 'start') await client.request('speedCalibration.start', { diameterMm: diameterMm! }, 12_000);
      else await client.request(`speedCalibration.${action}`, {}, 12_000);
    });
  }

  async exportDiagnostics(): Promise<ExportResult> {
    if (this.diagnosticExportWork) return this.diagnosticExportWork;
    const client = this.client;
    if (!client?.isOpen) throw new Error('Backend is not connected');
    const work = (async () => {
      const list = await client.request('diagnostics.list', {}, 35_000).catch((error) => {
        throw diagnosticExportFailure('read diagnostic status', error);
      });
      if (list.persistence === 'memoryOnly') throw new Error('Could not open saved diagnostics.');
      const previous = this.diagnosticReport;
      this.diagnosticReport = null;
      const started = Date.now();
      const prepared = await client
        .request(
          'diagnostics.prepare',
          {
            incidentId: list.incidents[0]?.incidentId ?? null,
            ...(previous?.client === client && started < previous.expires ? { replaceReportId: previous.id } : {}),
          },
          35_000
        )
        .catch((error) => {
          throw diagnosticExportFailure('create the diagnostic file', error);
        });
      // The report belongs to this connection, so navigation must not lose its
      // replacement handle and consume another bounded service slot.
      this.diagnosticReport = { client, id: prepared.reportId, expires: started + prepared.expiresInMs };
      return client.request('diagnostics.export', { reportId: prepared.reportId }, 35_000).catch((error) => {
        throw diagnosticExportFailure('open diagnostic sharing', error);
      });
    })();
    this.diagnosticExportWork = work;
    try {
      return await work;
    } finally {
      if (this.diagnosticExportWork === work) this.diagnosticExportWork = null;
    }
  }

  async diagnosticRequest<M extends import('./contract').BackendMethod>(
    method: M,
    params: import('./contract').BackendParams<M>
  ): Promise<import('./contract').BackendResult<M>> {
    if (!this.client?.isOpen) throw new Error('Backend is not connected');
    return this.client.request(method, params, 35_000);
  }

  async getUiCheckpoint(): Promise<UiCheckpoint | null> {
    if (!this.client?.isOpen) throw new Error('Backend is not connected');
    return this.client.request('uiState.get', {});
  }

  async setUiCheckpoint(checkpoint: UiCheckpoint | null): Promise<void> {
    if (!this.client?.isOpen) throw new Error('Backend is not connected');
    await this.client.request('uiState.set', { checkpoint });
  }

  async validateUiTarget(
    route: import('./contract').UiRoute,
    surface: import('./contract').UiSurface | null
  ): Promise<void> {
    if (!this.client?.isOpen) throw new Error('Backend is not connected');
    if (route.kind === 'session') await this.client.request('session.get', { sessionId: route.sessionId });
    if (surface?.kind === 'boardConfiguration')
      await this.client.request('boardProfile.get', { savedDeviceId: surface.savedDeviceId });
  }

  async scan(): Promise<void> {
    if (this.permissionBusy || this.snapshot?.permissions.some((row) => row.pending)) return;
    const bluetooth = this.snapshot?.bluetooth;
    if (
      bluetooth &&
      (['powered_off', 'unsupported', 'resetting'].includes(bluetooth.radio) ||
        ['denied', 'restricted'].includes(bluetooth.scanPermission))
    ) {
      this.scanError = null;
      return;
    }
    await this.run(async (client) => {
      try {
        await client.request('bluetooth.scan', { timeoutMs: 5_000 });
      } catch (error) {
        if (!(error instanceof ApiRequestError) || error.code !== 'permission_required') {
          if (error instanceof ApiRequestError && error.code === 'unavailable') {
            throw new Error(
              'Scanning is temporarily unavailable. Check Bluetooth and permissions in Settings, then try again.'
            );
          }
          throw error;
        }
        this.permissionBusy = true;
        this.scanPermissionPending = true;
        let bluetooth: BluetoothState;
        try {
          bluetooth = await client.request('bluetooth.requestPermission', {}, 35_000);
        } finally {
          this.permissionBusy = false;
          this.scanPermissionPending = false;
        }
        if (permissionOutcome(bluetooth) !== 'ready') {
          throw new Error('Bluetooth permission is required before scanning.');
        }
        // Permission can resolve before CoreBluetooth reports its powered-on state.
        // The next authoritative state lets the discovery loop resume safely.
        if (bluetooth.radio !== 'powered_on') return;
        await client.request('bluetooth.scan', { timeoutMs: 5_000 });
      }
    }, 'scan');
  }

  async connectDevice(deviceId: string, trackingMode: TrackingMode = 'saved'): Promise<boolean> {
    return this.run((client) => client.request('device.connect', { deviceId, trackingMode }).then(() => undefined));
  }

  async extendRidePause(sessionId: string): Promise<boolean> {
    return this.run((client) => client.request('session.extendPause', { sessionId }).then(() => undefined));
  }

  async endRide(sessionId: string): Promise<boolean> {
    return this.run((client) => client.request('session.end', { sessionId }).then(() => undefined));
  }

  async disconnectDevice(): Promise<boolean> {
    return this.run((client) => client.request('device.disconnect', {}).then(() => undefined));
  }

  async shutdownController(): Promise<boolean> {
    return this.run((client) => client.request('controller.shutdown', {}).then(() => undefined));
  }

  async setRefloatControl(control: RefloatControl, enabled: boolean): Promise<boolean> {
    return this.run((client) => client.request('refloat.control.set', { control, enabled }).then(() => undefined));
  }

  async clearRefloatFatalError(): Promise<boolean> {
    return this.run((client) => client.request('refloat.fatalError.clear', {}).then(() => undefined));
  }

  async getRefloatEditorDraft(deviceId: string): Promise<RefloatEditorDraft | null> {
    if (!this.client?.isOpen) throw new Error('Backend is not connected');
    return this.client.request('refloat.configuration.draft.get', { deviceId });
  }

  async setRefloatEditorDraft(deviceId: string, baseRevision: number, draft: RefloatEditorDraft): Promise<void> {
    if (!this.client?.isOpen) throw new Error('Backend is not connected');
    await this.client.request('refloat.configuration.draft.set', { deviceId, baseRevision, draft });
  }

  openRefloatConfiguration(): Promise<RefloatConfigurationSummary | null> {
    return this.query((client) => client.request('refloat.configuration.open', {}));
  }

  refloatConfigurationSchema(cursor: string | null = null): Promise<RefloatConfigurationSchemaPage | null> {
    return this.query((client) => client.request('refloat.configuration.schema', { cursor }));
  }

  readRefloatConfiguration(source: 'current' | 'default', refresh = true): Promise<RefloatConfigurationValues | null> {
    return this.query((client) => client.request('refloat.configuration.read', { source, refresh }));
  }

  writeRefloatConfiguration(
    identity: RefloatConfigurationIdentity,
    baseRevision: number,
    values: Record<string, RefloatConfigurationValue>
  ): Promise<RefloatConfigurationValues | null> {
    return this.query(async (client) => {
      try {
        return await client.request('refloat.configuration.write', {
          packageVersion: identity.packageVersion,
          schemaFingerprint: identity.schemaFingerprint,
          wireSignature: identity.wireSignature,
          baseRevision,
          values,
        });
      } catch (error) {
        if (error instanceof ApiRequestTimeoutError) {
          throw new Error(
            'Timed out waiting for the configuration write to be confirmed. The write may have reached the controller. Read current values before retrying.'
          );
        }
        if (error instanceof ApiRequestError && error.code === 'unavailable') {
          throw new Error(
            'The configuration write could not be confirmed. The controller may have timed out or disconnected. Read current values before retrying.'
          );
        }
        throw error;
      }
    });
  }

  listRefloatTunes(
    identity: RefloatConfigurationIdentity | null,
    limit = 50,
    cursor: string | null = null
  ): Promise<RefloatTuneListPage | null> {
    return this.query((client) => client.request('refloat.tune.list', { identity, limit, cursor }));
  }

  getRefloatTune(tuneId: string): Promise<RefloatTune | null> {
    return this.query((client) => client.request('refloat.tune.get', { tuneId }));
  }

  createRefloatTune(
    name: string,
    description: string | null,
    identity: RefloatConfigurationIdentity,
    sourceRevision: number,
    values: Record<string, RefloatConfigurationValue>
  ): Promise<RefloatTune | null> {
    return this.query((client) =>
      client.request('refloat.tune.create', {
        name,
        description,
        identity,
        sourceRevision,
        values,
      })
    );
  }

  updateRefloatTune(
    tuneId: string,
    expectedRevision: number,
    name: string,
    description: string | null,
    values: Record<string, RefloatConfigurationValue>
  ): Promise<RefloatTune | null> {
    return this.query((client) =>
      client.request('refloat.tune.update', {
        tuneId,
        expectedRevision,
        name,
        description,
        values,
      })
    );
  }

  async deleteRefloatTune(tuneId: string, expectedRevision: number): Promise<boolean> {
    return this.run((client) =>
      client.request('refloat.tune.delete', { tuneId, expectedRevision }).then(() => undefined)
    );
  }

  applyRefloatTune(
    tuneId: string,
    expectedRevision: number,
    baseRevision: number
  ): Promise<RefloatConfigurationValues | null> {
    return this.query((client) => client.request('refloat.tune.apply', { tuneId, expectedRevision, baseRevision }));
  }

  async selectController(deviceId: string, canId: number): Promise<boolean> {
    return this.run((client) => client.request('device.selectController', { deviceId, canId }).then(() => undefined));
  }

  async updateSavedDeviceName(savedDeviceId: string, customDisplayName: string | null): Promise<boolean> {
    const device = this.savedDevices.find((value) => value.savedDeviceId === savedDeviceId);
    if (!device) return false;
    return this.run(async (client) => {
      const updated = await client.request('savedDevice.update', {
        savedDeviceId,
        expectedRevision: device.revision,
        customDisplayName,
      });
      if (!this.snapshot) return;
      this.acceptState({
        ...this.snapshot,
        savedDevices: this.snapshot.savedDevices.map((value) =>
          value.savedDeviceId === savedDeviceId ? updated : value
        ),
        activeConnection:
          this.snapshot.activeConnection?.savedDeviceId === savedDeviceId
            ? {
                ...this.snapshot.activeConnection,
                name: updated.displayName,
                displayName: updated.displayName,
              }
            : this.snapshot.activeConnection,
      });
    });
  }

  async deleteSavedDevice(savedDeviceId: string): Promise<boolean> {
    return this.run(async (client) => {
      await client.request('savedDevice.delete', { savedDeviceId });
      if (this.selectedBoardProfile?.savedDeviceId === savedDeviceId) this.closeBoardProfile();
    });
  }

  async openVoiceSettings() {
    if (!this.client?.isOpen) throw new Error('Backend is not connected');
    return this.client.request('announcements.openVoiceSettings', {}, 6_000);
  }

  async testAnnouncement(kind: 'speed' | 'load' | 'combined') {
    if (!this.client?.isOpen) throw new Error('Backend is not connected');
    return this.client.request('announcements.test', { kind }, 12_000);
  }

  async updateSessionSettings(patch: Omit<Partial<Settings>, 'revision'>): Promise<boolean> {
    const settings = this.settings;
    if (!settings) return false;
    return this.run(async (client) => {
      const updated = await client.request('settings.update', {
        expectedRevision: settings.revision,
        patch,
      });
      if (this.snapshot) this.acceptState({ ...this.snapshot, settings: updated });
      if (patch.locationRecordingEnabled === true && this.snapshot?.location.permissionAction === 'requestPermission') {
        const location = await client.request('location.requestPermission', {}, 35_000);
        if (this.snapshot) this.acceptState({ ...this.snapshot, location });
      }
    });
  }

  async saveRideMarker(sessionId: string, operationId: string) {
    if (!this.client) throw new Error('Backend unavailable');
    const result = await this.client.request('session.marker.add', { sessionId, operationId });
    validateRideMarker(result.marker);
    return result.marker;
  }

  async recoverPermission(row: PermissionRow): Promise<void> {
    if (
      !this.client ||
      this.status !== 'connected' ||
      this.permissionBusy ||
      !row.action ||
      this.snapshot?.permissions.some((p) => p.pending)
    )
      return;
    this.permissionBusy = true;
    this.permissionError = null;
    try {
      await this.client.request('permissions.recover', { permission: row.permission, action: row.action }, 35_000);
      if (row.permission === 'bluetooth' || row.permission === 'location') this.scanError = null;
    } catch (error) {
      this.permissionError = error instanceof Error ? error.message : 'Permission recovery failed. Try again.';
    } finally {
      try {
        this.acceptState(await this.client.request('state.get', {}));
      } catch {
        /* Connection state handles reconnect. */
      }
      this.permissionBusy = false;
    }
  }

  async requestLocationPermission(): Promise<void> {
    await this.run(async (client) => {
      const action = this.snapshot?.location.permissionAction;
      const location =
        action === 'openSettings'
          ? await client.request('location.openSettings', {}, 35_000)
          : await client.request('location.requestPermission', {}, 35_000);
      if (this.snapshot) this.acceptState({ ...this.snapshot, location });
    });
  }

  async updateLiveWidgetSlot(slot: number, field: LiveWidgetField): Promise<boolean> {
    const connection = this.snapshot?.activeConnection;
    if (!connection || !Number.isInteger(slot) || slot < 0 || slot >= 5) return false;
    if (connection.trackingMode === 'guest') {
      const slots: LiveWidgetSlots = [...connection.liveWidgetSlots];
      slots[slot] = field;
      return this.updateSessionSettings({ liveWidgetSlots: slots });
    }
    const savedDeviceId = connection.savedDeviceId;
    if (!savedDeviceId) return false;
    return this.run(async () => {
      await this.saveLiveWidgetSlot(savedDeviceId, slot, field, () => {
        const active = this.snapshot?.activeConnection;
        if (
          active?.savedDeviceId !== savedDeviceId ||
          active.deviceId !== connection.deviceId ||
          active.trackingMode !== 'saved'
        )
          throw new Error('The connected board changed. Open the picker again.');
      });
    });
  }

  async saveLiveWidgetSlot(
    savedDeviceId: string,
    slot: number,
    field: LiveWidgetField,
    checkTarget?: () => void
  ): Promise<BoardProfile> {
    const client = this.client;
    if (!client?.isOpen) throw new Error('Backend is not connected');
    if (!Number.isInteger(slot) || slot < 0 || slot >= 5) throw new Error('Invalid Live box');
    for (let attempt = 0; ; attempt++) {
      const profile = await client.request('boardProfile.get', { savedDeviceId });
      checkTarget?.();
      const slots: LiveWidgetSlots = [...(profile.values.liveWidgetSlots ?? defaultLiveWidgetSlots)];
      slots[slot] = field;
      try {
        return await client.request('boardProfile.update', {
          savedDeviceId,
          expectedRevision: profile.revision,
          patch: { liveWidgetSlots: slots },
        });
      } catch (error) {
        if (attempt || !(error instanceof ApiRequestError) || error.code !== 'conflict') throw error;
      }
    }
  }

  async openBoardProfile(savedDeviceId: string): Promise<boolean> {
    const generation = ++this.boardProfileGeneration;
    this.selectedBoardProfile = null;
    const opened = await this.run(async (client) => {
      this.boardProfileNotFound = false;
      let profile: BoardProfile;
      try {
        profile = await client.request('boardProfile.get', { savedDeviceId });
      } catch (error) {
        if (generation === this.boardProfileGeneration)
          this.boardProfileNotFound = error instanceof ApiRequestError && error.code === 'not_found';
        throw error;
      }
      if (generation === this.boardProfileGeneration) this.selectedBoardProfile = profile;
    });
    return opened && generation === this.boardProfileGeneration;
  }

  /** Request-scoped profile reads do not replace an open Board Profile editor. */
  async readBoardProfile(savedDeviceId: string): Promise<BoardProfile> {
    if (!this.client?.isOpen) throw new Error('Backend is not connected');
    return this.client.request('boardProfile.get', { savedDeviceId });
  }

  async saveLastLiveView(savedDeviceId: string, lastLiveView: import('./contract').LiveViewMode): Promise<void> {
    const client = this.client;
    const checkTarget = () => {
      if (!client?.isOpen) throw new Error('Backend is not connected');
      const active = this.snapshot?.activeConnection;
      if (active?.savedDeviceId !== savedDeviceId || active.trackingMode !== 'saved')
        throw new Error('The connected board changed.');
    };
    checkTarget();
    for (let attempt = 0; attempt < 2; attempt++) {
      const profile = await client!.request('boardProfile.get', { savedDeviceId });
      checkTarget();
      if (profile.values.lastLiveView === lastLiveView) return;
      try {
        await client!.request('boardProfile.update', {
          savedDeviceId,
          expectedRevision: profile.revision,
          patch: { lastLiveView },
        });
        return;
      } catch (error) {
        if (attempt || !(error instanceof ApiRequestError) || error.code !== 'conflict') throw error;
      }
    }
  }

  async saveDashboard(
    savedDeviceId: string,
    expectedRevision: number,
    customDashboard: import('./contract').CustomDashboard
  ): Promise<BoardProfile> {
    if (!this.client?.isOpen) throw new Error('Backend is not connected');
    // Conflicts are deliberately not retried against a newer revision.
    return this.client.request('boardProfile.update', { savedDeviceId, expectedRevision, patch: { customDashboard } });
  }

  async updateBoardProfile(savedDeviceId: string, patch: Record<string, unknown>): Promise<boolean> {
    const profile = this.selectedBoardProfile;
    const generation = this.boardProfileGeneration;
    if (!profile || profile.savedDeviceId !== savedDeviceId) return false;
    return this.run(async (client) => {
      if (generation !== this.boardProfileGeneration) return;
      let updated: BoardProfile;
      try {
        updated = await client.request('boardProfile.update', {
          savedDeviceId,
          expectedRevision: profile.revision,
          patch,
        });
      } catch (error) {
        if (!(error instanceof ApiRequestError) || error.code !== 'conflict') throw error;
        if (generation !== this.boardProfileGeneration) return;
        const current = await client.request('boardProfile.get', { savedDeviceId });
        if (generation !== this.boardProfileGeneration) return;
        updated = await client.request('boardProfile.update', {
          savedDeviceId,
          expectedRevision: current.revision,
          patch,
        });
      }
      if (generation === this.boardProfileGeneration) this.selectedBoardProfile = updated;
    });
  }

  private sessionGeneration = 0;

  async readSessionMetadata(sessionId: string): Promise<SessionMetadata> {
    if (!this.client?.isOpen) throw new Error('Backend is not connected');
    return this.client.request('session.get', { sessionId });
  }

  async openSession(sessionId: string): Promise<boolean> {
    const generation = ++this.sessionGeneration;
    return this.run(async (client) => {
      this.sessionNotFound = false;
      let metadata: SessionMetadata;
      try {
        metadata = await client.request('session.get', { sessionId });
      } catch (error) {
        if (generation === this.sessionGeneration)
          this.sessionNotFound = error instanceof ApiRequestError && error.code === 'not_found';
        throw error;
      }
      if (generation !== this.sessionGeneration) return;
      this.sessionMetadata = metadata;
      this.selectedSession = metadata.summary;
      this.exportStatus = null;
    });
  }

  async refreshSession(sessionId: string, accept: () => boolean): Promise<void> {
    const generation = this.sessionGeneration;
    if (!this.client?.isOpen) throw new Error('Backend is not connected');
    const metadata = await this.client.request('session.get', { sessionId });
    if (generation !== this.sessionGeneration || this.selectedSession?.sessionId !== sessionId || !accept()) return;
    this.sessionMetadata = metadata;
    this.selectedSession = metadata.summary;
  }

  async sessionHref(sessionId: string): Promise<string> {
    const opened = await this.openSession(sessionId);
    if (!opened || this.selectedSession?.sessionId !== sessionId) {
      return `#/sessions/${encodeURIComponent(sessionId)}`;
    }
    const savedDeviceId = this.savedDevices.find(
      (device) => device.deviceHistoryId === this.selectedSession?.deviceHistoryId
    )?.savedDeviceId;
    const boardQuery = savedDeviceId ? `?board=${encodeURIComponent(savedDeviceId)}` : '';
    return `#/sessions/${encodeURIComponent(sessionId)}${boardQuery}`;
  }

  async listSessions(savedDeviceId: string, limit: number, cursor: string | null = null): Promise<SessionListPage> {
    if (!this.client?.isOpen) await this.connect();
    if (!this.client?.isOpen) throw new Error('Backend is not connected');
    return this.client.request('session.list', { savedDeviceId, limit, cursor });
  }

  requestSessionData(request: SessionDataRequest, signal?: AbortSignal): Promise<SessionDataResult> {
    if (!this.sessionDataClient) return Promise.reject(new Error('Session-data endpoint is not connected'));
    return this.sessionDataClient.request(request, signal);
  }

  createSessionReviewController(metadata: SessionMetadata): SessionReviewController {
    if (!this.sessionDataClient) throw new Error('Session-data endpoint is not connected');
    return new SessionReviewController(metadata, this.sessionDataClient);
  }

  async exportSession(format: SessionExportFormat): Promise<void> {
    const session = this.selectedSession;
    if (!session) return;
    await this.run(async (client) => {
      if (this.platform === 'web') {
        if (!this.sessionExportClient) throw new Error('Session export download is not connected');
        const download = await this.sessionExportClient.download(session.sessionId, format);
        triggerBrowserDownload(download);
        this.exportStatus = `${download.fileName} downloaded.`;
        return;
      }
      const result = await client.request('session.export', {
        sessionId: session.sessionId,
        format,
      });
      this.exportStatus =
        result.delivery === 'presented'
          ? `${result.fileName} is ready to save or share.`
          : `${result.fileName} is staged by the test backend.`;
    });
  }

  async exportAppData(): Promise<void> {
    return this.exportBoardSessions(null, 'float-view-archive');
  }

  async importAppData(file: Blob, applySettings: boolean): Promise<AppImportSummary | null> {
    let summary: AppImportSummary | null = null;
    const success = await this.run(async () => {
      if (!this.sessionImportClient) throw new Error('App import is not connected');
      summary = await this.sessionImportClient.uploadApp(file, applySettings);
      this.closeSession();
      this.selectedBoardProfile = null;
    });
    return success ? summary : null;
  }

  async clearAppData(): Promise<boolean> {
    return this.run(async (client) => {
      await client.request('app.clear', {}, 10 * 60_000);
      this.closeSession();
      this.selectedBoardProfile = null;
      this.exportStatus = null;
    });
  }

  async exportBoardSessions(savedDeviceId: string | null, format: SessionExportFormat): Promise<void> {
    if (this.busy || this.boardExport) return;
    const operationId = crypto.randomUUID();
    this.exportStatus = null;
    this.boardExport = {
      operationId,
      phase: 'preparing',
      completedSessions: 0,
      totalSessions: 0,
      error: null,
      cancelRequested: false,
      app: savedDeviceId === null,
    };
    const abort = new AbortController();
    this.exportAbort = abort;
    try {
      await this.run(async (client) => {
        let settled = false;
        let failure: unknown;
        let deliver: (() => void) | undefined;
        const task = (async () => {
          if (this.platform === 'web') {
            if (!this.sessionExportClient) throw new Error('Session export download is not connected');
            const download =
              savedDeviceId === null
                ? await this.sessionExportClient.downloadApp(operationId, abort.signal)
                : await this.sessionExportClient.downloadBoard(savedDeviceId, format, operationId, abort.signal);
            deliver = () => {
              triggerBrowserDownload(download);
              this.exportStatus = `${download.fileName} downloaded.`;
            };
          } else {
            const result =
              savedDeviceId === null
                ? await client.request('app.export', { operationId }, 10 * 60_000)
                : await client.request('session.export', { savedDeviceId, format, operationId }, 10 * 60_000);
            deliver = () => {
              this.exportStatus =
                result.delivery === 'presented'
                  ? `${result.fileName} is ready to save or share.`
                  : `${result.fileName} is staged by the test backend.`;
            };
          }
        })()
          .catch((error) => {
            failure = error;
          })
          .finally(() => {
            settled = true;
          });
        while (!settled) {
          const current = this.boardExport;
          if (!current) break;
          try {
            const progress = await client.request(
              current.cancelRequested ? 'session.export.cancel' : 'session.export.status',
              { operationId }
            );
            Object.assign(current, progress);
            if (progress.phase === 'ready' && this.platform === 'web') current.phase = 'downloading';
          } catch {
            /* Export response is authoritative; registration may still be in flight. */
          }
          if (!settled) await new Promise((resolve) => setTimeout(resolve, 250));
        }
        await task;
        let final: SessionExportProgress | undefined;
        try {
          final = await client.request('session.export.status', { operationId });
        } catch {
          /* Preserve the original export failure. */
        }
        if (final?.phase === 'cancelled' || abort.signal.aborted) {
          this.exportStatus = 'Export cancelled.';
          return;
        }
        if (failure) throw new Error(final?.error ?? (failure instanceof Error ? failure.message : String(failure)));
        deliver?.();
      });
    } finally {
      this.boardExport = null;
      this.exportAbort = null;
    }
  }

  async importSession(file: Blob): Promise<string | null> {
    let sessionId: string | null = null;
    const imported = await this.run(async () => {
      if (!this.sessionImportClient) throw new Error('Session import is not connected');
      sessionId = (await this.sessionImportClient.upload(file)).sessionId;
    });
    return imported ? sessionId : null;
  }

  async deleteSelectedSession(): Promise<boolean> {
    const session = this.selectedSession;
    if (!session) return false;
    return this.run(async (client) => {
      await client.request('session.delete', { sessionId: session.sessionId });
      this.closeSession();
    });
  }

  async previewSessionPrune(
    scope: 'one' | 'all',
    targetResolutionSeconds: number,
    sessionId?: string
  ): Promise<SessionPrunePreview | null> {
    let preview: SessionPrunePreview | null = null;
    const completed = await this.run(async (client) => {
      preview = await client.request('session.prune.preview', {
        scope,
        ...(sessionId ? { sessionId } : {}),
        targetResolutionSeconds,
      });
    });
    return completed ? preview : null;
  }

  async cancelSessionPrune(operationId: string): Promise<void> {
    await this.run(async (client) => {
      await client.request('session.prune.cancel', { operationId });
    });
  }

  async startSessionPrune(scope: 'one' | 'all', targetResolutionSeconds: number, sessionId?: string): Promise<boolean> {
    return this.run(async (client) => {
      const operation = await client.request('session.prune.start', {
        scope,
        ...(sessionId ? { sessionId } : {}),
        targetResolutionSeconds,
      });
      if (scope === 'one' && sessionId && this.selectedSession?.sessionId === sessionId) {
        if (operation.status === 'completed') {
          const metadata = await client.request('session.get', { sessionId });
          this.sessionMetadata = metadata;
          this.selectedSession = metadata.summary;
        } else {
          this.pruneRefresh = { operationId: operation.operationId, sessionId };
          this.refreshAfterPrune();
        }
      }
    });
  }

  closeBoardProfile() {
    this.boardProfileGeneration++;
    this.selectedBoardProfile = null;
  }

  closeSession() {
    this.pruneRefresh = null;
    this.sessionGeneration++;
    this.selectedSession = null;
    this.sessionMetadata = null;
    this.exportStatus = null;
  }

  close() {
    this.diagnosticReport = null;
    this.diagnosticExportWork = null;
    this.pruneRefresh = null;
    this.unsubscribeClosed?.();
    this.unsubscribeState?.();
    this.unsubscribeState = null;
    this.client?.close();
    this.client = null;
    this.sessionDataClient = null;
    this.sessionExportClient = null;
    this.sessionImportClient = null;
    this.platform = 'web';
  }

  private acceptState(state: AppState) {
    if (this.snapshot && state.revision < this.snapshot.revision) return;
    this.snapshot = state;
    this.refreshAfterPrune();
  }

  private refreshAfterPrune() {
    const pending = this.pruneRefresh;
    const operation = this.snapshot?.sessionOperation;
    if (
      !pending ||
      operation?.operationId !== pending.operationId ||
      !['completed', 'cancelled', 'failed'].includes(operation.status)
    )
      return;
    this.pruneRefresh = null;
    if (this.selectedSession?.sessionId === pending.sessionId) void this.openSession(pending.sessionId);
  }

  private async run(
    action: (client: ApiClient) => Promise<void>,
    errorTarget: 'general' | 'scan' = 'general'
  ): Promise<boolean> {
    if (!this.client?.isOpen) await this.connect();
    if (!this.client?.isOpen) return false;
    this.busy = true;
    if (errorTarget === 'scan') this.scanError = null;
    else this.error = null;
    try {
      await action(this.client);
      return true;
    } catch (error) {
      if (errorTarget === 'scan') this.scanError = message(error);
      else this.error = message(error);
      return false;
    } finally {
      this.busy = false;
    }
  }

  private async query<T>(action: (client: ApiClient) => Promise<T>): Promise<T | null> {
    if (!this.client?.isOpen) await this.connect();
    if (!this.client?.isOpen) return null;
    this.busy = true;
    this.error = null;
    try {
      return await action(this.client);
    } catch (error) {
      this.error = message(error);
      return null;
    } finally {
      this.busy = false;
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const backendState = new BackendState();

function diagnosticExportFailure(action: string, error: unknown): Error {
  const detail =
    error instanceof ApiRequestError
      ? ` (${error.error.code})`
      : error instanceof ApiRequestTimeoutError
        ? ' (timed out)'
        : '';
  return new Error(`Could not ${action}${detail}.`);
}
