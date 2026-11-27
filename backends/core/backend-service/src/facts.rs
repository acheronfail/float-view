//! Owned service records. Public frontend projection stays in the shared server.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

macro_rules! record {
    ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {
        #[derive(Clone, Debug, Deserialize, Serialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        pub struct $name { $(pub $field: $ty),* }
    };
}
record!(Bluetooth {
    radio: String,
    scan_permission: String,
    connect_permission: String
});
record!(Location { authorization: String, background_capture: String, reason: Option<String>, permission_action: Option<crate::permissions::Action> });
record!(Settings {
    auto_connect_saved_device_id: Option<String>,
    safety_disclaimer_accepted: bool,
    announcements: float_view_product_store::AnnouncementSettings,
    session_display_options: float_view_product_store::SessionDisplayOptions,
    revision: u64, idle_probe_interval_ms: u64, idle_persist_interval_ms: u64,
    riding_persist_interval_ms: u64, post_ride_tail_ms: u64, reconnect_duration_ms: u64,
    ride_resume_window_minutes: u64,
    minimum_session_distance: f64, theme_preference: String, accent_preference: String, unit_preference: String, live_widget_slots: [String; 5],
    history_gap_threshold_seconds: Option<f64>, location_recording_enabled: bool,
    include_gps_location_when_exporting: bool,
});
record!(BoardHistory {
    session_count: u64, total_riding_elapsed_ms: u64, total_distance_m: Option<f64>,
    most_recent_session_at: Option<String>, total_storage_bytes: Option<u64>,
});
record!(SavedBoard {
    appearance: float_view_product_store::BoardAppearance,
    saved_device_id: String, device_history_id: String, revision: u64, display_name: String,
    custom_display_name: Option<String>, advertised_name: Option<String>, bluetooth_identifier: Option<String>,
    last_seen_at: Option<String>, last_connected_at: Option<String>, profile_complete: bool, summary: BoardHistory,
});
record!(Profile { saved_device_id: String, revision: u64, values_json: String, missing_fields: Vec<String> });
record!(Session {
    session_id: String, device_history_id: String, display_name: String, started_at: String,
    ended_at: Option<String>, state: String, integrity: String, sample_count: u64, event_count: u64,
    riding_elapsed_ms: u64, total_elapsed_ms: u64, distance_m: Option<f64>, max_speed_mps: Option<f64>,
    max_duty_cycle: Option<f64>,
});
record!(Boundary {
    history_revision: u64,
    committed_sample_sequence: u64,
    committed_event_sequence: u64,
    committed_elapsed_ms: u64,
    recorded_sample_count: u64,
    stored_sample_count: u64,
    committed_location_sequence: u64,
    committed_location_elapsed_ms: u64,
    recorded_location_count: u64,
    stored_location_count: u64,
    location_status: String,
});
record!(PruneMetadata {
    target_resolution_seconds: Option<u64>, recorded_sample_count: u64,
    stored_sample_count: u64, policy: Option<String>,
});
record!(SessionSource {
    summary: Session,
    boundary: Boundary,
    path: String
});
record!(SessionMetadata { recording_breaks: Vec<float_view_application_runtime::session::RecordingBreak>, connection_context_count: usize, marker_count: usize, summary: Session, recorded_fields: Vec<String>, extension_fields: Vec<String>, boundary: Boundary, prune: PruneMetadata });
record!(SessionPage { items: Vec<Session>, next_cursor: Option<String> });
record!(Maintenance {
    operation_id: String, kind: String, scope: String, state: String, session_id: Option<String>,
    target_resolution_seconds: u64, upper_session_id: Option<String>, last_session_id: Option<String>,
    completed_sessions: u64, skipped_sessions: u64, retained_samples: u64, reclaimable_bytes: u64, error: Option<String>,
});

