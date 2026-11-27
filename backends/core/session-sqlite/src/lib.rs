//! Bounded access to one canonical Float View session database.

#![forbid(unsafe_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{self, Debug, Display, Formatter};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use float_view_refloat_telemetry_service::{
    AlertReason, ExtensionValue, FirmwareFault, FootpadState, NormalizedSample, PackageMode,
    PackageState, RideState, SetpointAdjustment, StopCondition,
};
use rusqlite::ffi::ErrorCode;
use rusqlite::{
    Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior, named_params,
    params,
};

mod connection_context;
pub use connection_context::{
    ConnectionContext, ConnectionContextEvent, ContextFirmware, ContextRoute,
    MAX_CONNECTION_CONTEXTS, MAX_CONTEXT_PAGE,
};
mod diagnostics;
mod interruptions;
pub use interruptions::InterruptionReason;
mod faults;
pub use diagnostics::{DiagnosticWriter, MAX_DIAGNOSTIC_BYTES, MAX_DIAGNOSTIC_ROWS};
pub use faults::MAX_FIRMWARE_FAULT_EVENTS;
mod markers;
pub use markers::{MAX_MARKER_PAGE, MAX_RIDE_MARKERS, MarkerLocation, RideMarker};
mod pruner;
mod reader;

pub use pruner::{
    MAX_PRUNE_SOURCE_ROWS, PruneError, PruneInterrupter, PrunePlan, PrunePreview, PruneResult,
    SessionPruner,
};
pub use reader::{
    EventPage, EventRecord, FieldDescriptor, FieldSource, LocationGap, LocationPage,
    LocationRecord, MAX_RECORDING_BREAKS, PublishedBoundary, ReadInterrupter, ReaderError,
    ReaderMetadata, RecordingBreak, SampleKey, SamplePage, SampleRecord, SeriesReduction,
    SessionReader,
};

pub const SESSION_SCHEMA: &str = include_str!("../../../sql/session.sql");
pub const LOCATION_ALTITUDE_SCHEMA: &str =
    include_str!("../../../sql/session-location-altitude.sql");

pub fn has_location_altitude(connection: &Connection) -> rusqlite::Result<bool> {
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_xinfo('location') WHERE name = 'altitude_m')",
        [],
        |row| row.get(0),
    )
}
pub const MAX_SAMPLE_BATCH: usize = 1_024;
pub const MAX_LOCATION_BATCH: usize = 1_024;
// Firmware extensions plus product-owned load fractions and the battery estimate.
pub const MAX_EXTENSIONS: usize = 35;
pub const MAX_EXTENSION_NAME_BYTES: usize = 64;
pub const MAX_EXTENSION_JSON_BYTES: usize = 16_384;
pub const MAX_PERSISTENCE_CADENCE_MS: u64 = 86_400_000;

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum WriterError {
    InvalidInput,
    TargetExists,
    Incompatible,
    Corrupt,
    Busy,
    Full,
    Io,
    Database,
}

impl Debug for WriterError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidInput => "InvalidInput",
            Self::TargetExists => "TargetExists",
            Self::Incompatible => "Incompatible",
            Self::Corrupt => "Corrupt",
            Self::Busy => "Busy",
            Self::Full => "Full",
            Self::Io => "Io",
            Self::Database => "Database",
        })
    }
}

impl Display for WriterError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        Debug::fmt(self, formatter)
    }
}

impl std::error::Error for WriterError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SessionMetadata {
    pub expected_riding_persistence_ms: u64,
    pub expected_idle_persistence_ms: u64,
    pub committed_at_epoch_ms: i64,
}

impl SessionMetadata {
    fn validate(self) -> Result<(), WriterError> {
        if self.committed_at_epoch_ms < 0
            || !(1..=MAX_PERSISTENCE_CADENCE_MS).contains(&self.expected_riding_persistence_ms)
            || !(1..=MAX_PERSISTENCE_CADENCE_MS).contains(&self.expected_idle_persistence_ms)
        {
            return Err(WriterError::InvalidInput);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, PartialEq)]
pub struct LocationObservation {
    pub observed_at_epoch_ms: i64,
    pub elapsed_ms: u64,
    pub latitude: f64,
    pub longitude: f64,
    pub accuracy_m: Option<f64>,
    pub altitude_m: Option<f64>,
}

impl Debug for LocationObservation {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str("LocationObservation([redacted])")
    }
}

#[derive(Clone, PartialEq)]
pub struct CommitMarker {
    pub committed_sample_sequence: u64,
    pub committed_event_sequence: u64,
    pub recorded_sample_count: u64,
    pub stored_sample_count: u64,
    pub committed_event_count: u64,
    pub committed_elapsed_ms: u64,
    pub history_revision: u64,
    pub committed_at_epoch_ms: i64,
    pub riding_elapsed_ms: u64,
    pub distance_m: Option<f64>,
    pub maximum_speed_kph: Option<f64>,
    pub maximum_speed_source_sequence: Option<u64>,
    pub maximum_duty_cycle: Option<f64>,
    pub maximum_duty_source_sequence: Option<u64>,
    pub last_speed_kph: Option<f64>,
    pub last_ride_state: Option<String>,
    pub committed_location_sequence: u64,
    pub committed_location_elapsed_ms: u64,
    pub recorded_location_count: u64,
    pub stored_location_count: u64,
    pub last_location_status: String,
}

impl Debug for CommitMarker {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str("CommitMarker([redacted])")
    }
}

pub struct SessionWriter {
    connection: Connection,
    fatal_latch_transition: Option<String>,
    recording_gap: bool,
    interruption_reason: InterruptionReason,
}

impl Debug for SessionWriter {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str("SessionWriter([redacted])")
    }
}

