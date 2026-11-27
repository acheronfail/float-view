export const MAX_MESSAGE_BYTES = 65_536;
export const MAX_SESSION_DATA_REQUEST_BYTES = 16_384;
export const MAX_SESSION_DATA_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MAX_APP_TRANSFER_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_SESSION_IMPORT_BYTES = 128 * 1024 * 1024;
export const MAX_SESSION_DATA_FIELDS = 16;
export const MAX_SESSION_SERIES_BUCKETS = 1_024;
export const MAX_SESSION_SERIES_OBSERVATIONS = 65_536;
export const MAX_SESSION_SAMPLE_ROWS = 2_000;
export const MAX_SESSION_EVENT_ROWS = 500;
export const MAX_SESSION_LOCATION_ROWS = 2_000;
export const MAX_SESSION_LOCATION_GAPS = 2_000;
export const MAX_SESSION_CURSOR_BYTES = 512;
export const MAX_SESSION_LIST_PAGE = 100;
export const MAX_SESSION_LIST_CURSOR_BYTES = 1_024;
export const MAX_CAN_DISCOVERY_IDS = 64;
export const MAX_CONTROLLER_CANDIDATES = 16;
export const MAX_TELEMETRY_FIELDS = 64;
export const MAX_TELEMETRY_FIELD_BYTES = 64;
export const MAX_TELEMETRY_FIELD_NAME_BYTES = 4_096;
export const MAX_TELEMETRY_EXTENSIONS = 32;
export const MAX_TELEMETRY_JSON_BYTES = 16_384;
export const MAX_REFLOAT_CONFIGURATION_FIELDS = 512;
export const MAX_REFLOAT_CONFIGURATION_PAGE_FIELDS = 32;
export const MAX_REFLOAT_CONFIGURATION_GROUPS = 16;
export const MAX_REFLOAT_CONFIGURATION_SUBGROUPS = 64;
export const MAX_REFLOAT_CONFIGURATION_ENUM_CHOICES = 128;
export const MAX_REFLOAT_CONFIGURATION_NAME_BYTES = 128;
export const MAX_REFLOAT_CONFIGURATION_DESCRIPTION_BYTES = 4_096;
export const MAX_REFLOAT_CONFIGURATION_STRING_BYTES = 4_096;
export const MAX_REFLOAT_CONFIGURATION_CURSOR_BYTES = 512;
export const MAX_REFLOAT_CONFIGURATION_JSON_BYTES = 48 * 1_024;
export const MAX_REFLOAT_TUNE_NAME_BYTES = 128;
export const MAX_REFLOAT_TUNE_DESCRIPTION_BYTES = 1_024;
export const MAX_REFLOAT_TUNE_LIST_PAGE = 50;
export const MAX_REFLOAT_TUNE_CURSOR_BYTES = 512;

export type BluetoothRadioState = 'unknown' | 'unsupported' | 'powered_off' | 'powered_on' | 'resetting';

export type BluetoothPermissionState =
  | 'unknown'
  | 'not_required'
  | 'not_determined'
  | 'denied'
  | 'restricted'
  | 'granted';

export interface BluetoothState {
  radio: BluetoothRadioState;
  scanPermission: BluetoothPermissionState;
  connectPermission: BluetoothPermissionState;
  scanning: boolean;
}

export type DeviceState =
  | 'discovered'
  | 'connecting'
  | 'connected'
  | 'discovering_services'
  | 'identifying'
  | 'selecting_controller'
  | 'ready'
  | 'disconnecting'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

export interface Device {
  /** Opaque backend-issued identifier. */
  deviceId: string;
  name: string;
  state: DeviceState;
  lastSeenAt?: string | null;
}

export interface DiscoveredDevice extends Device {
  /** Latest Bluetooth scan signal strength in dBm. */
  rssi: number | null;
  /** Saved board matched by the native platform association, when known. */
  savedDeviceId: string | null;
}

export interface FirmwareInfo {
  vescVersion: string;
  packageName: string;
  packageVersion: string;
  hardwareName?: string | null;
  /** Compatibility access; recognised VESC test builds allow guarded writes. */
  accessMode: 'readOnly' | 'readWrite';
  supported: boolean;
}

/** Identity of the Bluetooth peer, independent of a motor reached through CAN.
 * Public firmware metadata only; no Bluetooth address or controller UUID. */
export interface TransportFirmwareInfo {
  vescVersion: string;
  hardwareName: string | null;
  firmwareName: string | null;
  testVersion: number;
}

export type ControllerConnection = { kind: 'direct' } | { kind: 'can'; canId: number };

export interface ControllerCandidate {
  canId: number;
  hardwareName: string | null;
  firmwareName: string | null;
  vescVersion: string;
  vescSupported: boolean;
}

export type ConnectionIssueCode =
  | 'transport_setup_failed'
  | 'identification_timeout'
  | 'no_controller_found'
  | 'too_many_can_devices'
  | 'too_many_controllers'
  | 'preferred_controller_unavailable'
  | 'controller_changed'
  | 'unsupported_controller'
  | 'unsupported_refloat'
  | 'refloat_info_invalid';

/** Display-only rejected INFO identity; never grants firmware capabilities. */
export interface RefloatCompatibility {
  /** At most 32 ASCII bytes, including the source-defined suffix. */
  reportedVersion: string;
  /** At most 32 supported stable minor ranges (for example 1.3.x) and exact prereleases. */
  supportedVersions: string[];
}

export interface ConnectionIssue {
  code: ConnectionIssueCode;
  message: string;
  /** Present only for a confirmed unsupported Refloat version. */
  refloatCompatibility?: RefloatCompatibility;
}

export type RideState = 'idle' | 'riding' | 'unknown';
export type PackageState = 'disabled' | 'startup' | 'ready' | 'running' | 'unknown';
export type PackageMode = 'normal' | 'handTest' | 'flywheel' | 'unknown';
export type FootpadState = 'none' | 'left' | 'right' | 'both' | 'unknown';
export type StopCondition =
  | 'none'
  | 'pitch'
  | 'roll'
  | 'switchHalf'
  | 'switchFull'
  | 'reverseStop'
  | 'quickStop'
  | 'imuTimeout'
  | 'unknown';
export type SetpointAdjustment =
  | 'none'
  | 'centering'
  | 'reverseStop'
  | 'speed'
  | 'duty'
  | 'error'
  | 'highVoltage'
  | 'lowVoltage'
  | 'temperature'
  | 'unknown';
