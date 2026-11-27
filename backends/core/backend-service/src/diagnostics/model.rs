//! Closed diagnostic vocabulary: never serialize peer text or Error objects.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const MAX_EVENT: usize = 1024;
pub const MAX_EVENTS: usize = 256;
pub const MAX_INCIDENTS: usize = 10;
pub const MAX_INCIDENT_BYTES: usize = 1_048_576;
pub const MAX_RETAINED_INCIDENT_BYTES: usize = 3 * MAX_INCIDENT_BYTES;
pub const CONTENT_CHUNK_BYTES: usize = 192;
pub const MAX_CONTENT_BYTES: usize = 32_768;
pub const RETENTION_MS: i64 = 7 * 86_400_000;
pub const REPORT_TTL: u64 = 600_000;
pub const MAX_REPORT_BYTES: u64 = 5 * 1_048_576;

// These values are durable versioned data. Retiring an active API or UI state
// does not remove the known values from supported saved diagnostics.
macro_rules! vocabulary {
    ($name:ident { $($variant:ident => $wire:literal),* $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
        pub enum $name { $(#[serde(rename=$wire)] $variant),* }
        impl $name {
            pub fn parse(s: &str) -> Option<Self> { match s { $($wire => Some(Self::$variant),)* _ => None } }
        }
    }
}
vocabulary!(Kind {
    Calibration => "calibration", CalibrationOutcome => "calibration_outcome",
    Content => "diagnostic_content",
    ConfigurationOperation => "configuration_operation", RuntimeFailure => "runtime_failure", MutationFailure => "mutation_failure", ApiRequestFailure => "backend_request_failure", Metadata => "metadata", Link => "link", Foreground => "foreground", Native => "native",
    Disconnect => "disconnect", Activated => "activated", ConfigurationBootstrap => "configuration_bootstrap",
    ConfigurationFailure => "configuration_failure", ProtocolDiagnostic => "protocol_diagnostic",
    Failure => "failure", Request => "request", BleWriteStart => "ble_write_start", BleWrite => "ble_write",
    Recording => "recording", Sample => "sample", Summary => "summary", UiDelivery => "ui_delivery",
    TelemetryGap => "telemetry_gap", Discontinuity => "clock_or_sequence_discontinuity",
    RideMarker => "ride_marker", UiError => "ui_error", Bluetooth => "bluetooth", Discovery => "discovery"
});
vocabulary!(Reason {
    CalibrationComplete => "calibration_complete", Calibration => "calibration_failure", BackendRequest => "backend_request_failure", Manual => "manual", Configuration => "configuration_failure", Protocol => "protocol_failure",
    Connection => "connection_failure", Storage => "storage_failure", Ui => "ui_failure",
    Request => "request_delay", Telemetry => "telemetry_gap", SlowStorage => "slow_storage",
    Native => "native_queue", Reconnect => "reconnect", Marker => "ride_marker"
});
vocabulary!(Key {
    GpsRejected => "gps_rejected", BoardRejected => "board_rejected", LowSpeed => "low_speed", SpeedChanging => "speed_changing", SpeedMismatch => "speed_mismatch",
    GpsUpdates => "gps_updates", BoardSamples => "board_samples",
    AlgorithmVersion => "algorithm_version", GpsUncertain => "gps_uncertain",
    GpsAccuracyMissing => "gps_accuracy_missing", GpsAccuracyAbsolute => "gps_accuracy_absolute", GpsAccuracyRelative => "gps_accuracy_relative",
    Quality => "quality", EffectiveSamples => "effective_samples", UncertaintyBps => "uncertainty_bps",
    ContentId => "content_id", Offset => "offset", TotalBytes => "total_bytes", Truncated => "truncated",
    SchemaFingerprint => "schema_fingerprint", RequestedSchemaFingerprint => "requested_schema_fingerprint", WireSignature => "wire_signature", RequestedWireSignature => "requested_wire_signature", PacketOmitted => "packet_omitted", RoutingRemoved => "routing_removed",
    PackageSuffix => "package_suffix",
    Enabled => "enabled", ControlsReady => "controls_ready", ControlsWritable => "controls_writable", PackageEnabled => "package_enabled", FlywheelEnabled => "flywheel_enabled",
    Stage => "stage", ConfigurationOperation => "configuration_operation",
    Availability => "availability", BlockingOperation => "blocking_operation", BlockingKind => "blocking_kind",
    Detail => "detail",
    Layer => "layer",
    WriteBlock => "write_block",
    StandaloneBms => "standalone_bms",
    Writable => "writable",
    CurrentLoaded => "current_loaded",
    IdentityLoaded => "identity_loaded",
    ConfigurationPending => "configuration_pending",
    MutationPending => "mutation_pending",
    CurrentRevision => "current_revision",
    GenerationMatches => "generation_matches",
    BaseRevision => "base_revision",
    RevisionMatches => "revision_matches",
    PackageMatches => "package_matches",
    SchemaMatches => "schema_matches",
    SignatureMatches => "signature_matches",
    Duration => "duration_ms",
    ApplicationGeneration => "application_generation", Method => "method", PackageMajor => "package_major", PackageMinor => "package_minor", PackagePatch => "package_patch",
    Metric => "metric", Percentiles => "count_p50_p95_max", OsMajor => "os_major", OsMinor => "os_minor", OsPatch => "os_patch", RequestKind => "kind",
    Hardware => "hardware", Route => "route", Generation => "generation", Sequence => "sequence", PreviousSequence => "previous_sequence",
    Operation => "operation", Bytes => "bytes", SinceStart => "since_start_ms", Queue => "queue_ms",
    Response => "response_ms", Interval => "interval_ms", Elapsed => "elapsed_ms",
    PreviousElapsed => "previous_elapsed_ms", SampleElapsed => "sample_elapsed_ms",
    Foreground => "foreground", NewSession => "new_session", CachedSchema => "cached_schema",
    ConfigCount => "custom_configuration_count", Major => "firmware_major", Minor => "firmware_minor",
    RidingPoll => "riding_poll_ms", IdlePoll => "idle_poll_ms", RidingPersist => "riding_persist_ms",
    IdlePersist => "idle_persist_ms", Callbacks => "callbacks", QueueDelay => "max_queue_delay_ms",
    QueueDepth => "max_queue_depth", Overflows => "overflows", ExchangeFailures => "exchange_failures",
    Snapshots => "snapshots", SampleAge => "max_sample_age_ms", DeliveryGap => "max_delivery_gap_ms",
    Handler => "max_handler_ms", Accepted => "accepted", Stored => "stored", Window => "window_ms",
    Dropped => "dropped_records", State => "state", Progress => "progress", Outcome => "outcome",
    Platform => "platform", Code => "code", Feature => "feature", Category => "category",
    Line => "line", Column => "column", Radio => "radio", Scan => "scan", Connect => "connect"
});
vocabulary!(ApiMethod {
    Unknown => "unknown",
    ApiStateGet => "state.get",
    ApiUiStateGet => "uiState.get",
    ApiUiStateSet => "uiState.set",
    ApiPermissionsRecover => "permissions.recover",
    ApiBluetoothRequestPermission => "bluetooth.requestPermission",
    ApiBluetoothScan => "bluetooth.scan",
    ApiLocationRequestPermission => "location.requestPermission",
    ApiLocationOpenSettings => "location.openSettings",
    ApiDeviceConnect => "device.connect",
    ApiDeviceSelectController => "device.selectController",
    ApiDeviceDisconnect => "device.disconnect",
    ApiControllerShutdown => "controller.shutdown",
    ApiRefloatControlSet => "refloat.control.set",
    ApiRefloatFatalErrorClear => "refloat.fatalError.clear",
    ApiRefloatConfigurationDraftGet => "refloat.configuration.draft.get",
    ApiRefloatConfigurationDraftSet => "refloat.configuration.draft.set",
    ApiSpeedCalibrationStart => "speedCalibration.start",
    // Includes historical Finish records; the current operation requires an approved result.
    ApiSpeedCalibrationFinish => "speedCalibration.finish",
    ApiSpeedCalibrationCancel => "speedCalibration.cancel",
    ApiSpeedCalibrationApply => "speedCalibration.apply",
    ApiRefloatConfigurationOpen => "refloat.configuration.open",
    ApiRefloatConfigurationSchema => "refloat.configuration.schema",
    ApiRefloatConfigurationRead => "refloat.configuration.read",
    ApiRefloatConfigurationWrite => "refloat.configuration.write",
    ApiRefloatTuneList => "refloat.tune.list",
    ApiRefloatTuneGet => "refloat.tune.get",
    ApiRefloatTuneCreate => "refloat.tune.create",
    ApiRefloatTuneUpdate => "refloat.tune.update",
    ApiRefloatTuneDelete => "refloat.tune.delete",
    ApiRefloatTuneApply => "refloat.tune.apply",
    ApiSavedDeviceUpdate => "savedDevice.update",
    ApiSavedDeviceDelete => "savedDevice.delete",
    ApiHermesSignIn => "hermes.signIn",
    ApiHermesDisconnect => "hermes.disconnect",
    ApiHermesRide => "hermes.ride",
    ApiHermesUpload => "hermes.upload",
    ApiAnnouncementsOpenVoiceSettings => "announcements.openVoiceSettings",
    ApiAnnouncementsTest => "announcements.test",
    ApiSettingsUpdate => "settings.update",
    ApiBoardProfileGet => "boardProfile.get",
    ApiBoardProfileUpdate => "boardProfile.update",
    ApiSessionList => "session.list",
    ApiSessionMarkerAdd => "session.marker.add",
    ApiSessionEnd => "session.end",
    ApiSessionExtendPause => "session.extendPause",
    ApiSessionGet => "session.get",
    ApiAppExport => "app.export",
    ApiAppClear => "app.clear",
    ApiHttpAppImport => "http.appImport",
    ApiHttpAppExport => "http.appExport",
    ApiSessionExport => "session.export",
    ApiSessionExportStatus => "session.export.status",
    ApiSessionExportCancel => "session.export.cancel",
    ApiSessionDelete => "session.delete",
    ApiSessionDeleteCancel => "session.delete.cancel",
    ApiSessionPrunePreview => "session.prune.preview",
    ApiSessionPruneStart => "session.prune.start",
    ApiSessionPruneCancel => "session.prune.cancel",
    ApiHttpSessionData => "http.sessionData",
    ApiHttpSessionImport => "http.sessionImport",
    ApiHttpSessionExport => "http.sessionExport",
});
vocabulary!(Code {
    CalibrationInactive => "inactive", CalibrationWaitingGps => "waitingGps", CalibrationWaitingBoard => "waitingBoard",
    CalibrationLowSpeed => "lowSpeed", CalibrationGpsUncertain => "gpsUncertain", CalibrationSpeedChanging => "speedChanging", CalibrationSpeedMismatch => "speedMismatch",
    CalibrationCollecting => "collecting", CalibrationNeedsMoreMeasurements => "needsMoreMeasurements",
    CalibrationInconsistentMeasurements => "inconsistentMeasurements",
    // Persisted version-2 records from earlier calibration builds use this code.
    HistoricalCalibrationCheckingConsistency => "checkingConsistency",
    CalibrationWaitingSamples => "waitingSamples", CalibrationEffectiveSamples => "effectiveSamples",
    CalibrationUncertainty => "uncertainty", CalibrationOutliers => "outliers",
    CalibrationDrift => "drift", CalibrationDiameter => "diameter",
    IdentityPacket => "identity_packet", LocationPacket => "location_packet", UnclassifiedPacket => "unclassified_packet", MalformedPacket => "malformed_packet",
    Beta2 => "beta2", Beta3 => "beta3", StableRelease => "stable",
    DetailCorruptStorage => "corrupt_storage",
    DetailDatabaseFailure => "database_failure",
    DetailIncompatibleStorage => "incompatible_storage",
    DetailInvalidControllerIdentity => "invalid_controller_identity",
    DetailInvalidDiscoveryInput => "invalid_discovery_input",
    DetailInvalidIdleInterval => "invalid_idle_interval",
    DetailInvalidInput => "invalid_input",
    DetailInvalidPostRideTail => "invalid_post_ride_tail",
    DetailInvalidSelection => "invalid_selection",
    DetailInvalidTelemetry => "invalid_telemetry",
    DetailIoFailure => "io_failure",
    DetailStorageFull => "storage_full",
    DetailTargetExists => "target_exists",

    WriteAck => "write_ack", Readback => "readback",
    DetailEffectLimit => "effect_limit",
    DetailInvalidMonotonicTime => "invalid_monotonic_time",
    DetailInvalidObservationTime => "invalid_observation_time",
    DetailInvalidPayload => "invalid_payload",
    DetailInvalidSessionPath => "invalid_session_path",
    DetailSessionAlreadyAttached => "session_already_attached",
    DetailSessionNotAttached => "session_not_attached",
    DetailAwaitingActivation => "awaiting_activation",
    DetailBusy => "busy",
    DetailClearFatalError => "clear_fatal_error",
    DetailClientDisconnected => "client_disconnected",
    DetailCompressedTooLarge => "compressed_too_large",
    DetailWheelDiameter => "wheel_diameter",
    DetailConfigurationWrite => "configuration_write",
    DetailConfirmationTimedOut => "confirmation_timed_out",
    DetailConnectionReplaced => "connection_replaced",
    DetailControllerShutdown => "controller_shutdown",
    DetailCurrentRequired => "current_required",
    DetailDecompressionFailed => "decompression_failed",
    DetailDuplicateField => "duplicate_field",
    DetailDuplicateOrder => "duplicate_order",
    DetailExpandedLengthMismatch => "expanded_length_mismatch",
    DetailExpandedTooLarge => "expanded_too_large",
    DetailExtraValue => "extra_value",
    DetailFlywheel => "flywheel",
    DetailFlywheelControl => "flywheel_control",
    DetailFraming => "framing",
    DetailHeadlightsControl => "headlights_control",
    DetailIdentifying => "identifying",
    DetailImuTimeoutActive => "imu_timeout_active",
    DetailImuTimeoutUnconfirmed => "imu_timeout_unconfirmed",
    DetailInvalidCanId => "invalid_can_id",
    DetailInvalidLightingResponse => "invalid_lighting_response",
    DetailInvalidMetadata => "invalid_metadata",
    DetailInvalidNumber => "invalid_number",
    DetailInvalidRoute => "invalid_route",
    DetailInvalidTimeout => "invalid_timeout",
    DetailInvalidValue => "invalid_value",
    DetailLedsControl => "leds_control",
    DetailLoading => "loading",
    DetailMalformedXml => "malformed_xml",
    DetailMissingReference => "missing_reference",
    DetailMissingValue => "missing_value",
    DetailModeNotNormal => "mode_not_normal",
    DetailMonotonicOverflow => "monotonic_overflow",
    DetailMutation => "mutation",
    DetailPackageControl => "package_control",
    DetailPackageNotReady => "package_not_ready",
    DetailPayloadTooLarge => "payload_too_large",
    DetailProhibitedByFlywheel => "prohibited_by_flywheel",
    DetailProhibitedXml => "prohibited_xml",
    DetailReadCurrent => "read_current",
    DetailReadDefault => "read_default",
    DetailReadOnly => "read_only",
    DetailReconnecting => "reconnecting",
    DetailRejected => "rejected",
    DetailRemainder => "remainder",
    DetailReplaced => "replaced",
    DetailRequestFailed => "request_failed",
    DetailRequestTimeout => "request_timeout",
    DetailRiding => "riding",
    DetailRuntime => "runtime",
    DetailScheduler => "scheduler",
    DetailSchema => "schema",
    DetailSelectingController => "selecting_controller",
    DetailServiceBusy => "service_busy",
    DetailSignatureMismatch => "signature_mismatch",
    DetailStateUnknown => "state_unknown",
    DetailTruncatedEnvelope => "truncated_envelope",
    DetailTruncatedValues => "truncated_values",
    DetailTuneApply => "tune_apply",
    DetailUnsupportedEncoding => "unsupported_encoding",
    DetailUnsupportedType => "unsupported_type",
    SentOnly => "sent_only", QueueFull => "queue_full", StaleRequest => "stale",
    ApiInvalidRequest => "invalid_request",
    ApiInvalidState => "invalid_state",
    ApiPermissionRequired => "permission_required",
    ApiNotFound => "not_found",
    ApiConflict => "conflict",
    ApiUnavailable => "unavailable",
    ApiInternal => "internal",

    Fast => "fast", Slow => "slow", Fault => "fault", Telemetry => "telemetry", Lighting => "lighting", Bms => "bms", Limits => "limits", DiscoveryControl => "discovery_or_control",
    TimerLateness => "timer_lateness_ms", NotificationBytes => "notification_bytes", AppendUs => "append_us", CatalogUs => "catalog_us", RuntimeUs => "runtime_us", SnapshotUs => "snapshot_us", SampleInterval => "sample_interval_ms", Gap500 => "gaps_over_500_ms", Gap1000 => "gaps_over_1000_ms", RequestQueue => "request_queue_ms", RequestResponse => "request_response_ms", BleWriteMs => "ble_write_ms",
    InvalidState => "InvalidState", Unavailable => "Unavailable", Stale => "StaleResponse", Conflict => "Conflict", Codec => "Codec", StaleEvent => "StaleEvent", UnexpectedResponse => "UnexpectedResponse", Scheduler => "Scheduler", EnqueueRejected => "EnqueueRejected", ConfigurationStale => "ConfigurationStale", Mutation => "Mutation",
    TooManyCan => "too_many_can_devices", TooManyControllers => "too_many_controllers", PreferredUnavailable => "preferred_controller_unavailable", ControllerChanged => "controller_changed",
    Internal => "Internal", Thor300 => "THOR300", Express => "VESC Express T", Vbms => "VBMS", Vbms32 => "VBMS32",
    Unknown => "unknown", Connecting => "connecting", Services => "discoveringServices",
    Notifications => "enablingNotifications", Ready => "ready", Disconnected => "disconnected",
    Failed => "failed", Submitted => "submitted", Completed => "completed", Sent => "sent",
    Timeout => "timeout", Cancelled => "cancelled", Response => "response",
    Android => "android", Ios => "ios", Macos => "macos", Direct => "direct", Can => "can",
    PoweredOn => "poweredOn", PoweredOff => "poweredOff", Unauthorized => "unauthorized",
    Granted => "granted", Denied => "denied", NotDetermined => "notDetermined", NotRequired => "notRequired",
    Restricted => "restricted", Unsupported => "unsupported", Resetting => "resetting",
    Exception => "exception", Rejection => "rejection", Protocol => "protocol", Request => "request",
    App => "app", Connection => "connection", Configuration => "configuration", Sessions => "sessions",
    Storage => "storage", Schema => "UnauditedSchema", Malformed => "MalformedResponse",
    Limit => "StructuralLimit", IdentificationTimeout => "identification_timeout",
    UnsupportedController => "unsupported_controller", UnsupportedRefloat => "unsupported_refloat", RefloatInfoInvalid => "refloat_info_invalid",
    NoController => "no_controller_found", Transport => "TransportSetupFailed"
});
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub enum Datum {
    Count(u64),
    Flag(bool),
    Code(Code),
    Method(ApiMethod),
    Summary([u64; 4]),
    Fingerprint(String),
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentKind {
    PacketTx,
    PacketRx,
    ConfigurationCurrent,
    ConfigurationDefault,
    ConfigurationWrite,
    Telemetry,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Content {
    pub category: ContentKind,
    pub hex: String,
}
impl std::fmt::Debug for Content {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Content")
            .field("category", &self.category)
            .field("bytes", &(self.hex.len() / 2))
            .finish()
    }
}
impl Content {
    pub fn valid(&self) -> bool {
        !self.hex.is_empty()
            && self.hex.len() <= CONTENT_CHUNK_BYTES * 2
            && self.hex.len().is_multiple_of(2)
            && self
                .hex
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    }
}
pub fn fingerprint_valid(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    #[serde(default)]
    pub run: u64,
    pub sequence: u64,
    pub elapsed_ms: u64,
    pub kind: Kind,
    pub facts: BTreeMap<Key, Datum>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<Content>,
}
impl Record {
    pub fn valid(&self) -> bool {
        self.facts.len() <= 32
            && self.content.as_ref().is_none_or(|content| {
                let count = |key| match self.facts.get(&key) {
                    Some(Datum::Count(v)) => Some(*v),
                    _ => None,
                };
                let Some(offset) = count(Key::Offset) else {
                    return false;
                };
                let Some(total) = count(Key::TotalBytes) else {
                    return false;
                };
                let truncated = matches!(self.facts.get(&Key::Truncated), Some(Datum::Flag(true)));
                content.valid()
                    && count(Key::ContentId).is_some_and(|v| v > 0 && v <= 9_007_199_254_740_991)
                    && offset < total
                    && offset < MAX_CONTENT_BYTES as u64
                    && offset.is_multiple_of(CONTENT_CHUNK_BYTES as u64)
                    && content.hex.len() as u64 / 2
                        == (total - offset)
                            .min(CONTENT_CHUNK_BYTES as u64)
                            .min(MAX_CONTENT_BYTES as u64 - offset)
                    && matches!(self.facts.get(&Key::Truncated), Some(Datum::Flag(_)))
                    && truncated == (total > MAX_CONTENT_BYTES as u64)
            })
            && self.facts.iter().all(|(key, value)| match (key, value) {
                (
                    Key::SchemaFingerprint | Key::RequestedSchemaFingerprint,
                    Datum::Fingerprint(value),
                ) => fingerprint_valid(value),
                (Key::SchemaFingerprint | Key::RequestedSchemaFingerprint, _)
                | (_, Datum::Fingerprint(_)) => false,
                _ => true,
            })
            && serde_json::to_vec(self).is_ok_and(|b| b.len() <= MAX_EVENT)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Incident {
    pub id: u64,
    pub created_ms: i64,
    pub reason: Reason,
    pub complete: bool,
    pub clipped: bool,
    pub occurrences: u64,
    pub events: Vec<Record>,
    #[serde(default)]
    pub context: Vec<Record>,
}
impl Incident {
    pub fn valid(&self) -> bool {
        self.id > 0
            && self.created_ms >= 0
            && self.created_ms <= 253_402_300_799_999
            && self.occurrences > 0
            && self.occurrences <= 9_007_199_254_740_991
            && self.context.len() <= 3
            && self.context.iter().all(Record::valid)
            && self.events.len() <= 768
            && self.events.iter().all(Record::valid)
            && serde_json::to_vec(self).is_ok_and(|b| b.len() <= MAX_INCIDENT_BYTES)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UiError {
    pub category: UiCategory,
    pub feature: Feature,
    pub line: Option<u32>,
    pub column: Option<u32>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UiCategory {
    Exception,
    Rejection,
    Protocol,
    Request,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Feature {
    App,
    Connection,
    Configuration,
    Sessions,
    Storage,
}