impl SessionWriter {
    pub fn create(path: impl AsRef<Path>, metadata: SessionMetadata) -> Result<Self, WriterError> {
        metadata.validate()?;
        let target = path.as_ref();
        let parent = target.parent().ok_or(WriterError::InvalidInput)?;
        let file_name = target
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .ok_or(WriterError::InvalidInput)?;
        if target.exists() {
            return Err(WriterError::TargetExists);
        }
        let temporary = parent.join(format!(
            ".{file_name}.float-view-{}.{}.tmp",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let guard = TemporaryDatabase::new(temporary.clone());
        let mut connection = open_write(&temporary, true)?;
        connection
            .execute_batch(SESSION_SCHEMA)
            .map_err(map_sqlite)?;
        {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(map_sqlite)?;
            transaction
                .execute(
                    "INSERT INTO session_metadata(singleton, expected_riding_persistence_ms, expected_idle_persistence_ms) VALUES (1, ?, ?)",
                    params![
                        sqlite_integer(metadata.expected_riding_persistence_ms)?,
                        sqlite_integer(metadata.expected_idle_persistence_ms)?,
                    ],
                )
                .map_err(map_sqlite)?;
            transaction
                .execute(
                    "INSERT INTO commit_marker(singleton, committed_at_ms) VALUES (1, ?)",
                    [metadata.committed_at_epoch_ms],
                )
                .map_err(map_sqlite)?;
            transaction.commit().map_err(map_sqlite)?;
        }
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(map_sqlite)?;
        connection.close().map_err(|(_, error)| map_sqlite(error))?;

        // Android app sandboxes prohibit hard links. Reserve the destination
        // exclusively, then atomically replace our own empty reservation. The
        // process-owned storage root excludes other writers; no catalog entry
        // exposes the target until creation succeeds.
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
        {
            Ok(file) => drop(file),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(WriterError::TargetExists);
            }
            Err(_) => return Err(WriterError::Io),
        }
        let reservation = TemporaryDatabase::new(target.to_path_buf());
        fs::rename(&temporary, target).map_err(|_| WriterError::Io)?;
        guard.disarm();
        fs::File::open(target)
            .and_then(|file| file.sync_all())
            .map_err(|_| WriterError::Io)?;
        fs::File::open(parent)
            .and_then(|file| file.sync_all())
            .map_err(|_| WriterError::Io)?;
        reservation.disarm();
        Self::open(target)
    }

    pub fn open(path: impl AsRef<Path>) -> Result<Self, WriterError> {
        let path = path.as_ref();
        let read = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(map_open_sqlite)?;
        validate_database(&read)?;
        read.close().map_err(|(_, error)| map_sqlite(error))?;
        let connection = open_write(path, false)?;
        let fatal_latch_transition = connection.query_row(
            "SELECT CASE WHEN length(details_json)<=64 AND json_valid(details_json) THEN json_extract(details_json,'$.value') ELSE '' END FROM session_event WHERE kind='fatalErrorLatched' ORDER BY sequence DESC LIMIT 1", [], |row| row.get::<_, String>(0)
        ).optional().map_err(map_sqlite)?;
        if fatal_latch_transition
            .as_deref()
            .is_some_and(|value| !matches!(value, "active" | "cleared"))
        {
            return Err(WriterError::Incompatible);
        }
        let pending = interruptions::pending_reason(&connection)?;
        Ok(Self {
            connection,
            fatal_latch_transition,
            recording_gap: pending.is_some(),
            interruption_reason: pending.unwrap_or_default(),
        })
    }

    pub fn mark_recording_gap(&mut self) {
        self.recording_gap = true;
    }

    pub fn append_samples(
        &mut self,
        samples: &[NormalizedSample],
    ) -> Result<CommitMarker, WriterError> {
        let validated = validate_samples(samples)?;
        sqlite_integer(samples.len() as u64)?;
        let last_submitted_sequence = samples
            .iter()
            .map(|sample| sample.sequence)
            .max()
            .ok_or(WriterError::InvalidInput)?;
        let committed_at_epoch_ms = samples
            .last()
            .ok_or(WriterError::InvalidInput)?
            .observed_at_epoch_ms;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite)?;
        let existing_marker = read_marker(&transaction)?;
        let recorded_sample_count = existing_marker
            .recorded_sample_count
            .checked_add(samples.len() as u64)
            .ok_or(WriterError::InvalidInput)?;
        sqlite_integer(recorded_sample_count)?;
        // The published boundary may include a marker later than the last sample.
        // Use the indexed sample tail for integration, never that boundary time.
        let last_key: Option<(u64, u64)> = transaction.query_row(
            "SELECT monotonic_elapsed_ms, sequence FROM sample ORDER BY monotonic_elapsed_ms DESC, sequence DESC LIMIT 1",
            [], |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional().map_err(map_sqlite)?;
        let mut aggregate = Aggregate::from_marker(&existing_marker, last_key);
        let mut ordered_append = true;
        let mut transitions = latest_transition_values(&transaction)?;
        if let Some(latched) = &self.fatal_latch_transition {
            transitions.insert("fatalErrorLatched".to_owned(), latched.clone());
        }
        let mut event_sequence: u64 = transaction
            .query_row(
                "SELECT COALESCE(MAX(sequence), 0) FROM session_event",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(map_sqlite)
            .and_then(|value| u64::try_from(value).map_err(|_| WriterError::Incompatible))?;

        let mut gap = self.recording_gap;
        for value in &validated {
            let sample = value.sample;
            let inserted = transaction
                .prepare_cached(INSERT_SAMPLE)
                .map_err(map_sqlite)?
                .execute(
                    named_params! {
                        ":sequence": sqlite_integer(sample.sequence)?,
                        ":observed": sample.observed_at_epoch_ms,
                        ":slow_observed": sample.slow_observed_at_epoch_ms,
                        ":elapsed": sqlite_integer(sample.elapsed_ms)?,
                        ":ride_state": ride_state(sample.ride_state),
                        ":package_state": sample.package_state.map(package_state),
                        ":package_mode": sample.package_mode.map(package_mode),
                        ":stop_condition": sample.stop_condition.map(stop_condition),
                        ":setpoint_adjustment": sample.setpoint_adjustment.map(setpoint_adjustment),
                        ":wheelslip": sample.wheelslip,
                        ":darkride": sample.darkride,
                        ":charging": sample.charging,
                        ":alert_reason": sample.alert_reason.map(alert_reason),
                        ":firmware_fault": sample.firmware_fault.map(firmware_fault),
                        ":pack_voltage": sample.pack_voltage_v,
                        ":duty": sample.duty_cycle,
                        ":controller_temp": sample.controller_temp_c,
                        ":motor_temp": sample.motor_temp_c,
                        ":bms_circuitry_temp": sample.bms_circuitry_temp_c,
                        ":bms_highest_cell_temp": sample.bms_highest_cell_temp_c,
                        ":footpad_state": sample.footpad_state.map(footpad_state),
                        ":extension_json": value.extension_json,
                        ":motor_current": sample.motor_current_a,
                        ":battery_current": sample.battery_current_a,
                        ":erpm": sample.erpm,
                        ":speed": sample.speed_kph,
                        ":pitch": sample.pitch_deg,
                        ":balance_pitch": sample.balance_pitch_deg,
                        ":roll": sample.roll_deg,
                        ":directional_motor_current": sample.directional_motor_current_a,
                        ":filtered_motor_current": sample.filtered_motor_current_a,
                        ":requested_balance_current": sample.requested_balance_current_a,
                        ":booster_current": sample.booster_current_a,
                        ":field_weakening_current": sample.field_weakening_current_a,
                        ":footpad_adc_1": sample.footpad_adc1_v,
                        ":footpad_adc_2": sample.footpad_adc2_v,
                        ":remote_input": sample.remote_input,
                        ":setpoint": sample.setpoint_deg,
                        ":atr_setpoint": sample.atr_setpoint_deg,
                        ":brake_tilt_setpoint": sample.brake_tilt_setpoint_deg,
                        ":torque_tilt_setpoint": sample.torque_tilt_setpoint_deg,
                        ":turn_tilt_setpoint": sample.turn_tilt_setpoint_deg,
                        ":remote_setpoint": sample.remote_setpoint_deg,
                        ":atr_acceleration_difference": sample.atr_acceleration_difference_erpm_per_second,
                        ":atr_speed_boost": sample.atr_speed_boost,
                        ":distance": sample.distance_m,
                        ":odometer": sample.odometer_m,
                        ":amp_hours_drawn": sample.amp_hours_drawn_ah,
                        ":amp_hours_charged": sample.amp_hours_charged_ah,
                        ":watt_hours_drawn": sample.watt_hours_drawn_wh,
                        ":watt_hours_charged": sample.watt_hours_charged_wh,
                        ":battery_level": sample.battery_level,
                        ":charging_current": sample.charging_current_a,
                        ":charging_voltage": sample.charging_voltage_v,
                    },
                )
                .map_err(map_sqlite)?;
            if inserted == 0 {
                continue;
            }

            if last_key.is_some_and(|key| (sample.elapsed_ms, sample.sequence) <= key) {
                ordered_append = false;
            }
            if gap && aggregate.sample_count > 0 {
                let count: u64 = transaction.query_row("SELECT COUNT(*) FROM (SELECT 1 FROM session_event WHERE kind='recordingBoundary' LIMIT 1001)", [], |r| r.get(0)).map_err(map_sqlite)?;
                if count >= 1000 {
                    return Err(WriterError::Full);
                }
                event_sequence = event_sequence
                    .checked_add(1)
                    .ok_or(WriterError::InvalidInput)?;
                aggregate.event_count = aggregate
                    .event_count
                    .checked_add(1)
                    .ok_or(WriterError::InvalidInput)?;
                let previous = last_key.map_or(0, |k| k.1);
                transaction.execute("INSERT INTO session_event(sequence,source_sample_sequence,observed_at_ms,monotonic_elapsed_ms,kind,details_json) VALUES (?,?,?,?,'recordingBoundary',?)", params![sqlite_integer(event_sequence)?, sqlite_integer(sample.sequence)?, sample.observed_at_epoch_ms, sqlite_integer(sample.elapsed_ms)?, serde_json::json!({"value":"resumed","previousSequence":previous,"reason":self.interruption_reason}).to_string()]).map_err(map_sqlite)?;
            }
            if ordered_append {
                aggregate.append(sample, gap)?;
            }
            gap = false;
            let sequence = sqlite_integer(sample.sequence)?;
            for (field, numeric) in numeric_values(sample) {
                if numeric.is_some() {
                    transaction
                        .prepare_cached("INSERT OR IGNORE INTO session_numeric_field(field_name, source, first_sequence) VALUES (?, 'stable', ?)")
                        .map_err(map_sqlite)?
                        .execute(
                            params![field, sequence],
                        )
                        .map_err(map_sqlite)?;
                }
            }
            for extension in &sample.extensions {
                transaction
                    .prepare_cached("INSERT OR IGNORE INTO session_numeric_field(field_name, source, first_sequence) VALUES (?, 'extension', ?)")
                    .map_err(map_sqlite)?
                    .execute(
                        params![extension.name, sequence],
                    )
                    .map_err(map_sqlite)?;
            }
            for (kind, transition) in &value.transitions {
                if transitions.get(*kind).is_some_and(|old| old == transition) {
                    continue;
                }
                event_sequence = event_sequence
                    .checked_add(1)
                    .ok_or(WriterError::InvalidInput)?;
                let mut details = BTreeMap::new();
                details.insert("value", transition);
                let details_json =
                    serde_json::to_string(&details).map_err(|_| WriterError::InvalidInput)?;
                transaction
                    .prepare_cached("INSERT INTO session_event(sequence, source_sample_sequence, observed_at_ms, monotonic_elapsed_ms, kind, details_json) VALUES (?, ?, ?, ?, ?, ?)")
                    .map_err(map_sqlite)?
                    .execute(
                        params![
                            sqlite_integer(event_sequence)?,
                            sequence,
                            sample.observed_at_epoch_ms,
                            sqlite_integer(sample.elapsed_ms)?,
                            kind,
                            details_json,
                        ],
                    )
                    .map_err(map_sqlite)?;
                aggregate.event_count = aggregate
                    .event_count
                    .checked_add(1)
                    .ok_or(WriterError::InvalidInput)?;
                transitions.insert((*kind).to_owned(), transition.clone());
            }
        }

        aggregate.event_sequence = event_sequence;
        // Out-of-order inserts remain supported; only those need recomputation.
        // Normal recording and duplicate replay do work bounded by the batch.
        if !ordered_append {
            aggregate = aggregate_samples(&transaction)?;
        }
        let committed_sample_sequence = existing_marker
            .committed_sample_sequence
            .max(last_submitted_sequence);
        transaction
            .execute(
                "UPDATE commit_marker SET committed_sample_sequence = ?, committed_event_sequence = ?, recorded_sample_count = ?, stored_sample_count = ?, committed_event_count = ?, committed_elapsed_ms = ?, committed_at_ms = ?, riding_elapsed_ms = ?, distance_m = ?, maximum_speed_kph = ?, maximum_speed_source_sequence = ?, maximum_duty_cycle = ?, maximum_duty_source_sequence = ?, last_speed_kph = ?, last_ride_state = ? WHERE singleton = 1",
                params![
                    sqlite_integer(committed_sample_sequence)?,
                    sqlite_integer(aggregate.event_sequence)?,
                    sqlite_integer(recorded_sample_count)?,
                    sqlite_integer(aggregate.sample_count)?,
                    sqlite_integer(aggregate.event_count)?,
                    sqlite_integer(aggregate.elapsed_ms.max(existing_marker.committed_elapsed_ms))?,
                    committed_at_epoch_ms,
                    sqlite_integer(aggregate.riding_elapsed_ms)?,
                    aggregate.distance_m,
                    aggregate.maximum_speed_kph,
                    aggregate.maximum_speed_source_sequence.map(sqlite_integer).transpose()?,
                    aggregate.maximum_duty_cycle,
                    aggregate.maximum_duty_source_sequence.map(sqlite_integer).transpose()?,
                    aggregate.last_speed_kph,
                    aggregate.last_ride_state,
                ],
            )
            .map_err(map_sqlite)?;
        transaction.commit().map_err(map_sqlite)?;
        self.recording_gap = gap;
        if !gap {
            self.interruption_reason = InterruptionReason::Unknown;
        }
        self.fatal_latch_transition = transitions.remove("fatalErrorLatched");
        self.marker()
    }

    /// Append a product event through the sole session writer. Profile revisions
    /// are payload, never event sequence IDs (which would overwrite telemetry).
    pub fn append_profile_change(
        &mut self,
        saved_device_id: &str,
        revision: u64,
        values_json: &str,
        at_ms: i64,
    ) -> Result<CommitMarker, WriterError> {
        if saved_device_id.is_empty()
            || saved_device_id.len() > 128
            || saved_device_id.contains('\0')
            || values_json.len() > 16_384
            || at_ms < 0
        {
            return Err(WriterError::InvalidInput);
        }
        sqlite_integer(revision)?;
        let values: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(values_json).map_err(|_| WriterError::InvalidInput)?;
        let details=serde_json::to_string(&serde_json::json!({"savedDeviceId":saved_device_id,"revision":revision,"values":values})).map_err(|_|WriterError::InvalidInput)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite)?;
        let marker = read_marker(&tx)?;
        let sequence = marker
            .committed_event_sequence
            .checked_add(1)
            .ok_or(WriterError::InvalidInput)?;
        let count = marker
            .committed_event_count
            .checked_add(1)
            .ok_or(WriterError::InvalidInput)?;
        tx.execute("INSERT INTO session_event(sequence,observed_at_ms,monotonic_elapsed_ms,kind,details_json) VALUES (?,?,?,'board_profile_changed',?)",params![sqlite_integer(sequence)?,at_ms,sqlite_integer(marker.committed_elapsed_ms)?,details]).map_err(map_sqlite)?;
        tx.execute("UPDATE commit_marker SET committed_event_sequence=?,committed_event_count=?,committed_at_ms=? WHERE singleton=1",params![sqlite_integer(sequence)?,sqlite_integer(count)?,at_ms]).map_err(map_sqlite)?;
        tx.commit().map_err(map_sqlite)?;
        self.marker()
    }

    pub fn append_locations(
        &mut self,
        observations: &[LocationObservation],
    ) -> Result<CommitMarker, WriterError> {
        let ordered = validate_locations(observations)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite)?;
        let marker = read_marker(&transaction)?;
        let mut next_sequence: u64 = transaction
            .query_row(
                "SELECT COALESCE(MAX(location_sequence), 0) FROM location",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(map_sqlite)
            .and_then(|value| u64::try_from(value).map_err(|_| WriterError::Incompatible))?;
        let mut accepted = 0_u64;
        let mut committed_elapsed = marker.committed_location_elapsed_ms;
        let mut altitude_ready = false;
        for observation in ordered {
            let exists: bool = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM location WHERE monotonic_elapsed_ms = ? AND latitude = ? AND longitude = ?)",
                    params![
                        sqlite_integer(observation.elapsed_ms)?,
                        observation.latitude,
                        observation.longitude,
                    ],
                    |row| row.get(0),
                )
                .map_err(map_sqlite)?;
            if exists {
                continue;
            }
            next_sequence = next_sequence
                .checked_add(1)
                .ok_or(WriterError::InvalidInput)?;
            transaction
                .execute(
                    "INSERT INTO location(location_sequence, observed_at_ms, monotonic_elapsed_ms, latitude, longitude, accuracy_m) VALUES (?, ?, ?, ?, ?, ?)",
                    params![
                        sqlite_integer(next_sequence)?,
                        observation.observed_at_epoch_ms,
                        sqlite_integer(observation.elapsed_ms)?,
                        observation.latitude,
                        observation.longitude,
                        observation.accuracy_m,
                    ],
                )
                .map_err(map_sqlite)?;
            if let Some(altitude) = observation.altitude_m.filter(|value| value.is_finite()) {
                if !altitude_ready {
                    if !has_location_altitude(&transaction).map_err(map_sqlite)? {
                        transaction
                            .execute_batch(LOCATION_ALTITUDE_SCHEMA)
                            .map_err(map_sqlite)?;
                    }
                    altitude_ready = true;
                }
                transaction
                    .execute(
                        "UPDATE location SET altitude_m = ? WHERE location_sequence = ?",
                        params![altitude, sqlite_integer(next_sequence)?],
                    )
                    .map_err(map_sqlite)?;
            }
            accepted = accepted.checked_add(1).ok_or(WriterError::InvalidInput)?;
            committed_elapsed = observation.elapsed_ms;
        }
        if accepted > 0 {
            let recorded = marker
                .recorded_location_count
                .checked_add(accepted)
                .ok_or(WriterError::InvalidInput)?;
            let stored = marker
                .stored_location_count
                .checked_add(accepted)
                .ok_or(WriterError::InvalidInput)?;
            transaction
                .execute(
                    "UPDATE commit_marker SET committed_location_sequence = ?, committed_location_elapsed_ms = ?, recorded_location_count = ?, stored_location_count = ?, last_location_status = 'available' WHERE singleton = 1",
                    params![
                        sqlite_integer(next_sequence)?,
                        sqlite_integer(committed_elapsed)?,
                        sqlite_integer(recorded)?,
                        sqlite_integer(stored)?,
                    ],
                )
                .map_err(map_sqlite)?;
        }
        transaction.commit().map_err(map_sqlite)?;
        self.marker()
    }

    pub fn marker(&self) -> Result<CommitMarker, WriterError> {
        read_marker(&self.connection)
    }

    pub fn checkpoint(&self) -> Result<(), WriterError> {
        self.connection
            .execute_batch("PRAGMA wal_checkpoint(FULL);")
            .map_err(map_sqlite)
    }

    pub fn close(self) -> Result<(), WriterError> {
        self.connection
            .close()
            .map_err(|(_, error)| map_sqlite(error))
    }

    /// Release ownership even if checkpointing fails. Committed WAL data remains
    /// recoverable; a failed checkpoint must not retain the recording writer.
    pub fn checkpoint_and_close(self) -> Result<(), WriterError> {
        let checkpoint = self.checkpoint();
        let close = self.close();
        checkpoint.and(close)
    }
}