export type AlertReason =
  | 'none'
  | 'lowVoltage'
  | 'highVoltage'
  | 'controllerTemperature'
  | 'motorTemperature'
  | 'current'
  | 'duty'
  | 'sensors'
  | 'lowBattery'
  | 'idle'
  | 'error'
  | 'speed'
  | 'cellUnderTemperature'
  | 'cellOverTemperature'
  | 'cellLowVoltage'
  | 'cellHighVoltage'
  | 'cellImbalance'
  | 'bmsConnection'
  | 'bmsOverTemperature'
  | 'firmwareFault'
  | 'unknown';
export type FirmwareFault =
  | 'overVoltage'
  | 'underVoltage'
  | 'driver'
  | 'absoluteOverCurrent'
  | 'controllerOverTemperature'
  | 'motorOverTemperature'
  | 'gateDriverOverVoltage'
  | 'gateDriverUnderVoltage'
  | 'mcuUnderVoltage'
  | 'watchdogReset'
  | 'encoderSpi'
  | 'encoderSinCosBelowMinimum'
  | 'encoderSinCosAboveMaximum'
  | 'flashCorruption'
  | 'currentSensorOffset1'
  | 'currentSensorOffset2'
  | 'currentSensorOffset3'
  | 'unbalancedCurrents'
  | 'brake'
  | 'resolverLossOfTracking'
  | 'resolverDegradationOfSignal'
  | 'resolverLossOfSignal'
  | 'appConfigFlashCorruption'
  | 'motorConfigFlashCorruption'
  | 'encoderNoMagnet'
  | 'encoderMagnetTooStrong'
  | 'phaseFilter'
  | 'unknown';

export interface DriveLoad {
  duty: number | null;
  motor: number | null;
  battery: number | null;
  winner: { source: 'duty' | 'motor' | 'battery'; fraction: number } | null;
}
export interface AnnouncementSettings {
  speedEnabled: boolean;
  loadEnabled: boolean;
  batteryChargeEnabled: boolean;
  footpadEnabled: boolean;
  footpadDelaySeconds: number;
  speedThresholdKph: number;
  loadThresholdPercent: number;
  repeatIntervalSeconds: number;
  volumePercent: number;
  lowerOtherAudio: boolean;
}
export const defaultAnnouncements: AnnouncementSettings = {
  speedEnabled: false,
  loadEnabled: false,
  batteryChargeEnabled: true,
  footpadEnabled: false,
  footpadDelaySeconds: 1,
  speedThresholdKph: 25,
  loadThresholdPercent: 65,
  repeatIntervalSeconds: 5,
  volumePercent: 100,
  lowerOtherAudio: true,
};
export interface AnnouncementAudio {
  status: 'initializing' | 'ready' | 'unavailable';
  reason: 'no_offline_voice' | 'engine_unavailable' | 'audio_unavailable' | null;
  loweringControl: 'adjustable' | 'automatic';
  voiceSettingsAvailable: boolean;
}
export interface FirmwareFaultEntry {
  code: number;
  reason: FirmwareFault;
  /** Approximate occurrence time; null when it cannot be placed in this ride. */
  elapsedMs: number | null;
  observedElapsedMs: number;
}
export interface ImuTimeoutEntry {
  active: boolean;
  elapsedMs: number | null;
  observedElapsedMs: number;
}
export interface LiveSample {
  /** Authoritative backend fractions and winner for this sample. */
  load: DriveLoad;
  sequence: number;
  observedAt: string;
  slowObservedAt: string | null;
  /** Session timeline, including idle and disconnected time. */
  elapsedMs: number;
  /** Native-owned accumulated time between consecutive riding observations; offline gaps excluded. */
  ridingElapsedMs: number;
  rideState: RideState;
  packageState: PackageState | null;
  packageMode: PackageMode | null;
  footpadState: FootpadState | null;
  stopCondition: StopCondition | null;
  setpointAdjustment: SetpointAdjustment | null;
  wheelslip: boolean | null;
  darkride: boolean | null;
  charging: boolean | null;
  alertReason: AlertReason | null;
  firmwareFault: FirmwareFault | null;
  /** Beta alert state; null before observation, when inactive evidence expires, or on older profiles. */
  imuTimeoutActive: boolean | null;
  /** Up to 20 actual timeout transitions; initial inactive state is excluded. */
  imuTimeoutHistory: ImuTimeoutEntry[];
  /** Persistent Refloat fatal state; independent of a momentary active fault. */
  fatalErrorLatched: boolean | null;
  /** Most recently retrieved controller fault, including one that has cleared. */
  lastFirmwareFault: { code: number; reason: FirmwareFault } | null;
  /** Most recent 20 recovered occurrences in this connection/session, oldest first. */
  faultHistory: FirmwareFaultEntry[];
  packVoltageV: number | null;
  dutyCycle: number | null;
  controllerTempC: number | null;
  motorTempC: number | null;
  motorCurrentA: number | null;
  batteryCurrentA: number | null;
  erpm: number | null;
  speedKph: number | null;
  /** Greatest absolute speed observed in the current ride; restored from committed summary on resume. */
  maxSpeedKph: number | null;
  pitchDeg: number | null;
  balancePitchDeg: number | null;
  rollDeg: number | null;
  directionalMotorCurrentA: number | null;
  filteredMotorCurrentA: number | null;
  requestedBalanceCurrentA: number | null;
  boosterCurrentA: number | null;
  fieldWeakeningCurrentA: number | null;
  footpadAdc1V: number | null;
  footpadAdc2V: number | null;
  remoteInput: number | null;
  setpointDeg: number | null;
  atrSetpointDeg: number | null;
  brakeTiltSetpointDeg: number | null;
  torqueTiltSetpointDeg: number | null;
  turnTiltSetpointDeg: number | null;
  remoteSetpointDeg: number | null;
  atrAccelerationDifferenceErpmPerSecond: number | null;
  atrSpeedBoost: number | null;
  /** Accumulated current-ride distance from observed speed; restored on resume, excluding offline gaps.
   * Historical distanceM sample columns retain the raw board trip counter. */
  distanceM: number | null;
  odometerM: number | null;
  ampHoursDrawnAh: number | null;
  ampHoursChargedAh: number | null;
  wattHoursDrawnWh: number | null;
  wattHoursChargedWh: number | null;
  /** Raw controller-reported fraction, preserved in recordings and exports. */
  batteryLevel: number | null;
  chargingCurrentA: number | null;
  chargingVoltageV: number | null;
  extensions: Record<string, number>;
}

export interface BoardHistorySummary {
  sessionCount: number;
  totalRidingElapsedMs: number;
  totalDistanceM: number | null;
  mostRecentSessionAt: string | null;
  /** Total session database and SQLite sidecar file lengths, including active sessions.
   * Excludes shared catalog, exports and temporary files; null if measurement failed. */
  totalStorageBytes: number | null;
}