record!(Controls {
    status: String, writable: bool, package_enabled: Option<bool>, flywheel_enabled: Option<bool>,
    lighting_available: bool, leds_enabled: Option<bool>, headlights_enabled: Option<bool>,
    fatal_error_clear_available: bool, imu_timeout_available: bool, fatal_error_latched: Option<bool>, fatal_error_active: Option<bool>,
    fatal_error_clearable: Option<bool>, pending_action: Option<String>,
});
record!(ConfigurationSummary {
    availability: String, writable: bool, write_block_reason: Option<String>, package_version: Option<String>, schema_fingerprint: Option<String>,
    wire_signature: Option<u32>, current_loaded: bool, default_loaded: bool, pending_operation: Option<String>,
});
record!(ConfigurationIdentity {
    package_name: String,
    package_version: String,
    schema_fingerprint: String,
    wire_signature: u32
});
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "type",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum ConfigurationValue {
    Double(f64),
    Integer(i64),
    Boolean(bool),
    String(String),
}
record!(ConfigurationValues { revision: u64, source: String, values: BTreeMap<String, ConfigurationValue> });
record!(ConfigurationField {
    name: String, long_name: String, field_type: u8, wire_type: Option<u8>, default_value: ConfigurationValue,
    minimum: Option<f64>, maximum: Option<f64>, step: Option<f64>, precision: Option<u32>, editor_scale: f64, edit_as_percentage: bool, wire_minimum: Option<f64>, wire_maximum: Option<f64>, scale: Option<f64>,
    suffix: String, choices: Vec<String>, description: String, tunable: bool,
});
record!(ConfigurationSubgroup { name: String, fields: Vec<String> });
record!(ConfigurationGroup { name: String, subgroups: Vec<ConfigurationSubgroup> });
record!(ConfigurationSchema { fingerprint: String, wire_signature: u32, fields: Vec<ConfigurationField>, groups: Vec<ConfigurationGroup> });
record!(Tune {
    configuration_id: String, revision: u64, name: String, description: Option<String>,
    identity: ConfigurationIdentity, values_json: String, created_at: String, updated_at: String,
});
record!(TunePage { items: Vec<Tune>, next_cursor: Option<String> });
record!(Device { device_id: String, name: Option<String>, rssi: Option<i32>, last_seen_at: String, saved_device_id: Option<String> });
record!(Discovery { bluetooth_state: Bluetooth, active_scan_id: Option<String>, known_devices: Vec<Device> });
record!(Firmware { major: u8, minor: u8, hardware_name: Option<String>, access_mode: String });
record!(CurrentLimits {
    motor_current_max_a: f64, motor_current_min_a: f64, battery_current_max_a: f64,
    battery_current_min_a: f64, battery_series_cells: Option<u8>,
});
record!(LiveLocation { latitude: f64, longitude: f64, accuracy_m: Option<f64>, altitude_m: Option<f64>, observed_at: String });
record!(TransportFirmware { vesc_version: String, hardware_name: Option<String>, firmware_name: Option<String>, test_version: u8 });
record!(ControllerCandidate { can_id: u8, hardware_name: Option<String>, firmware_name: Option<String>, vesc_version: String, vesc_supported: bool });
record!(RefloatCompatibility { reported_version: String, supported_versions: Vec<String> });
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionIssue {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub refloat_compatibility: Option<RefloatCompatibility>,
}
record!(ControllerActions { shutdown_available: bool, pending_action: Option<String> });
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Route {
    Direct,
    Can {
        #[serde(rename = "canId")]
        can_id: u8,
    },
}
record!(BmsCandidate { connection: Route, hardware_name: Option<String>, vesc_version: String });
record!(BmsSnapshot {
    observed_at: String, total_voltage_v: f64, charge_voltage_v: f64, input_current_a: f64,
    input_ic_current_a: f64, session_amp_hours_ah: f64, session_watt_hours_wh: f64,
    cell_voltages_v: Vec<f64>, balancing: Vec<bool>, temperatures_c: Vec<f64>, ic_temperature_c: f64,
    humidity_sensor_temperature_c: f64, humidity_percent: f64, highest_cell_temperature_c: f64,
    highest_circuitry_temperature_c: f64,
    state_of_charge: f64, state_of_health: f64, reported_can_id: u8,
    lifetime_charge_amp_hours_ah: f64, lifetime_charge_watt_hours_wh: f64,
    lifetime_discharge_amp_hours_ah: f64, lifetime_discharge_watt_hours_wh: f64,
    pressure_pa: f64, data_version: Option<u8>, status: Option<String>,
});
record!(Bms { status: String, connection: Option<Route>, candidates: Vec<BmsCandidate>, latest_snapshot: Option<BmsSnapshot> });
record!(ReportedFirmwareFault {
    code: u8,
    reason: String
});
record!(RecoveredImuTimeout { active: bool, elapsed_ms: Option<u64>, observed_elapsed_ms: u64 });
record!(RecoveredFirmwareFault { code: u8, reason: String, elapsed_ms: Option<u64>, observed_elapsed_ms: u64 });
record!(LiveSample {
    load: float_view_application_runtime::load::Load,
    sequence: u64, observed_at: String, slow_observed_at: Option<String>, elapsed_ms: u64, riding_elapsed_ms: u64,
    ride_state: String, package_state: Option<String>, package_mode: Option<String>, footpad_state: Option<String>,
    stop_condition: Option<String>, setpoint_adjustment: Option<String>, wheelslip: Option<bool>, darkride: Option<bool>,
    charging: Option<bool>, alert_reason: Option<String>, firmware_fault: Option<String>,
    imu_timeout_active: Option<bool>, fatal_error_latched: Option<bool>, last_firmware_fault: Option<ReportedFirmwareFault>, fault_history: Vec<RecoveredFirmwareFault>, imu_timeout_history: Vec<RecoveredImuTimeout>,
    pack_voltage_v: Option<f64>, duty_cycle: Option<f64>, controller_temp_c: Option<f64>, motor_temp_c: Option<f64>,
    motor_current_a: Option<f64>, battery_current_a: Option<f64>, erpm: Option<f64>, speed_kph: Option<f64>, max_speed_kph: Option<f64>,
    pitch_deg: Option<f64>, balance_pitch_deg: Option<f64>, roll_deg: Option<f64>, directional_motor_current_a: Option<f64>,
    filtered_motor_current_a: Option<f64>, requested_balance_current_a: Option<f64>, booster_current_a: Option<f64>,
    field_weakening_current_a: Option<f64>, footpad_adc1_v: Option<f64>, footpad_adc2_v: Option<f64>, remote_input: Option<f64>,
    setpoint_deg: Option<f64>, atr_setpoint_deg: Option<f64>, brake_tilt_setpoint_deg: Option<f64>, torque_tilt_setpoint_deg: Option<f64>,
    turn_tilt_setpoint_deg: Option<f64>, remote_setpoint_deg: Option<f64>, atr_acceleration_difference_erpm_per_second: Option<f64>,
    atr_speed_boost: Option<f64>, distance_m: Option<f64>, odometer_m: Option<f64>, amp_hours_drawn_ah: Option<f64>,
    amp_hours_charged_ah: Option<f64>, watt_hours_drawn_wh: Option<f64>, watt_hours_charged_wh: Option<f64>,
    battery_level: Option<f64>, charging_current_a: Option<f64>, charging_voltage_v: Option<f64>, extension_fields: BTreeMap<String, f64>,
});
record!(BatteryCellProfile {
    id: String,
    label: String
});
record!(Connection {
    device_id: String, name: Option<String>, state: String, device_kind: Option<String>, tracking_mode: String,
    saved_device: Option<SavedBoard>, active_session: Option<Session>, latest_sample: Option<LiveSample>,
    battery_warning: Option<crate::announcements::Battery>,
    battery_estimate: crate::battery_estimator::Estimate, live_widget_slots: [String; 5],
    latest_location: Option<LiveLocation>, current_limits: Option<CurrentLimits>, controller_route: Option<Route>,
    transport_firmware: Option<TransportFirmware>,
    controller_candidates: Vec<ControllerCandidate>, connection_issue: Option<ConnectionIssue>, connection_warning: Option<ConnectionIssue>, bms: Bms,
    refloat_controls: Option<Controls>, controller_actions: ControllerActions,
});
record!(PausedRide {
    session_id: String,
    saved_device_id: String,
    display_name: String,
    resume_until: String
});
record!(Snapshot {
    speed_calibration: crate::calibration::State,
    paused_ride: Option<PausedRide>,
    announcement_audio: crate::announcements::AudioState,
    battery_cell_profiles: Vec<BatteryCellProfile>,
    battery_presets: Vec<float_view_product_store::battery_presets::Preset>,
    battery_preset_catalog_version: String,
    discovery: Discovery, active: Option<Connection>, firmware: Option<Firmware>, package_version: Option<String>,
    configuration: ConfigurationSummary, saved_boards: Vec<SavedBoard>, settings: Settings,
    permissions: Vec<crate::permissions::Row>,
    location: Location, maintenance: Option<Maintenance>,
});
record!(HistoryPoint { elapsed_ms: u64, sequence: u64, values: BTreeMap<String, Option<f64>> });
record!(HistoryEvent { event_id: String, elapsed_ms: u64, source_sample_sequence: Option<u64>, kind: String, details_json: String });
record!(SeriesColumn { elapsed_ms: Vec<u64>, sequence: Vec<u64>, values: Vec<Option<f64>>, generations: Vec<u32> });
record!(LocationPoint { location_sequence: u64, elapsed_ms: u64, latitude: f64, longitude: f64, accuracy_m: Option<f64>, altitude_m: Option<f64>, observed_at: String });
record!(LocationGap {
    start_elapsed_ms: u64,
    end_elapsed_ms: u64,
    reason: String
});
record!(LocationPage { points: Vec<LocationPoint>, gaps: Vec<LocationGap>, next_cursor: Option<String>, snapshot: Boundary });