const INSERT_SAMPLE: &str = "INSERT OR IGNORE INTO sample(
sequence, observed_at_ms, slow_observed_at_ms, monotonic_elapsed_ms, ride_state,
package_state, package_mode, stop_condition, setpoint_adjustment, wheelslip, darkride,
charging, alert_reason, firmware_fault, raw_pack_voltage_v, duty_cycle, controller_temp_c,
motor_temp_c, bms_circuitry_temp_c, bms_highest_cell_temp_c, footpad_state, extension_json, motor_current_a, battery_current_a, erpm,
speed_kph, pitch_deg, balance_pitch_deg, roll_deg, directional_motor_current_a,
filtered_motor_current_a, requested_balance_current_a, booster_current_a,
field_weakening_current_a, footpad_adc_1_v, footpad_adc_2_v, remote_input, setpoint_deg,
atr_setpoint_deg, brake_tilt_setpoint_deg, torque_tilt_setpoint_deg, turn_tilt_setpoint_deg,
remote_setpoint_deg, atr_acceleration_difference_erpm_per_second, atr_speed_boost,
distance_m, odometer_m, amp_hours_drawn_ah, amp_hours_charged_ah, watt_hours_drawn_wh,
watt_hours_charged_wh, battery_level, charging_current_a, charging_voltage_v
) VALUES (
:sequence, :observed, :slow_observed, :elapsed, :ride_state, :package_state, :package_mode,
:stop_condition, :setpoint_adjustment, :wheelslip, :darkride, :charging, :alert_reason,
:firmware_fault, :pack_voltage, :duty, :controller_temp, :motor_temp, :bms_circuitry_temp, :bms_highest_cell_temp, :footpad_state,
:extension_json, :motor_current, :battery_current, :erpm, :speed, :pitch, :balance_pitch,
:roll, :directional_motor_current, :filtered_motor_current, :requested_balance_current,
:booster_current, :field_weakening_current, :footpad_adc_1, :footpad_adc_2, :remote_input,
:setpoint, :atr_setpoint, :brake_tilt_setpoint, :torque_tilt_setpoint, :turn_tilt_setpoint,
:remote_setpoint, :atr_acceleration_difference, :atr_speed_boost, :distance, :odometer,
:amp_hours_drawn, :amp_hours_charged, :watt_hours_drawn, :watt_hours_charged,
:battery_level, :charging_current, :charging_voltage
)";