export interface LiveLocation {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  /** Height in metres above the WGS84 ellipsoid. */
  altitudeM: number | null;
  observedAt: string;
}

export type BmsStatus = 'discovering' | 'not_found' | 'attached' | 'unavailable' | 'ambiguous';

export type BmsConnection = { kind: 'direct' } | { kind: 'can'; canId: number };

export interface BmsCandidate {
  connection: BmsConnection;
  hardwareName: string | null;
  vescVersion: string;
}

/** Complete live-only VBMS values. Fractions use 0...1; humidity uses percent. */
export interface BmsSnapshot {
  observedAt: string;
  totalVoltageV: number;
  chargeVoltageV: number;
  inputCurrentA: number;
  inputIcCurrentA: number;
  sessionAmpHoursAh: number;
  sessionWattHoursWh: number;
  cellVoltagesV: number[];
  balancing: boolean[];
  temperaturesC: number[];
  icTemperatureC: number;
  humiditySensorTemperatureC: number;
  humidityPercent: number;
  highestCellTemperatureC: number;
  /** Highest reported BMS circuitry temperature, excluding cell probes. */
  highestCircuitryTemperatureC: number;
  stateOfCharge: number;
  stateOfHealth: number;
  reportedCanId: number;
  lifetimeChargeAmpHoursAh: number;
  lifetimeChargeWattHoursWh: number;
  lifetimeDischargeAmpHoursAh: number;
  lifetimeDischargeWattHoursWh: number;
  pressurePa: number;
  dataVersion: number | null;
  status: string | null;
}

export interface BmsState {
  status: BmsStatus;
  connection: BmsConnection | null;
  candidates: BmsCandidate[];
  latestSnapshot: BmsSnapshot | null;
}

export type RefloatControl = 'package' | 'flywheel' | 'leds' | 'headlights';
export type RefloatPendingAction = RefloatControl | 'clearFatalError';

/** Complete authoritative, connection-scoped Refloat control state. */
export interface RefloatControls {
  status: 'loading' | 'ready' | 'unavailable';
  writable: boolean;
  packageEnabled: boolean | null;
  flywheelEnabled: boolean | null;
  lightingAvailable: boolean;
  ledsEnabled: boolean | null;
  headlightsEnabled: boolean | null;
  fatalErrorClearAvailable: boolean;
  imuTimeoutAvailable: boolean;
  fatalErrorLatched: boolean | null;
  fatalErrorActive: boolean | null;
  fatalErrorClearable: boolean | null;
  pendingAction: RefloatPendingAction | null;
}

/** Complete authoritative, connection-scoped VESC controller actions. */
export interface ControllerActions {
  shutdownAvailable: boolean;
  pendingAction: 'shutdown' | null;
}

export type RefloatConfigurationAvailability = 'loading' | 'ready' | 'unavailable';
export type RefloatConfigurationOperation = 'schema' | 'readCurrent' | 'readDefault' | 'write' | 'applyTune';

/** Shared backend admission blocker for edited configuration writes, independent of Tune policy. */
export const REFLOAT_CONFIGURATION_WRITE_BLOCK_REASONS = [
  'reconnecting',
  'loading',
  'unavailable',
  'readOnly',
  'busy',
  'flywheel',
  'imuTimeoutActive',
  'imuTimeoutUnconfirmed',
  'riding',
  'stateUnknown',
  'packageNotReady',
  'modeNotNormal',
  'currentRequired',
] as const;
export type RefloatConfigurationWriteBlockReason = (typeof REFLOAT_CONFIGURATION_WRITE_BLOCK_REASONS)[number];

export interface RefloatConfigurationSummary {
  /** Null when backend preconditions for an edited write are satisfied; draft validation remains local. */
  writeBlockReason: RefloatConfigurationWriteBlockReason | null;
  availability: RefloatConfigurationAvailability;
  /** Capability-level writable state; this alone does not establish edited-write safety. */
  writable: boolean;
  packageVersion: string | null;
  schemaFingerprint: string | null;
  wireSignature: number | null;
  currentLoaded: boolean;
  defaultLoaded: boolean;
  pendingOperation: RefloatConfigurationOperation | null;
}

export interface RefloatConfigurationIdentity {
  packageName: 'refloat';
  packageVersion: string;
  schemaFingerprint: string;
  wireSignature: number;
}

export type RefloatConfigurationValue =
  | { type: 'double'; value: number }
  | { type: 'integer'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'string'; value: string };

export type RefloatConfigurationFieldType = 'double' | 'integer' | 'enum' | 'boolean' | 'string' | 'bitfield';

export interface RefloatConfigurationField {
  name: string;
  label: string;
  /** Upstream subsection heading, repeated on every field so paging/search retain context. */
  heading: string | null;
  type: RefloatConfigurationFieldType;
  defaultValue: RefloatConfigurationValue;
  minimum: number | null;
  maximum: number | null;
  step: number | null;
  precision: number | null;
  /** Multiplier from firmware units to editor units. */
  editorScale: number;
  /** Canonical numeric encoding limits, independent of the XML editor bounds. */
  wireMinimum: number | null;
  wireMaximum: number | null;
  /** Whole percentages of the maximum absolute bound. */
  editAsPercentage: boolean;
  suffix: string;
  choices: string[];
  description: string;
  /** True only for fields included in portable Refloat Tunes. */
  tunable: boolean;
}

export interface RefloatConfigurationSchemaPage {
  identity: RefloatConfigurationIdentity;
  group: string;
  subgroup: string;
  fields: RefloatConfigurationField[];
  nextCursor: string | null;
}

export interface RefloatConfigurationValues {
  identity: RefloatConfigurationIdentity;
  revision: number;
  source: 'current' | 'default';
  values: Record<string, RefloatConfigurationValue>;
}

/** Durable editor work; saving this never changes device configuration. */
export interface RefloatEditorDraft {
  version: 1;
  identity: RefloatConfigurationIdentity;
  source: 'current' | 'default';
  values: Record<string, RefloatConfigurationValue>;
  inputs: Record<string, string>;
  position: {
    sectionKey: string;
    search: string;
    controlsExpanded: boolean;
    scrollTop: number;
  };
}
export const MAX_REFLOAT_EDITOR_DRAFT_BYTES = 60_000;

/** Audited 1.3.1-beta2/beta3/stable Tunes use canonical version 1.3.1; board identities stay exact. */
export interface RefloatTuneSummary {
  tuneId: string;
  revision: number;
  name: string;
  description: string | null;
  identity: RefloatConfigurationIdentity;
  createdAt: string;
  updatedAt: string;
}