/// Typed portable operation results.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    content = "facts",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum Completion {
    Announcement {
        outcome: crate::announcements::Outcome,
    },
    Permissions(Vec<crate::permissions::Row>),
    RideMarker {
        marker: float_view_application_runtime::session::RideMarker,
        boundary: Boundary,
    },
    Unit,
    Bluetooth(Bluetooth),
    Location(Location),
    Settings(Settings),
    SavedBoard(SavedBoard),
    Profile(Profile),
    Controls(Controls),
    ConfigurationSummary(ConfigurationSummary),
    ConfigurationSchema(ConfigurationSchema),
    ConfigurationValues(ConfigurationValues),
    Tune(Tune),
    Tunes(TunePage),
    Sessions(SessionPage),
    Session(SessionSource),
    Maintenance(Option<Maintenance>),
    CancelDelete(bool),
    Export {
        file_name: String,
        presented: bool,
        transfer_id: u64,
        length: u64,
    },
    Imported(String),
    AppImported(float_view_product_store::AppImportSummary),
    TransferReady,
}

/// Shared reader results never cross the native host exchange.
pub enum HistoryResult {
    ConnectionContexts(Vec<float_view_application_runtime::session::ConnectionContextEvent>),
    RideMarkers(Vec<float_view_application_runtime::session::RideMarker>),
    HistoryPoints(Vec<HistoryPoint>),
    HistoryEvents(Vec<HistoryEvent>),
    SeriesColumns(BTreeMap<String, SeriesColumn>),
    Locations(LocationPage),
}