struct ValidatedSample<'a> {
    sample: &'a NormalizedSample,
    extension_json: String,
    transitions: Vec<(&'static str, String)>,
}

fn validate_samples(samples: &[NormalizedSample]) -> Result<Vec<ValidatedSample<'_>>, WriterError> {
    if samples.is_empty() || samples.len() > MAX_SAMPLE_BATCH {
        return Err(WriterError::InvalidInput);
    }
    let mut prior = None;
    let mut result = Vec::with_capacity(samples.len());
    for sample in samples {
        sqlite_integer(sample.sequence)?;
        sqlite_integer(sample.elapsed_ms)?;
        if sample.observed_at_epoch_ms < 0
            || sample
                .slow_observed_at_epoch_ms
                .is_some_and(|value| value < 0)
            || prior.is_some_and(|value| value >= (sample.elapsed_ms, sample.sequence))
        {
            return Err(WriterError::InvalidInput);
        }
        prior = Some((sample.elapsed_ms, sample.sequence));
        if numeric_values(sample)
            .into_iter()
            .any(|(_, value)| value.is_some_and(|number| !number.is_finite()))
        {
            return Err(WriterError::InvalidInput);
        }
        let extension_json = extension_json(&sample.extensions)?;
        result.push(ValidatedSample {
            sample,
            extension_json,
            transitions: transition_values(sample),
        });
    }
    Ok(result)
}

fn extension_json(values: &[ExtensionValue]) -> Result<String, WriterError> {
    if values.len() > MAX_EXTENSIONS {
        return Err(WriterError::InvalidInput);
    }
    let mut extensions = BTreeMap::new();
    for value in values {
        let bytes = value.name.len();
        if bytes == 0
            || bytes > MAX_EXTENSION_NAME_BYTES
            || !value.value.is_finite()
            || extensions
                .insert(value.name.as_str(), value.value)
                .is_some()
        {
            return Err(WriterError::InvalidInput);
        }
    }
    let encoded = serde_json::to_string(&extensions).map_err(|_| WriterError::InvalidInput)?;
    if encoded.len() > MAX_EXTENSION_JSON_BYTES {
        return Err(WriterError::InvalidInput);
    }
    Ok(encoded)
}

fn validate_locations(
    observations: &[LocationObservation],
) -> Result<Vec<LocationObservation>, WriterError> {
    if observations.is_empty() || observations.len() > MAX_LOCATION_BATCH {
        return Err(WriterError::InvalidInput);
    }
    for observation in observations {
        sqlite_integer(observation.elapsed_ms)?;
        if observation.observed_at_epoch_ms < 0
            || !observation.latitude.is_finite()
            || !(-90.0..=90.0).contains(&observation.latitude)
            || !observation.longitude.is_finite()
            || !(-180.0..=180.0).contains(&observation.longitude)
            || observation
                .accuracy_m
                .is_some_and(|accuracy| !accuracy.is_finite() || accuracy < 0.0)
        {
            return Err(WriterError::InvalidInput);
        }
    }
    let mut ordered = observations.to_vec();
    ordered.sort_by(|left, right| {
        left.elapsed_ms
            .cmp(&right.elapsed_ms)
            .then(left.observed_at_epoch_ms.cmp(&right.observed_at_epoch_ms))
    });
    Ok(ordered)
}

fn latest_transition_values(
    transaction: &Transaction<'_>,
) -> Result<BTreeMap<String, String>, WriterError> {
    let row = transaction
        .query_row(
            "SELECT package_state, package_mode, footpad_state, stop_condition, setpoint_adjustment, wheelslip, darkride, charging, alert_reason, firmware_fault FROM sample ORDER BY sequence DESC LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?, row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?, row.get::<_, Option<bool>>(5)?,
                    row.get::<_, Option<bool>>(6)?, row.get::<_, Option<bool>>(7)?,
                    row.get::<_, Option<String>>(8)?, row.get::<_, Option<String>>(9)?,
                ))
            },
        )
        .optional()
        .map_err(map_sqlite)?;
    let mut values = BTreeMap::new();
    if let Some(row) = row {
        for (kind, value) in [
            ("packageState", row.0),
            ("packageMode", row.1),
            ("footpadState", row.2),
            ("stopCondition", row.3),
            ("setpointAdjustment", row.4),
        ] {
            if let Some(value) = value {
                values.insert(kind.to_owned(), value);
            }
        }
        for (kind, value) in [
            ("wheelslip", row.5),
            ("darkride", row.6),
            ("charging", row.7),
        ] {
            if let Some(value) = value {
                values.insert(kind.to_owned(), boolean_transition(value).to_owned());
            }
        }
        values.insert(
            "alertReason".to_owned(),
            row.8.unwrap_or_else(|| "none".to_owned()),
        );
        values.insert(
            "firmwareFault".to_owned(),
            row.9.unwrap_or_else(|| "none".to_owned()),
        );
    }
    Ok(values)
}