export interface RefloatTune extends RefloatTuneSummary {
  /** Portable Refloat Tune subset only; board-specific configuration is excluded. */
  values: Record<string, RefloatConfigurationValue>;
}

export interface RefloatTuneListPage {
  items: RefloatTuneSummary[];
  nextCursor: string | null;
}

/** Shared temporal charge approximation. No view-local estimation or filtering.
 * level is a nullable fraction [0,1]; seriesCount resolves pack volts to cell volts.
 * sampleSequence/profileRevision identify the accepted sample and saved configuration.
 * catalogVersion pins community curves; modes describe compensation, not accuracy.
 */
export interface BatteryEstimate {
  level: number | null;
  /** Null when unset or not applicable (guest/BMS). */
  profileId: string | null;
  /** Saved series count, null when absent or conflicting with the controller. */
  seriesCount: number | null;
  /** Null before the first accepted sample. */
  sampleSequence: number | null;
  /** Null without a saved profile. */
  profileRevision: number | null;
  catalogVersion: string;
  /** Describes this update, independently of voltage compensation mode. */
  method: 'voltage_smoothed' | 'charge_integrated' | null;
  provisional: boolean;
  mode: 'load_compensated' | 'load_clamped' | 'voltage_only' | 'unavailable';
  unavailableReason: 'not_configured' | 'series_mismatch' | 'missing_voltage' | 'not_applicable' | null;
}
/** Service-owned named pack variant. Selecting its ID atomically applies defaults. */
export interface BatteryPreset {
  id: string;
  label: string;
  manufacturer: string;
  cellLabel: string;
  seriesCount: number;
  parallelCount: number;
  batteryCellProfileId: string;
  nominalCapacityAh: number | null;
}
export interface BatteryCellProfile {
  id: string;
  label: string;
}
export type BatteryWarning = 'low' | 'overVoltage';

export interface ActiveConnection extends Device {
  deviceKind: 'board' | 'bms' | null;
  firmware: FirmwareInfo | null;
  transportFirmware: TransportFirmwareInfo | null;
  trackingMode: 'saved' | 'guest';
  savedDeviceId: string | null;
  displayName: string;
  controllerConnection: ControllerConnection | null;
  controllerCandidates: ControllerCandidate[];
  connectionIssue: ConnectionIssue | null;
  /** Connection-scoped evidence, not a confirmed diagnosis. Clears on reconnect. */
  connectionWarning: { code: 'possible_can_id_conflict'; message: string } | null;
  bms: BmsState;
  /** Null only before Refloat discovery begins. Never persisted. */
  refloatControls: RefloatControls | null;
  /** Small authoritative status only; schema, values, and Tunes remain request-scoped. */
  refloatConfiguration: RefloatConfigurationSummary | null;
  /** Live-only VESC controller actions. Never persisted. */
  controllerActions: ControllerActions;
  activeSession: SessionSummary | null;
  latestSample: LiveSample | null;
  batteryEstimate: BatteryEstimate;
  /** Fresh visual voltage warning; independent of riding, regen and speech policy. */
  batteryWarning: BatteryWarning | null;
  /** Saved board layout, or the separate guest layout. */
  liveWidgetSlots: LiveWidgetSlots;
  latestLocation: LiveLocation | null;
  currentLimits: ControllerCurrentLimits | null;
}

export interface ControllerCurrentLimits {
  motorCurrentMaxA: number;
  motorCurrentMinA: number;
  batteryCurrentMaxA: number;
  batteryCurrentMinA: number;
  batterySeriesCells: number | null;
}

export interface SavedDevice {
  /** Current per-board appearance, independent of historical session snapshots. Absent uses defaults. */
  appearance?: BoardAppearance;
  savedDeviceId: string;
  deviceHistoryId: string;
  revision: number;
  displayName: string;
  customDisplayName?: string | null;
  advertisedName?: string | null;
  bluetoothIdentifier: string | null;
  lastSeenAt?: string | null;
  lastConnectedAt?: string | null;
  profileComplete: boolean;
  summary: BoardHistorySummary;
}

export type LiveViewMode = 'normal' | 'detailed' | 'custom';

export interface BoardProfileValues extends Record<string, unknown> {
  /** Last explicitly selected view for this saved board. Absent/null defaults to Live. */
  lastLiveView?: LiveViewMode | null;
  /** Optional additive dashboard. Null/absence uses defaults; an empty widget list is intentional. */
  customDashboard?: CustomDashboard | null;
  /** Optional additive profile setting; null restores the default appearance. */
  appearance?: BoardAppearance | null;
  seriesCount?: number;
  parallelCount?: number;
  batteryCellProfileId?: string | null;
  /** Full pack Ah, 0.1–200; null means voltage-only estimation. */
  batteryCapacityAh?: number | null;
  /** Non-null in a patch selects all defaults; cannot accompany battery overrides.
   * Complete imported profiles preserve overrides and must match S/P/curve. */
  batteryPresetId?: string | null;
  /** Display-empty volts per cell, [2.7,4.2); absent/null means 3.0 V. */
  batteryMinimumCellVoltageV?: number | null;
  motor?: string;
  preferredCanId?: number | null;
  preferredBmsCanId?: number | null;
  /** Absent means the default layout. Always exactly five entries when set. */
  liveWidgetSlots?: LiveWidgetSlots;
}

export interface BoardProfile {
  savedDeviceId: string;
  revision: number;
  values: BoardProfileValues;
  missingFields: string[];
}

export const boardAppearanceColours = [
  ['Black', '#17191d'],
  ['Graphite', '#59616b'],
  ['Silver', '#a9afb8'],
  ['Chalk', '#e4e7eb'],
  ['White', '#ffffff'],
  ['Red', '#ed5555'],
  ['Orange', '#db8a57'],
  ['Yellow', '#f4d84d'],
  ['Gold', '#d4b45f'],
  ['Lime', '#b4d94e'],
  ['Green', '#4dbb75'],
  ['Forest', '#307653'],
  ['Teal', '#38a59c'],
  ['Seafoam', '#a2d4d8'],
  ['Cyan', '#4ccfe0'],
  ['Blue', '#82aee0'],
  ['Royal blue', '#4778e8'],
  ['Indigo', '#7866d8'],
  ['Purple', '#b49bd4'],
  ['Pink', '#e780b1'],
  ['Brown', '#9b6d4b'],
  ['Sand', '#d9c1a5'],
] as const;
export type BoardColour = (typeof boardAppearanceColours)[number][1];
/** Stable, one-based style IDs. Hooks: 1 none, 2 fender-mounted, 3 inward-facing tips.
 * Fender: 1 none, 2 split, 3 full. Fender-mounted hooks require a fender. */
