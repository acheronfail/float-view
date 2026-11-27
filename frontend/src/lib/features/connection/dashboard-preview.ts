import type { ActiveConnection, LiveLocation, LiveSample } from '$lib/backend/contract';
import type { LiveHistory } from './live-history';
import type { LightingControl } from './lighting';

/** Only the interactive board surface receives these temporary example controls. */
export interface PreviewInteractions {
  readonly lighting: Readonly<Record<LightingControl, boolean>>;
  toggleLighting(control: LightingControl): void;
}

/** Presentation facts shared by live rendering and the isolated layout preview. */
export type DashboardConnection = Pick<
  ActiveConnection,
  | 'savedDeviceId'
  | 'state'
  | 'latestSample'
  | 'latestLocation'
  | 'batteryEstimate'
  | 'batteryWarning'
  | 'bms'
  | 'refloatControls'
  | 'activeSession'
  | 'liveWidgetSlots'
  | 'trackingMode'
  | 'deviceKind'
>;

// Deliberately fixed: these examples never enter authoritative backend state.
export const previewNowMs = Date.UTC(2026, 0, 1, 12);
export const previewLocation: LiveLocation = {
  altitudeM: 128,
  latitude: 0,
  longitude: 0,
  accuracyM: null,
  observedAt: new Date(previewNowMs).toISOString(),
};
const sample: LiveSample = {
  load: { duty: 0.42, motor: 0.3, battery: 0.2, winner: { source: 'duty', fraction: 0.42 } },
  sequence: 1,
  observedAt: new Date(previewNowMs).toISOString(),
  slowObservedAt: new Date(previewNowMs).toISOString(),
  elapsedMs: 12 * 60_000,
  ridingElapsedMs: 10 * 60_000,
  rideState: 'riding',
  packageState: null,
  packageMode: null,
  footpadState: 'both',
  stopCondition: null,
  setpointAdjustment: null,
  wheelslip: false,
  darkride: false,
  charging: false,
  alertReason: null,
  firmwareFault: null,
  imuTimeoutActive: false,
  imuTimeoutHistory: [],
  fatalErrorLatched: false,
  lastFirmwareFault: null,
  faultHistory: [],
  packVoltageV: 78.4,
  dutyCycle: 0.42,
  controllerTempC: 38,
  motorTempC: 46,
  motorCurrentA: 18.5,
  batteryCurrentA: 7.2,
  erpm: 4200,
  speedKph: 24.6,
  maxSpeedKph: 32.8,
  pitchDeg: 1.2,
  balancePitchDeg: null,
  rollDeg: 0.8,
  directionalMotorCurrentA: null,
  filteredMotorCurrentA: null,
  requestedBalanceCurrentA: null,
  boosterCurrentA: null,
  fieldWeakeningCurrentA: null,
  footpadAdc1V: 2.8,
  footpadAdc2V: 2.7,
  remoteInput: null,
  setpointDeg: null,
  atrSetpointDeg: null,
  brakeTiltSetpointDeg: null,
  torqueTiltSetpointDeg: null,
  turnTiltSetpointDeg: null,
  remoteSetpointDeg: null,
  atrAccelerationDifferenceErpmPerSecond: null,
  atrSpeedBoost: null,
  distanceM: 4200,
  odometerM: 128400,
  ampHoursDrawnAh: 1.2,
  ampHoursChargedAh: 0.15,
  wattHoursDrawnWh: 96,
  wattHoursChargedWh: 12,
  batteryLevel: 0.76,
  chargingCurrentA: null,
  chargingVoltageV: null,
  extensions: {},
};

export function dashboardPreview(savedDeviceId: string): DashboardConnection {
  return {
    savedDeviceId,
    state: 'ready',
    deviceKind: 'board',
    trackingMode: 'saved',
    latestSample: sample,
    latestLocation: previewLocation,
    liveWidgetSlots: ['empty', 'powerW', 'elapsedMs', 'odometerM', 'distanceM'],
    activeSession: null,
    batteryWarning: null,
    bms: { status: 'not_found', connection: null, candidates: [], latestSnapshot: null },
    refloatControls: {
      status: 'ready',
      writable: false,
      packageEnabled: true,
      flywheelEnabled: false,
      lightingAvailable: true,
      ledsEnabled: true,
      headlightsEnabled: false,
      fatalErrorClearAvailable: false,
      imuTimeoutAvailable: false,
      fatalErrorLatched: false,
      fatalErrorActive: false,
      fatalErrorClearable: false,
      pendingAction: null,
    },
    batteryEstimate: {
      level: 0.76,
      profileId: null,
      seriesCount: 20,
      sampleSequence: 1,
      profileRevision: null,
      catalogVersion: '',
      method: 'voltage_smoothed',
      provisional: false,
      mode: 'voltage_only',
      unavailableReason: null,
    },
  };
}

export const previewHistory: LiveHistory = {
  now: 30_000,
  stale: false,
  points: Array.from({ length: 31 }, (_, i) => ({
    time: i * 1000,
    capturedAtMs: previewNowMs - (30 - i) * 1000,
    sample: { ...sample, speedKph: 22 + Math.sin(i / 5) * 3, motorCurrentA: 18 + Math.sin(i / 3) * 6 },
    estimatedLevel: 0.76,
    bms: null,
    location: {
      altitudeM: 128 + Math.sin(i / 5) * 6,
      observedAt: new Date(previewNowMs - (30 - i) * 1000).toISOString(),
    },
  })),
};