struct Aggregate {
    sample_count: u64,
    event_count: u64,
    event_sequence: u64,
    elapsed_ms: u64,
    riding_elapsed_ms: u64,
    distance_m: Option<f64>,
    maximum_speed_kph: Option<f64>,
    maximum_speed_source_sequence: Option<u64>,
    maximum_duty_cycle: Option<f64>,
    maximum_duty_source_sequence: Option<u64>,
    last_speed_kph: Option<f64>,
    last_ride_state: Option<String>,
}

impl Aggregate {
    fn from_marker(marker: &CommitMarker, last_key: Option<(u64, u64)>) -> Self {
        Self {
            sample_count: marker.stored_sample_count,
            event_count: marker.committed_event_count,
            event_sequence: marker.committed_event_sequence,
            elapsed_ms: last_key.map_or(0, |key| key.0),
            riding_elapsed_ms: marker.riding_elapsed_ms,
            distance_m: marker.distance_m,
            maximum_speed_kph: marker.maximum_speed_kph,
            maximum_speed_source_sequence: marker.maximum_speed_source_sequence,
            maximum_duty_cycle: marker.maximum_duty_cycle,
            maximum_duty_source_sequence: marker.maximum_duty_source_sequence,
            last_speed_kph: marker.last_speed_kph,
            last_ride_state: marker.last_ride_state.clone(),
        }
    }

    fn append(&mut self, sample: &NormalizedSample, gap: bool) -> Result<(), WriterError> {
        let mut distance = self.distance_m.unwrap_or(0.0);
        if self.sample_count > 0 && !gap {
            let delta = sample.elapsed_ms.saturating_sub(self.elapsed_ms);
            if sample.ride_state == RideState::Riding {
                self.riding_elapsed_ms = self
                    .riding_elapsed_ms
                    .checked_add(delta)
                    .ok_or(WriterError::InvalidInput)?;
            }
            if let (Some(previous), Some(current)) = (self.last_speed_kph, sample.speed_kph) {
                distance += (previous.abs() + current.abs()) * 0.5 * delta as f64 / 3_600.0;
            }
        }
        if !distance.is_finite() {
            return Err(WriterError::InvalidInput);
        }
        self.distance_m = Some(distance);
        if let Some(value) = sample.speed_kph.map(f64::abs)
            && self.maximum_speed_kph.is_none_or(|maximum| value > maximum)
        {
            self.maximum_speed_kph = Some(value);
            self.maximum_speed_source_sequence = Some(sample.sequence);
        }
        if let Some(value) = sample.duty_cycle.map(f64::abs)
            && self
                .maximum_duty_cycle
                .is_none_or(|maximum| value > maximum)
        {
            self.maximum_duty_cycle = Some(value);
            self.maximum_duty_source_sequence = Some(sample.sequence);
        }
        self.sample_count = self
            .sample_count
            .checked_add(1)
            .ok_or(WriterError::InvalidInput)?;
        self.elapsed_ms = sample.elapsed_ms;
        self.last_speed_kph = sample.speed_kph;
        self.last_ride_state = Some(ride_state(sample.ride_state).into());
        Ok(())
    }
}

fn aggregate_samples(transaction: &Transaction<'_>) -> Result<Aggregate, WriterError> {
    let mut statement = transaction
        .prepare("SELECT sequence, monotonic_elapsed_ms, ride_state, speed_kph, duty_cycle, EXISTS(SELECT 1 FROM session_event e WHERE e.kind='recordingBoundary' AND e.source_sample_sequence=sample.sequence) FROM sample ORDER BY monotonic_elapsed_ms, sequence")
        .map_err(map_sqlite)?;
    let mut rows = statement.query([]).map_err(map_sqlite)?;
    let mut sample_count = 0_u64;
    let mut previous_elapsed = None;
    let mut previous_speed: Option<f64> = None;
    let mut riding_elapsed_ms = 0_u64;
    let mut distance_m = 0.0;
    let mut maximum_speed: Option<(f64, u64)> = None;
    let mut maximum_duty: Option<(f64, u64)> = None;
    let mut last_speed = None;
    let mut last_state = None;
    let mut elapsed_ms = 0_u64;
    while let Some(row) = rows.next().map_err(map_sqlite)? {
        let sequence = nonnegative(row.get(0).map_err(map_sqlite)?).map_err(map_sqlite)?;
        let elapsed = nonnegative(row.get(1).map_err(map_sqlite)?).map_err(map_sqlite)?;
        let state: String = row.get(2).map_err(map_sqlite)?;
        let speed: Option<f64> = row.get(3).map_err(map_sqlite)?;
        let duty: Option<f64> = row.get(4).map_err(map_sqlite)?;
        if speed.is_some_and(|value| !value.is_finite())
            || duty.is_some_and(|value| !value.is_finite())
        {
            return Err(WriterError::Incompatible);
        }
        let gap: bool = row.get(5).map_err(map_sqlite)?;
        if let Some(previous) = previous_elapsed.filter(|_| !gap) {
            let delta = elapsed.saturating_sub(previous);
            if state == "riding" {
                riding_elapsed_ms = riding_elapsed_ms
                    .checked_add(delta)
                    .ok_or(WriterError::InvalidInput)?;
            }
            if let (Some(prior_speed), Some(current_speed)) = (previous_speed, speed) {
                distance_m +=
                    (prior_speed.abs() + current_speed.abs()) * 0.5 * delta as f64 / 3_600.0;
            }
        }
        if let Some(speed) = speed {
            let absolute = speed.abs();
            if maximum_speed.is_none_or(|(maximum, _)| absolute > maximum) {
                maximum_speed = Some((absolute, sequence));
            }
        }
        if let Some(duty) = duty {
            let absolute = duty.abs();
            if maximum_duty.is_none_or(|(maximum, _)| absolute > maximum) {
                maximum_duty = Some((absolute, sequence));
            }
        }
        sample_count = sample_count
            .checked_add(1)
            .ok_or(WriterError::InvalidInput)?;
        previous_elapsed = Some(elapsed);
        previous_speed = speed;
        elapsed_ms = elapsed;
        last_speed = speed;
        last_state = Some(state);
    }
    if !distance_m.is_finite() {
        return Err(WriterError::InvalidInput);
    }
    let (event_count, event_sequence): (i64, i64) = transaction
        .query_row(
            "SELECT COUNT(*), COALESCE(MAX(sequence), 0) FROM session_event",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(map_sqlite)?;
    Ok(Aggregate {
        sample_count,
        event_count: u64::try_from(event_count).map_err(|_| WriterError::Incompatible)?,
        event_sequence: u64::try_from(event_sequence).map_err(|_| WriterError::Incompatible)?,
        elapsed_ms,
        riding_elapsed_ms,
        distance_m: (sample_count > 0).then_some(distance_m),
        maximum_speed_kph: maximum_speed.map(|value| value.0),
        maximum_speed_source_sequence: maximum_speed.map(|value| value.1),
        maximum_duty_cycle: maximum_duty.map(|value| value.0),
        maximum_duty_source_sequence: maximum_duty.map(|value| value.1),
        last_speed_kph: last_speed,
        last_ride_state: last_state,
    })
}

fn numeric_values(sample: &NormalizedSample) -> [(&'static str, Option<f64>); 38] {
    [
        ("packVoltageV", sample.pack_voltage_v),
        ("dutyCycle", sample.duty_cycle),
        ("controllerTempC", sample.controller_temp_c),
        ("motorTempC", sample.motor_temp_c),
        ("bmsCircuitryTempC", sample.bms_circuitry_temp_c),
        ("bmsHighestCellTempC", sample.bms_highest_cell_temp_c),
        ("motorCurrentA", sample.motor_current_a),
        ("batteryCurrentA", sample.battery_current_a),
        ("erpm", sample.erpm),
        ("speedKph", sample.speed_kph),
        ("pitchDeg", sample.pitch_deg),
        ("balancePitchDeg", sample.balance_pitch_deg),
        ("rollDeg", sample.roll_deg),
        (
            "directionalMotorCurrentA",
            sample.directional_motor_current_a,
        ),
        ("filteredMotorCurrentA", sample.filtered_motor_current_a),
        (
            "requestedBalanceCurrentA",
            sample.requested_balance_current_a,
        ),
        ("boosterCurrentA", sample.booster_current_a),
        ("fieldWeakeningCurrentA", sample.field_weakening_current_a),
        ("footpadAdc1V", sample.footpad_adc1_v),
        ("footpadAdc2V", sample.footpad_adc2_v),
        ("remoteInput", sample.remote_input),
        ("setpointDeg", sample.setpoint_deg),
        ("atrSetpointDeg", sample.atr_setpoint_deg),
        ("brakeTiltSetpointDeg", sample.brake_tilt_setpoint_deg),
        ("torqueTiltSetpointDeg", sample.torque_tilt_setpoint_deg),
        ("turnTiltSetpointDeg", sample.turn_tilt_setpoint_deg),
        ("remoteSetpointDeg", sample.remote_setpoint_deg),
        (
            "atrAccelerationDifferenceErpmPerSecond",
            sample.atr_acceleration_difference_erpm_per_second,
        ),
        ("atrSpeedBoost", sample.atr_speed_boost),
        ("distanceM", sample.distance_m),
        ("odometerM", sample.odometer_m),
        ("ampHoursDrawnAh", sample.amp_hours_drawn_ah),
        ("ampHoursChargedAh", sample.amp_hours_charged_ah),
        ("wattHoursDrawnWh", sample.watt_hours_drawn_wh),
        ("wattHoursChargedWh", sample.watt_hours_charged_wh),
        ("batteryLevel", sample.battery_level),
        ("chargingCurrentA", sample.charging_current_a),
        ("chargingVoltageV", sample.charging_voltage_v),
    ]
}

fn transition_values(sample: &NormalizedSample) -> Vec<(&'static str, String)> {
    let mut values = Vec::with_capacity(10);
    if let Some(value) = sample.package_state {
        values.push(("packageState", package_state(value).to_owned()));
    }
    if let Some(value) = sample.package_mode {
        values.push(("packageMode", package_mode(value).to_owned()));
    }
    if let Some(value) = sample.footpad_state {
        values.push(("footpadState", footpad_state(value).to_owned()));
    }
    if let Some(value) = sample.stop_condition {
        values.push(("stopCondition", stop_condition(value).to_owned()));
    }
    if let Some(value) = sample.setpoint_adjustment {
        values.push(("setpointAdjustment", setpoint_adjustment(value).to_owned()));
    }
    if let Some(value) = sample.wheelslip {
        values.push(("wheelslip", boolean_transition(value).to_owned()));
    }
    if let Some(value) = sample.darkride {
        values.push(("darkride", boolean_transition(value).to_owned()));
    }
    if let Some(value) = sample.charging {
        values.push(("charging", boolean_transition(value).to_owned()));
    }
    values.push((
        "alertReason",
        sample
            .alert_reason
            .map(alert_reason)
            .unwrap_or("none")
            .to_owned(),
    ));
    values.push((
        "firmwareFault",
        sample
            .firmware_fault
            .map(firmware_fault)
            .unwrap_or("none")
            .to_owned(),
    ));
    if let Some(latched) = sample.fatal_error_latched {
        values.push(("fatalErrorLatched", boolean_transition(latched).to_owned()));
    }
    values
}

fn boolean_transition(value: bool) -> &'static str {
    if value { "active" } else { "cleared" }
}

fn ride_state(value: RideState) -> &'static str {
    match value {
        RideState::Idle => "idle",
        RideState::Riding => "riding",
        RideState::Unknown => "unknown",
    }
}