export interface BoardAppearance {
  rail: 1 | 2 | 3 | 4 | 5 | 6;
  tyre: 1 | 2;
  fender: 1 | 2 | 3;
  hooks: 1 | 2 | 3;
  leftTop: BoardColour;
  leftBottom: BoardColour;
  rightTop: BoardColour;
  rightBottom: BoardColour;
  rubber: BoardColour;
  rim: BoardColour;
  fenders: BoardColour;
  hookColour: BoardColour;
}
export const defaultBoardAppearance: Readonly<BoardAppearance> = {
  rail: 1,
  tyre: 1,
  fender: 1,
  hooks: 1,
  leftTop: '#a9afb8',
  leftBottom: '#a9afb8',
  rightTop: '#a9afb8',
  rightBottom: '#a9afb8',
  rubber: '#59616b',
  rim: '#17191d',
  fenders: '#a9afb8',
  hookColour: '#ffffff',
};

export type SessionState = 'active' | 'completed' | 'interrupted' | 'partial' | 'failed';

export interface SessionSummary {
  sessionId: string;
  deviceHistoryId: string;
  displayName: string;
  startedAt: string;
  endedAt?: string | null;
  state: SessionState;
  integrity: 'complete' | 'gaps' | 'recovered' | 'corrupt';
  sampleCount: number;
  eventCount: number;
  ridingElapsedMs: number;
  totalElapsedMs: number;
  distanceM?: number | null;
  maxSpeedMps?: number | null;
  maxDutyCycle?: number | null;
}

export type SessionFieldSource = 'stable' | 'extension';

/** Numeric extension fields motorLoad and batteryLoad are recorded 0..1 load fractions,
 * using the controller limits at capture, filtered/directional/raw motor preference,
 * raw-current sign for draw/regen limits, and saturation at 1. Missing inputs stay absent. */
/** estimatedBatteryLevel records the service's temporal estimate at capture as a 0..1
 * fraction, absent when unavailable. Stable batteryLevel retains the controller reading. */
export interface SessionFieldDescriptor {
  name: string;
  source: SessionFieldSource;
}

export interface SessionPublishedSnapshot {
  historyRevision: number;
  committedSampleSequence: number;
  committedEventSequence: number;
  committedElapsedMs: number;
  committedLocationSequence: number;
  committedLocationElapsedMs: number;
}

export type LocationAuthorizationStatus =
  | 'disabled'
  | 'notDetermined'
  | 'foregroundOnly'
  | 'authorized'
  | 'denied'
  | 'restricted'
  | 'unavailable';

export type LocationPermissionAction = 'requestPermission' | 'openSettings' | null;

/** Complete native inventory, at most three unique rows. Labels are frontend-owned. */
export type PermissionId = 'bluetooth' | 'location' | 'backgroundLocation' | 'notifications' | 'liveUpdates';
export type PermissionAction = 'requestPermission' | 'openSettings';
export type PermissionGrant = 'unknown' | 'notDetermined' | 'granted' | 'denied' | 'restricted' | 'notRequired';
export type PermissionGuidance =
  | 'none'
  | 'checking'
  | 'restricted'
  | 'servicesDisabled'
  | 'unsupportedHardware'
  | 'foregroundRequired'
  | 'rationale'
  | 'appSettings'
  | 'iosSettings'
  | 'macBluetooth'
  | 'macLocation'
  | 'backgroundSettings'
  | 'alwaysAccess'
  | 'fineLocationForScan'
  | 'notificationSettings'
  | 'liveUpdateSettings'
  | 'notificationsRequired';
export interface PermissionRow {
  permission: PermissionId;
  status: 'notDetermined' | 'granted' | 'limited' | 'denied' | 'restricted' | 'unavailable';
  action: PermissionAction | null;
  guidance: PermissionGuidance;
  pending: boolean;
  optional: boolean;
  servicesEnabled: boolean | null;
  scan: PermissionGrant | null;
  connect: PermissionGrant | null;
  accuracy: 'unknown' | 'approximate' | 'precise';
  scope: 'unknown' | 'whileInUse' | 'always';
  /** OS-localized background setting label, at most 120 characters. */
  optionLabel: string | null;
}

export interface LocationState {
  status: LocationAuthorizationStatus;
  permissionAction: LocationPermissionAction;
  backgroundCapture: 'available' | 'foregroundOnly' | 'unavailable';
  reason: string | null;
}

export interface SessionLocationMetadata {
  available: boolean;
  count: number;
  lastSequence: number;
  lastElapsedMs: number;
  status: 'available' | 'disabled' | 'unavailable' | 'gap';
}

export interface SessionLocationPoint {
  locationSequence: number;
  elapsedMs: number;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  /** Height in metres above the WGS84 ellipsoid. */
  altitudeM: number | null;
  observedAt: string;
}

export interface SessionLocationGap {
  startElapsedMs: number;
  endElapsedMs: number;
  reason: 'providerUnavailable' | 'permissionUnavailable' | 'noFix' | 'unknown';
}

export interface SessionPruneMetadata {
  targetResolutionSeconds: number | null;
  recordedSampleCount: number;
  storedSampleCount: number;
  policy: string | null;
}

export const MAX_SESSION_MARKERS = 1_000;
export const MAX_SESSION_MARKER_ROWS = 256;
export interface SessionRideMarker {
  sequence: number;
  elapsedMs: number;
  observedAtMs: number;
  operationId: string;
  location: {
    locationSequence: number;
    elapsedMs: number;
    observedAtMs: number;
    latitude: number;
    longitude: number;
    accuracyM: number | null;
  } | null;
}

export interface ContextFirmware {
  major: number;
  minor: number;
  testVersion: number;
  hardwareName: string | null;
  firmwareName: string | null;
}
export interface ConnectionContext {
  version: 1;
  refloatVersion: string;
  controller: ContextFirmware;
  transport: ContextFirmware;
  connection: ControllerConnection;
}
export interface ConnectionContextEvent {
  sequence: number;
  elapsedMs: number;
  observedAtMs: number;
  context: ConnectionContext;
}

export const MAX_SESSION_RECORDING_BREAKS = 1_000;
export type SessionInterruptionReason = 'pause' | 'connectionLoss' | 'unknown';
export type SessionRecordingBreak = [startElapsedMs: number, endElapsedMs: number, reason: SessionInterruptionReason];