fn package_state(value: PackageState) -> &'static str {
    match value {
        PackageState::Disabled => "disabled",
        PackageState::Startup => "startup",
        PackageState::Ready => "ready",
        PackageState::Running => "running",
        PackageState::Unknown => "unknown",
    }
}

fn package_mode(value: PackageMode) -> &'static str {
    match value {
        PackageMode::Normal => "normal",
        PackageMode::HandTest => "handTest",
        PackageMode::Flywheel => "flywheel",
        PackageMode::Unknown => "unknown",
    }
}

fn footpad_state(value: FootpadState) -> &'static str {
    match value {
        FootpadState::None => "none",
        FootpadState::Left => "left",
        FootpadState::Right => "right",
        FootpadState::Both => "both",
        FootpadState::Unknown => "unknown",
    }
}

fn stop_condition(value: StopCondition) -> &'static str {
    match value {
        StopCondition::None => "none",
        StopCondition::Pitch => "pitch",
        StopCondition::Roll => "roll",
        StopCondition::SwitchHalf => "switchHalf",
        StopCondition::SwitchFull => "switchFull",
        StopCondition::ReverseStop => "reverseStop",
        StopCondition::QuickStop => "quickStop",
        StopCondition::Unknown => "unknown",
        StopCondition::ImuTimeout => "imuTimeout",
    }
}

fn setpoint_adjustment(value: SetpointAdjustment) -> &'static str {
    match value {
        SetpointAdjustment::None => "none",
        SetpointAdjustment::Centering => "centering",
        SetpointAdjustment::ReverseStop => "reverseStop",
        SetpointAdjustment::Speed => "speed",
        SetpointAdjustment::Duty => "duty",
        SetpointAdjustment::Error => "error",
        SetpointAdjustment::HighVoltage => "highVoltage",
        SetpointAdjustment::LowVoltage => "lowVoltage",
        SetpointAdjustment::Temperature => "temperature",
        SetpointAdjustment::Unknown => "unknown",
    }
}

fn alert_reason(value: AlertReason) -> &'static str {
    match value {
        AlertReason::None => "none",
        AlertReason::LowVoltage => "lowVoltage",
        AlertReason::HighVoltage => "highVoltage",
        AlertReason::ControllerTemperature => "controllerTemperature",
        AlertReason::MotorTemperature => "motorTemperature",
        AlertReason::Current => "current",
        AlertReason::Duty => "duty",
        AlertReason::Sensors => "sensors",
        AlertReason::LowBattery => "lowBattery",
        AlertReason::Idle => "idle",
        AlertReason::Error => "error",
        AlertReason::Speed => "speed",
        AlertReason::CellUnderTemperature => "cellUnderTemperature",
        AlertReason::CellOverTemperature => "cellOverTemperature",
        AlertReason::CellLowVoltage => "cellLowVoltage",
        AlertReason::CellHighVoltage => "cellHighVoltage",
        AlertReason::CellImbalance => "cellImbalance",
        AlertReason::BmsConnection => "bmsConnection",
        AlertReason::BmsOverTemperature => "bmsOverTemperature",
        AlertReason::FirmwareFault => "firmwareFault",
        AlertReason::Unknown => "unknown",
    }
}

fn firmware_fault(value: FirmwareFault) -> &'static str {
    match value {
        FirmwareFault::OverVoltage => "overVoltage",
        FirmwareFault::UnderVoltage => "underVoltage",
        FirmwareFault::Driver => "driver",
        FirmwareFault::AbsoluteOverCurrent => "absoluteOverCurrent",
        FirmwareFault::ControllerOverTemperature => "controllerOverTemperature",
        FirmwareFault::MotorOverTemperature => "motorOverTemperature",
        FirmwareFault::GateDriverOverVoltage => "gateDriverOverVoltage",
        FirmwareFault::GateDriverUnderVoltage => "gateDriverUnderVoltage",
        FirmwareFault::McuUnderVoltage => "mcuUnderVoltage",
        FirmwareFault::WatchdogReset => "watchdogReset",
        FirmwareFault::EncoderSpi => "encoderSpi",
        FirmwareFault::EncoderSinCosBelowMinimum => "encoderSinCosBelowMinimum",
        FirmwareFault::EncoderSinCosAboveMaximum => "encoderSinCosAboveMaximum",
        FirmwareFault::FlashCorruption => "flashCorruption",
        FirmwareFault::CurrentSensorOffset1 => "currentSensorOffset1",
        FirmwareFault::CurrentSensorOffset2 => "currentSensorOffset2",
        FirmwareFault::CurrentSensorOffset3 => "currentSensorOffset3",
        FirmwareFault::UnbalancedCurrents => "unbalancedCurrents",
        FirmwareFault::Brake => "brake",
        FirmwareFault::ResolverLossOfTracking => "resolverLossOfTracking",
        FirmwareFault::ResolverDegradationOfSignal => "resolverDegradationOfSignal",
        FirmwareFault::ResolverLossOfSignal => "resolverLossOfSignal",
        FirmwareFault::AppConfigFlashCorruption => "appConfigFlashCorruption",
        FirmwareFault::MotorConfigFlashCorruption => "motorConfigFlashCorruption",
        FirmwareFault::EncoderNoMagnet => "encoderNoMagnet",
        FirmwareFault::EncoderMagnetTooStrong => "encoderMagnetTooStrong",
        FirmwareFault::PhaseFilter => "phaseFilter",
        FirmwareFault::Unknown => "unknown",
    }
}

struct TemporaryDatabase {
    path: PathBuf,
    armed: std::cell::Cell<bool>,
}

impl TemporaryDatabase {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            armed: std::cell::Cell::new(true),
        }
    }

    fn disarm(&self) {
        self.armed.set(false);
    }
}

impl Drop for TemporaryDatabase {
    fn drop(&mut self) {
        if !self.armed.get() {
            return;
        }
        remove_if_present(&self.path);
        let mut wal = self.path.as_os_str().to_os_string();
        wal.push("-wal");
        remove_if_present(Path::new(&wal));
        let mut shm = self.path.as_os_str().to_os_string();
        shm.push("-shm");
        remove_if_present(Path::new(&shm));
    }
}

fn remove_if_present(path: &Path) {
    let _ = fs::remove_file(path);
}

fn open_write(path: &Path, create: bool) -> Result<Connection, WriterError> {
    let mut flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    if create {
        flags |= OpenFlags::SQLITE_OPEN_CREATE;
    }
    let connection = Connection::open_with_flags(path, flags).map_err(map_open_sqlite)?;
    connection
        .busy_timeout(Duration::from_secs(1))
        .map_err(map_sqlite)?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(map_sqlite)?;
    Ok(connection)
}

fn validate_database(connection: &Connection) -> Result<(), WriterError> {
    let quick_check: String = connection
        .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
        .map_err(map_validation_sqlite)?;
    if quick_check != "ok" {
        return Err(WriterError::Corrupt);
    }
    let user_version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(map_validation_sqlite)?;
    let journal_mode: String = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .map_err(map_validation_sqlite)?;
    let synchronous: i64 = connection
        .query_row("PRAGMA synchronous", [], |row| row.get(0))
        .map_err(map_validation_sqlite)?;
    if user_version != 0 || journal_mode != "wal" || synchronous != 2 {
        return Err(WriterError::Incompatible);
    }

    let mut statement = connection
        .prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_autoindex_%'")
        .map_err(map_validation_sqlite)?;
    let objects = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(map_validation_sqlite)?
        .collect::<Result<BTreeSet<_>, _>>()
        .map_err(map_validation_sqlite)?;
    let expected = [
        ("index", "location_elapsed"),
        ("index", "sample_elapsed"),
        ("index", "session_event_elapsed"),
        ("index", "session_event_source_sample"),
        ("index", "session_ride_markers"),
        ("table", "commit_marker"),
        ("table", "location"),
        ("table", "riding_interval"),
        ("table", "sample"),
        ("table", "session_event"),
        ("table", "session_diagnostic"),
        ("table", "session_metadata"),
        ("table", "session_numeric_field"),
        ("table", "sqlite_sequence"),
    ]
    .into_iter()
    .map(|(kind, name)| (kind.to_owned(), name.to_owned()))
    .collect::<BTreeSet<_>>();
    if objects != expected {
        return Err(WriterError::Incompatible);
    }
    diagnostics::validate_diagnostics(connection)?;

    let metadata = connection
        .query_row(
            "SELECT expected_riding_persistence_ms, expected_idle_persistence_ms FROM session_metadata WHERE singleton = 1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(map_validation_sqlite)?;
    let metadata_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM session_metadata", [], |row| {
            row.get(0)
        })
        .map_err(map_validation_sqlite)?;
    let marker_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM commit_marker WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .map_err(map_validation_sqlite)?;
    if metadata_count != 1
        || marker_count != 1
        || !matches!(metadata, Some((riding, idle)) if riding > 0 && idle > 0 && riding <= MAX_PERSISTENCE_CADENCE_MS as i64 && idle <= MAX_PERSISTENCE_CADENCE_MS as i64)
    {
        return Err(WriterError::Incompatible);
    }
    let boundary = read_marker(connection).map_err(|_| WriterError::Incompatible)?;
    connection_context::read_contexts(connection, boundary.committed_event_sequence)?;
    Ok(())
}

fn read_marker(connection: &Connection) -> Result<CommitMarker, WriterError> {
    connection
        .query_row(
            "SELECT committed_sample_sequence, committed_event_sequence, recorded_sample_count, stored_sample_count, committed_event_count, committed_elapsed_ms, history_revision, committed_at_ms, riding_elapsed_ms, distance_m, maximum_speed_kph, maximum_speed_source_sequence, maximum_duty_cycle, maximum_duty_source_sequence, last_speed_kph, last_ride_state, committed_location_sequence, committed_location_elapsed_ms, recorded_location_count, stored_location_count, last_location_status FROM commit_marker WHERE singleton = 1",
            [],
            |row| {
                Ok(CommitMarker {
                    committed_sample_sequence: nonnegative(row.get(0)?)?,
                    committed_event_sequence: nonnegative(row.get(1)?)?,
                    recorded_sample_count: nonnegative(row.get(2)?)?,
                    stored_sample_count: nonnegative(row.get(3)?)?,
                    committed_event_count: nonnegative(row.get(4)?)?,
                    committed_elapsed_ms: nonnegative(row.get(5)?)?,
                    history_revision: nonnegative(row.get(6)?)?,
                    committed_at_epoch_ms: row.get(7)?,
                    riding_elapsed_ms: nonnegative(row.get(8)?)?,
                    distance_m: finite_optional(row.get(9)?)?,
                    maximum_speed_kph: finite_optional(row.get(10)?)?,
                    maximum_speed_source_sequence: optional_nonnegative(row.get(11)?)?,
                    maximum_duty_cycle: finite_optional(row.get(12)?)?,
                    maximum_duty_source_sequence: optional_nonnegative(row.get(13)?)?,
                    last_speed_kph: finite_optional(row.get(14)?)?,
                    last_ride_state: row.get(15)?,
                    committed_location_sequence: nonnegative(row.get(16)?)?,
                    committed_location_elapsed_ms: nonnegative(row.get(17)?)?,
                    recorded_location_count: nonnegative(row.get(18)?)?,
                    stored_location_count: nonnegative(row.get(19)?)?,
                    last_location_status: row.get(20)?,
                })
            },
        )
        .map_err(map_sqlite)
}

fn nonnegative(value: i64) -> rusqlite::Result<u64> {
    u64::try_from(value).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(0, value))
}

fn optional_nonnegative(value: Option<i64>) -> rusqlite::Result<Option<u64>> {
    value.map(nonnegative).transpose()
}