export interface SessionMetadata {
  /** Exact last-before/first-after timestamps from explicit recording boundaries only. */
  recordingBreaks: SessionRecordingBreak[];
  connectionContextCount: number;
  markerCount: number;
  summary: SessionSummary;
  /** Fields with at least one recorded value at or before snapshot; zero counts as a value.
   * Availability covers the session, independently of the selected time or map range. */
  fields: SessionFieldDescriptor[];
  eventCount: number;
  recordedSampleCount: number;
  storedSampleCount: number;
  prune: SessionPruneMetadata;
  location: SessionLocationMetadata;
  snapshot: SessionPublishedSnapshot;
}

export interface SessionListPage {
  items: SessionSummary[];
  catalogRevision: number;
  nextCursor: string | null;
}

export type SessionOperationKind = 'delete' | 'prunePreview' | 'prune';
export type SessionOperationStatus =
  | 'queued'
  | 'running'
  | 'reclaiming'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface SessionOperationState {
  operationId: string;
  kind: SessionOperationKind;
  status: SessionOperationStatus;
  sessionId: string | null;
  scope: 'one' | 'all';
  targetResolutionSeconds: number | null;
  completedSessions: number;
  eligibleSessions: number | null;
  error: BackendError | null;
}

export interface SessionPrunePreview {
  operation: SessionOperationState;
  recordedSampleCount: number;
  estimatedStoredSampleCount: number;
  estimatedReclaimableBytes: number | null;
  skipped: boolean;
  skipReason: string | null;
}

export type AccentPreference = 'purple' | 'blue' | 'teal' | 'amber' | 'rose';
export type ThemePreference = 'system' | 'light' | 'dark';
export type UnitPreference = 'metric' | 'imperial';

export const liveWidgetFields = [
  'empty',
  'headlights',
  'leds',
  'themeToggle',
  'fieldWeakeningCurrentA',
  'motorCurrentA',
  'batteryCurrentA',
  'powerW',
  'packVoltageV',
  'dutyCycle',
  'driveLoad',
  'estimatedBatteryLevel',
  'batteryLevel',
  'speedKph',
  'maxSpeedKph',
  'distanceM',
  'odometerM',
  'altitudeM',
  'elapsedMs',
  'erpm',
  'controllerTempC',
  'motorTempC',
  'highestTempC',
  'bmsStateOfCharge',
  'bmsStateOfHealth',
  'bmsTotalVoltageV',
  'bmsInputCurrentA',
  'bmsChargeVoltageV',
  'bmsMinCellVoltageV',
  'bmsMaxCellVoltageV',
  'bmsCellVoltageSpreadV',
  'bmsHighestCellTempC',
  'bmsIcTempC',
  'bmsHumidityPercent',
  'directionalMotorCurrentA',
  'filteredMotorCurrentA',
  'requestedBalanceCurrentA',
  'boosterCurrentA',
  'pitchDeg',
  'balancePitchDeg',
  'rollDeg',
  'footpadAdc1V',
  'footpadAdc2V',
  'remoteInput',
  'setpointDeg',
  'atrSetpointDeg',
  'brakeTiltSetpointDeg',
  'torqueTiltSetpointDeg',
  'turnTiltSetpointDeg',
  'remoteSetpointDeg',
  'atrAccelerationDifferenceErpmPerSecond',
  'atrSpeedBoost',
  'ampHoursDrawnAh',
  'ampHoursChargedAh',
  'ampHoursNetAh',
  'wattHoursDrawnWh',
  'wattHoursChargedWh',
  'wattHoursNetWh',
  'chargingCurrentA',
  'chargingVoltageV',
] as const;
export type LiveWidgetField = (typeof liveWidgetFields)[number];
export type DashboardReading = Exclude<LiveWidgetField, 'empty' | 'headlights' | 'leds' | 'themeToggle'>;
export interface DashboardDimensions {
  /** Integer cell spans, independently bounded to 1–4. */
  columns: number;
  rows: number;
}
/** Existing named footprints remain supported; new selections use explicit dimensions. */
export type DashboardSize = 'compact' | 'medium' | 'large' | DashboardDimensions;
export type DashboardPresentation = 'number' | 'bar' | 'gauge' | 'trend';
/** Ranges use metric display units: km/h, km, °C, percent, ms, or the catalogue unit. */
export interface DashboardRange {
  min: number;
  max: number;
}
export type DashboardWidget = { id: string; size: DashboardSize } & (
  | { kind: 'reading'; field: DashboardReading; presentation: DashboardPresentation; range?: DashboardRange }
  | { kind: 'visual'; visual: 'speedGauge' | 'battery' | 'temperatures' | 'footpads' }
  | { kind: 'control'; control: 'headlights' | 'leds' }
  | { kind: 'action'; action: 'rideMarker' | 'themeToggle' }
);
/** Closed version-1 shape: <=24 widgets, unique 1–64 ASCII identifier IDs, <=8,192 UTF-8 bytes.
 * The complete Board Profile remains bounded to 16,384 bytes. */
export interface CustomDashboard {
  version: 1;
  widgets: DashboardWidget[];
}
export const MAX_DASHBOARD_WIDGETS = 24;
export const MAX_DASHBOARD_BYTES = 8192;
export type LiveWidgetSlots = [LiveWidgetField, LiveWidgetField, LiveWidgetField, LiveWidgetField, LiveWidgetField];
export const defaultLiveWidgetSlots: LiveWidgetSlots = ['empty', 'powerW', 'elapsedMs', 'odometerM', 'distanceM'];

export interface SessionDisplayOptions {
  bothFootpadsOff: boolean;
  oneFootpadOff: boolean;
}

export interface Settings {
  /** Installation-local preferred saved board; null disables automatic connection. */
  autoConnectSavedDeviceId: string | null;
  /** Explicit acceptance of the first-launch riding safety disclaimer. */
  safetyDisclaimerAccepted: boolean;
  announcements: AnnouncementSettings;
  sessionDisplayOptions: SessionDisplayOptions;
  revision: number;
  idleProbeIntervalMs: number;
  idlePersistIntervalMs: number;
  ridingPersistIntervalMs: number;
  postRideTailMs: number;
  reconnectDurationMs: number;
  rideResumeWindowMinutes: number;
  minimumSessionDistance: number;
  themePreference: ThemePreference;
  accentPreference: AccentPreference;
  unitPreference: UnitPreference;
  /** Layout used only for guest connections; saved boards use BoardProfileValues. */
  liveWidgetSlots: LiveWidgetSlots;
  historyGapThresholdSeconds: number | null;
  locationRecordingEnabled: boolean;
  includeGpsLocationWhenExporting: boolean;
}

export interface AppImportSummary {
  boardsAdded: number;
  boardsSkipped: number;
  sessionsAdded: number;
  sessionsSkipped: number;
  tunesAdded: number;
  tunesSkipped: number;
  settingsImported: boolean;
}

export interface ExportResult {
  fileName: string;
  delivery: 'presented' | 'staged';
}

export interface PausedRide {
  sessionId: string;
  savedDeviceId: string;
  displayName: string;
  resumeUntil: string;
}

export type SpeedCalibrationMeasurementStatus =
  | 'inactive'
  | 'waitingGps'
  | 'waitingBoard'
  | 'lowSpeed'
  | 'gpsUncertain'
  | 'speedChanging'
  | 'speedMismatch'
  | 'collecting'
  | 'needsMoreMeasurements'
  | 'inconsistentMeasurements'
  | 'ready';

export interface SpeedCalibrationState {
  measurementStatus: SpeedCalibrationMeasurementStatus;
  status: 'idle' | 'collecting' | 'refining' | 'ready' | 'insufficient' | 'applied';
  currentDiameterMm: number | null;
  startingDiameterMm: number | null;
  recommendedDiameterMm: number | null;
  acceptedSamples: number;
  /** Approximate evidence gathered; holds during pauses and reaches 100 only on approval. */
  progressPercent: number;
  minimumSpeedKph: number;
  applyAvailable: boolean;
  applyBlockReason:
    | 'applying'
    | 'applied'
    | 'connectionChanged'
    | 'unsupportedSetup'
    | 'boardNotReady'
    | 'busy'
    | 'stopRiding'
    | 'notReady'
    | null;
}

export const emptySpeedCalibration: SpeedCalibrationState = {
  measurementStatus: 'inactive',
  status: 'idle',
  currentDiameterMm: null,
  startingDiameterMm: null,
  recommendedDiameterMm: null,
  acceptedSamples: 0,
  progressPercent: 0,
  minimumSpeedKph: 7.2,
  applyAvailable: false,
  applyBlockReason: 'notReady',
};

export interface AppState {
  speedCalibration: SpeedCalibrationState;
  pausedRide: PausedRide | null;
  announcementAudio: AnnouncementAudio;
  /** Seven shared-service choices; numeric curves never cross the contract. */
  batteryCellProfiles: BatteryCellProfile[];
  batteryPresets: BatteryPreset[];
  batteryPresetCatalogVersion: string;
  revision: number;
  permissions: PermissionRow[];
  bluetooth: BluetoothState;
  discoveredDevices: DiscoveredDevice[];
  savedDevices: SavedDevice[];
  activeConnection: ActiveConnection | null;
  sessionCatalogRevision: number;
  settings: Settings;
  location: LocationState;
  sessionOperation?: SessionOperationState | null;
}

export type BackendErrorCode =
  | 'invalid_request'
  | 'invalid_state'
  | 'permission_required'
  | 'not_found'
  | 'conflict'
  | 'unavailable'
  | 'internal';