fn finite_optional(value: Option<f64>) -> rusqlite::Result<Option<f64>> {
    if value.is_some_and(|number| !number.is_finite()) {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(value)
}

fn sqlite_integer(value: u64) -> Result<i64, WriterError> {
    i64::try_from(value).map_err(|_| WriterError::InvalidInput)
}

fn map_open_sqlite(error: rusqlite::Error) -> WriterError {
    match error.sqlite_error_code() {
        Some(ErrorCode::CannotOpen | ErrorCode::PermissionDenied) => WriterError::Io,
        _ => map_sqlite(error),
    }
}

fn map_validation_sqlite(error: rusqlite::Error) -> WriterError {
    match error.sqlite_error_code() {
        Some(ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase) => WriterError::Corrupt,
        _ => map_sqlite(error),
    }
}

fn map_sqlite(error: rusqlite::Error) -> WriterError {
    match error.sqlite_error_code() {
        Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => WriterError::Busy,
        Some(ErrorCode::DiskFull) => WriterError::Full,
        Some(ErrorCode::SystemIoFailure | ErrorCode::CannotOpen | ErrorCode::PermissionDenied) => {
            WriterError::Io
        }
        Some(ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase) => WriterError::Corrupt,
        _ => WriterError::Database,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_failures_have_closed_payload_free_mappings() {
        fn failure(code: i32) -> rusqlite::Error {
            rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(code),
                Some("secret".to_owned()),
            )
        }

        assert_eq!(
            map_sqlite(failure(rusqlite::ffi::SQLITE_BUSY)),
            WriterError::Busy
        );
        assert_eq!(
            map_sqlite(failure(rusqlite::ffi::SQLITE_FULL)),
            WriterError::Full
        );
        assert_eq!(
            map_sqlite(failure(rusqlite::ffi::SQLITE_IOERR)),
            WriterError::Io
        );
        assert_eq!(
            map_sqlite(failure(rusqlite::ffi::SQLITE_CORRUPT)),
            WriterError::Corrupt
        );
        assert_eq!(format!("{:?}", WriterError::Database), "Database");
        assert_eq!(
            format!(
                "{:?}",
                CommitMarker {
                    committed_sample_sequence: 1,
                    committed_event_sequence: 2,
                    recorded_sample_count: 3,
                    stored_sample_count: 4,
                    committed_event_count: 5,
                    committed_elapsed_ms: 6,
                    history_revision: 7,
                    committed_at_epoch_ms: 8,
                    riding_elapsed_ms: 9,
                    distance_m: Some(10.0),
                    maximum_speed_kph: Some(11.0),
                    maximum_speed_source_sequence: Some(12),
                    maximum_duty_cycle: Some(13.0),
                    maximum_duty_source_sequence: Some(14),
                    last_speed_kph: Some(15.0),
                    last_ride_state: Some("secret".to_owned()),
                    committed_location_sequence: 16,
                    committed_location_elapsed_ms: 17,
                    recorded_location_count: 18,
                    stored_location_count: 19,
                    last_location_status: "secret".to_owned(),
                }
            ),
            "CommitMarker([redacted])"
        );
        assert_eq!(
            format!(
                "{:?}",
                LocationObservation {
                    observed_at_epoch_ms: 1,
                    elapsed_ms: 2,
                    latitude: 3.0,
                    longitude: 4.0,
                    accuracy_m: Some(5.0),
                    altitude_m: None,
                }
            ),
            "LocationObservation([redacted])"
        );
    }
}

#[cfg(test)]
mod append_regressions {
    use super::*;
    #[allow(dead_code)]
    mod support {
        include!("../tests/support/mod.rs");
    }
    use support::{TestDirectory, sample};

    fn writer(directory: &TestDirectory) -> SessionWriter {
        SessionWriter::create(
            directory.file("ride.sqlite3"),
            SessionMetadata {
                expected_riding_persistence_ms: 100,
                expected_idle_persistence_ms: 1000,
                committed_at_epoch_ms: 1_000_000,
            },
        )
        .unwrap()
    }

    fn assert_aggregates(writer: &mut SessionWriter) {
        let marker = writer.marker().unwrap();
        let tx = writer.connection.transaction().unwrap();
        let expected = aggregate_samples(&tx).unwrap();
        assert_eq!(marker.stored_sample_count, expected.sample_count);
        assert_eq!(marker.committed_event_count, expected.event_count);
        assert_eq!(marker.committed_event_sequence, expected.event_sequence);
        assert_eq!(marker.riding_elapsed_ms, expected.riding_elapsed_ms);
        assert_eq!(marker.distance_m, expected.distance_m);
        assert_eq!(marker.maximum_speed_kph, expected.maximum_speed_kph);
        assert_eq!(
            marker.maximum_speed_source_sequence,
            expected.maximum_speed_source_sequence
        );
        assert_eq!(marker.maximum_duty_cycle, expected.maximum_duty_cycle);
        assert_eq!(
            marker.maximum_duty_source_sequence,
            expected.maximum_duty_source_sequence
        );
        assert_eq!(marker.last_speed_kph, expected.last_speed_kph);
        assert_eq!(marker.last_ride_state, expected.last_ride_state);
    }

    #[test]
    fn failed_checkpoint_still_closes_the_writer_and_preserves_committed_rows() {
        let directory = TestDirectory::new();
        let mut writer = writer(&directory);
        writer.append_samples(&[sample(1, 0)]).unwrap();
        let committed = writer.marker().unwrap();
        // SQLite rejects checkpointing while this connection has a transaction.
        writer.connection.execute_batch("BEGIN IMMEDIATE").unwrap();
        assert_eq!(
            writer.checkpoint_and_close().unwrap_err(),
            WriterError::Busy
        );
        let path = directory.file("ride.sqlite3");
        let reopened = SessionWriter::open(&path).unwrap();
        assert_eq!(reopened.marker().unwrap(), committed);
        let db = Connection::open(path).unwrap();
        db.execute_batch("BEGIN IMMEDIATE; ROLLBACK;").unwrap();
    }

    #[test]
    fn incremental_totals_match_full_reduction_across_replay_reopen_and_late_insert() {
        let directory = TestDirectory::new();
        let mut w = writer(&directory);
        for n in 1..=40 {
            let mut s = sample(n, n * 100);
            s.ride_state = if n % 3 == 0 {
                RideState::Idle
            } else {
                RideState::Riding
            };
            s.speed_kph = (n % 5 != 0).then_some(if n % 2 == 0 { -18. } else { 36. });
            s.duty_cycle = (n % 7 != 0).then_some(-0.5);
            w.append_samples(&[s.clone()]).unwrap();
            w.append_samples(&[s]).unwrap();
            assert_aggregates(&mut w);
            if n == 20 {
                w.append_ride_marker(
                    "00000000-0000-4000-8000-000000000001",
                    2050,
                    1_002_050,
                    false,
                )
                .unwrap();
                w.close().unwrap();
                w = SessionWriter::open(directory.file("ride.sqlite3")).unwrap();
            }
        }
        // Accepted late inserts need the full reduction; subsequent appends do not.
        let mut late = sample(41, 250);
        late.speed_kph = Some(72.);
        w.append_samples(&[late]).unwrap();
        assert_aggregates(&mut w);
        w.append_samples(&[sample(42, 4100), sample(43, 4100)])
            .unwrap();
        assert_aggregates(&mut w);
    }

    #[test]
    fn append_database_work_does_not_grow_with_ride_length() {
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };
        let mut costs = Vec::new();
        for count in [100, 10_605] {
            let directory = TestDirectory::new();
            let mut w = writer(&directory);
            for start in (1..=count).step_by(100) {
                let rows: Vec<_> = (start..=(start + 99).min(count))
                    .map(|n| sample(n, n * 100))
                    .collect();
                w.append_samples(&rows).unwrap();
            }
            let steps = Arc::new(AtomicUsize::new(0));
            let observer = steps.clone();
            w.connection.progress_handler(
                1,
                Some(move || {
                    observer.fetch_add(1, Ordering::Relaxed);
                    false
                }),
            );
            let start = std::time::Instant::now();
            for n in count + 1..=count + 50 {
                w.append_samples(&[sample(n, n * 100)]).unwrap();
            }
            eprintln!(
                "{count} rows: {:.2} ms/append",
                start.elapsed().as_secs_f64() * 1000. / 50.
            );
            costs.push(steps.load(Ordering::Relaxed));
        }
        assert!(
            costs[1] < costs[0] * 2,
            "append SQL work grew with ride length: {costs:?}"
        );
    }
}