export interface BackendError {
  code: BackendErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type EmptyParams = Record<string, never>;
export interface Accepted {
  accepted: true;
}

/** Process-memory presentation only; never product or device authority. */
export type UiRoute =
  | { kind: 'home' | 'sessions' | 'settings' | 'live' | 'bms' }
  | { kind: 'boardHistory'; savedDeviceId: string }
  | {
      kind: 'session';
      sessionId: string;
      savedDeviceId: string | null;
      returnTo: 'live' | 'sessions' | 'boardHistory';
    };
export type UiSurface =
  | {
      kind:
        | 'liveActions'
        | 'liveCharts'
        | 'faultHistory'
        | 'bmsDetails'
        | 'refloatConfiguration'
        | 'refloatTunes'
        | 'boardActions';
    }
  | { kind: 'boardConfiguration'; savedDeviceId: string; batteryOnly: boolean };
export interface UiCheckpoint {
  version: 1;
  route: UiRoute;
  live: { deviceId: string; mode: 'normal' | 'detailed' | 'custom'; savedDeviceId?: string } | null;
  surface: UiSurface | null;
}
export const MAX_UI_CHECKPOINT_BYTES = 4096;
export const MAX_UI_TARGET_BYTES = 512;

export type DiagnosticReason =
  | 'calibration_complete'
  | 'calibration_failure'
  | 'backend_request_failure'
  | 'manual'
  | 'configuration_failure'
  | 'protocol_failure'
  | 'connection_failure'
  | 'storage_failure'
  | 'ui_failure'
  | 'request_delay'
  | 'telemetry_gap'
  | 'slow_storage'
  | 'native_queue'
  | 'reconnect'
  | 'ride_marker';
export interface DiagnosticIncident {
  incidentId: string;
  reason: DiagnosticReason;
  complete: boolean;
  clipped: boolean;
  ageMs: number;
}
export interface DiagnosticList {
  persistence: 'available' | 'memoryOnly';
  droppedRecords: number;
  incidents: DiagnosticIncident[];
}
export interface DiagnosticPreview {
  reportId: string;
  summary: string;
  complete: boolean;
  clipped: boolean;
  droppedRecords: number;
  expiresInMs: number;
}
export interface DiagnosticUiError {
  category: 'exception' | 'rejection' | 'protocol' | 'request';
  feature: 'app' | 'connection' | 'configuration' | 'sessions' | 'storage';
  line: number | null;
  column: number | null;
}

export interface SessionExportProgress {
  operationId: string;
  phase: 'exporting' | 'cancelling' | 'ready' | 'cancelled' | 'failed';
  completedSessions: number;
  totalSessions: number;
  error: string | null;
}

export interface BackendMethods {
  'diagnostics.list': { params: EmptyParams; result: DiagnosticList };
  'diagnostics.capture': { params: EmptyParams; result: { incidentId: string; capturing: boolean } };
  'diagnostics.prepare': { params: { incidentId: string | null; replaceReportId?: string }; result: DiagnosticPreview };
  'diagnostics.export': { params: { reportId: string }; result: ExportResult };
  'diagnostics.clear': { params: EmptyParams; result: Accepted };
  'diagnostics.uiError': { params: DiagnosticUiError; result: Accepted };
  'state.get': { params: EmptyParams; result: AppState };
  'uiState.get': { params: EmptyParams; result: UiCheckpoint | null };
  'uiState.set': { params: { checkpoint: UiCheckpoint | null }; result: Accepted };
  /** Bounded, best-effort UI timing summary; never changes public state. */
  'diagnostics.report': {
    params: { snapshots: number; max_sample_age_ms: number; max_delivery_gap_ms: number; max_handler_ms: number };
    result: { accepted: true };
  };
  'permissions.recover': { params: { permission: PermissionId; action: PermissionAction }; result: PermissionRow[] };
  'bluetooth.requestPermission': { params: EmptyParams; result: BluetoothState };
  'bluetooth.scan': { params: { timeoutMs?: number }; result: Accepted };
  'speedCalibration.start': { params: { diameterMm: number }; result: Accepted };
  'speedCalibration.finish': { params: EmptyParams; result: Accepted };
  'speedCalibration.cancel': { params: EmptyParams; result: Accepted };
  'speedCalibration.apply': { params: EmptyParams; result: Accepted };
  'location.requestPermission': { params: EmptyParams; result: LocationState };
  'location.openSettings': { params: EmptyParams; result: LocationState };
  'device.connect': {
    params: { deviceId: string; trackingMode: 'saved' | 'guest' };
    result: Accepted;
  };
  'device.selectController': {
    params: { deviceId: string; canId: number };
    result: Accepted;
  };
  'session.end': { params: { sessionId: string }; result: Accepted };
  /** Restart the matching unexpired paused ride’s resume window without shortening it. */
  'session.extendPause': { params: { sessionId: string }; result: Accepted };
  'device.disconnect': { params: EmptyParams; result: Accepted };
  'controller.shutdown': { params: EmptyParams; result: Accepted };
  'refloat.control.set': {
    params: { control: RefloatControl; enabled: boolean };
    result: RefloatControls;
  };
  'refloat.fatalError.clear': { params: EmptyParams; result: RefloatControls };
  'refloat.configuration.draft.get': {
    params: { deviceId: string };
    result: RefloatEditorDraft | null;
  };
  'refloat.configuration.draft.set': {
    params: { deviceId: string; baseRevision: number; draft: RefloatEditorDraft };
    result: Accepted;
  };
  'refloat.configuration.open': { params: EmptyParams; result: RefloatConfigurationSummary };
  'refloat.configuration.schema': {
    params: { cursor?: string | null };
    result: RefloatConfigurationSchemaPage;
  };
  'refloat.configuration.read': {
    /** Defaults to a board read. False reuses valid retained values, reading only when absent. */
    params: { source: 'current' | 'default'; refresh?: boolean };
    result: RefloatConfigurationValues;
  };
  'refloat.configuration.write': {
    params: {
      packageVersion: string;
      schemaFingerprint: string;
      wireSignature: number;
      baseRevision: number;
      values: Record<string, RefloatConfigurationValue>;
    };
    result: RefloatConfigurationValues;
  };
  'refloat.tune.list': {
    /** null lists the entire library; cursors are bound to this filter. */
    params: { identity: RefloatConfigurationIdentity | null; limit: number; cursor?: string | null };
    result: RefloatTuneListPage;
  };
  'refloat.tune.get': { params: { tuneId: string }; result: RefloatTune };
  'refloat.tune.create': {
    params: {
      name: string;
      description: string | null;
      identity: RefloatConfigurationIdentity;
      sourceRevision: number;
      values: Record<string, RefloatConfigurationValue>;
    };
    result: RefloatTune;
  };
  'refloat.tune.update': {
    params: {
      tuneId: string;
      expectedRevision: number;
      name: string;
      description: string | null;
      values: Record<string, RefloatConfigurationValue>;
    };
    result: RefloatTune;
  };
  'refloat.tune.delete': { params: { tuneId: string; expectedRevision: number }; result: Accepted };
  'refloat.tune.apply': {
    params: { tuneId: string; expectedRevision: number; baseRevision: number };
    result: RefloatConfigurationValues;
  };
  'savedDevice.update': {
    params: {
      savedDeviceId: string;
      expectedRevision: number;
      customDisplayName: string | null;
    };
    result: SavedDevice;
  };
  'savedDevice.delete': { params: { savedDeviceId: string }; result: Accepted };
  'announcements.openVoiceSettings': { params: Record<string, never>; result: { accepted: true } };
  /** Manual preview: requires a free speech slot, independent of the automatic repeat interval. */
  'announcements.test': {
    params: { kind: 'speed' | 'load' | 'combined' };
    result: { outcome: 'finished' | 'interrupted' | 'unavailable' };
  };
  'settings.update': {
    params: { expectedRevision: number; patch: Omit<Partial<Settings>, 'revision'> };
    result: Settings;
  };
  'boardProfile.get': { params: { savedDeviceId: string }; result: BoardProfile };
  'boardProfile.update': {
    params: { savedDeviceId: string; expectedRevision: number; patch: Record<string, unknown> };
    result: BoardProfile;
  };
  'session.list': {
    params: { savedDeviceId: string; limit: number; cursor?: string | null };
    result: SessionListPage;
  };
  'session.marker.add': {
    params: { sessionId: string; operationId: string };
    result: { marker: SessionRideMarker; snapshot: SessionPublishedSnapshot };
  };
  'session.get': { params: { sessionId: string }; result: SessionMetadata };
  'app.export': { params: { operationId?: string }; result: ExportResult };
  'app.clear': { params: Record<string, never>; result: Accepted };
  'session.export': {
    // Single CSV exports contain one CSV; board exports bundle individual artifacts in one ZIP.
    params: (
      | { sessionId: string; savedDeviceId?: never; operationId?: never }
      | { savedDeviceId: string; sessionId?: never; operationId?: string }
    ) & {
      format: 'float-view-archive' | 'csv';
    };
    result: ExportResult;
  };
  'session.export.status': { params: { operationId: string }; result: SessionExportProgress };
  'session.export.cancel': { params: { operationId: string }; result: SessionExportProgress };
  'session.delete': { params: { sessionId: string }; result: Accepted };
  'session.delete.cancel': { params: { operationId: string }; result: SessionOperationState };
  'session.prune.preview': {
    params: { scope: 'one' | 'all'; sessionId?: string; targetResolutionSeconds: number };
    result: SessionPrunePreview;
  };
  'session.prune.start': {
    params: { scope: 'one' | 'all'; sessionId?: string; targetResolutionSeconds: number };
    result: SessionOperationState;
  };
  'session.prune.cancel': { params: { operationId: string }; result: SessionOperationState };
}

export type BackendMethod = keyof BackendMethods;
export type BackendParams<M extends BackendMethod> = BackendMethods[M]['params'];
export type BackendResult<M extends BackendMethod> = BackendMethods[M]['result'];

export type Request<M extends BackendMethod = BackendMethod> = {
  id: number;
  method: M;
  params: BackendParams<M>;
};

export type Success = { id: number; result: unknown };
export type Failure = { id: number; error: BackendError };
export type Response = Success | Failure;
export type StateChanged = { event: 'state.changed'; data: AppState };
export type BackendEvent = StateChanged;
