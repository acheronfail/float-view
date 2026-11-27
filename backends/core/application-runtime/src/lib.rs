//! Safe coarse application composition for future native host cutovers.
//!
//! The runtime owns portable VESC stream, connection/application, and one
//! canonical session-writer lifetime. Hosts still own OS services and execute
//! the ordered effects returned here. No callback or host reference crosses
//! this boundary.

#![forbid(unsafe_code)]

use std::fmt::{self, Debug, Formatter};
use std::path::{Component, Path, PathBuf};
#[cfg(test)]
use std::sync::atomic::{AtomicU64, Ordering};

pub mod load;

pub use float_view_connection_application_coordinator as coordinator;
pub use float_view_refloat_telemetry_service as telemetry;
pub use float_view_session_history_kernel as history;
pub use float_view_session_sqlite as session;

use coordinator::{ConnectionApplicationCoordinator, Effect as CoordinatorEffect};
use float_view_vesc_frame::{FrameError, MAX_STREAM_BYTES, StreamDecoder, encode};
use session::{CommitMarker, LocationObservation, SessionMetadata, SessionWriter, WriterError};

pub const MAX_RUNTIME_EFFECTS: usize = coordinator::MAX_TRANSITION_EFFECTS * 2;
pub const MAX_SESSION_PATH_BYTES: usize = 4_096;
const BMS_PERSISTENCE_MAX_AGE_MS: i64 = 5_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionMode {
    Create,
    Open,
}

pub enum Command {
    Application(coordinator::Command),
    ReceiveBytes {
        generation: coordinator::Generation,
        bytes: Vec<u8>,
        now_ms: u64,
        observed_at_epoch_ms: i64,
    },
    AttachSession {
        path: PathBuf,
        mode: SessionMode,
        metadata: SessionMetadata,
    },
    AppendLocations(Vec<LocationObservation>),
    ProfileChanged {
        saved_device_id: String,
        revision: u64,
        values_json: String,
        at_ms: i64,
    },
    DetachSession,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Effect {
    WriteBytes(Vec<u8>),
    Application(CoordinatorEffect),
    PublishSessionMarker(CommitMarker),
    Failure(RuntimeFailure),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuntimeFailure {
    Persistence(WriterError),
}

#[derive(Clone, Debug, PartialEq)]
pub enum RuntimeError {
    Coordinator(coordinator::CoordinatorError),
    Framing(FrameError),
    InvalidSessionPath,
    SessionAlreadyAttached,
    SessionNotAttached,
    Persistence(WriterError),
    EffectLimit,
}

impl From<coordinator::CoordinatorError> for RuntimeError {
    fn from(value: coordinator::CoordinatorError) -> Self {
        Self::Coordinator(value)
    }
}

impl From<FrameError> for RuntimeError {
    fn from(value: FrameError) -> Self {
        Self::Framing(value)
    }
}

impl From<WriterError> for RuntimeError {
    fn from(value: WriterError) -> Self {
        Self::Persistence(value)
    }
}

#[derive(Clone, PartialEq)]
pub struct Snapshot {
    pub application: coordinator::Snapshot,
    pub session_attached: bool,
    pub session_marker: Option<CommitMarker>,
}

impl Debug for Snapshot {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Snapshot")
            .field("generation", &self.application.generation)
            .field("phase", &self.application.phase)
            .field("session_attached", &self.session_attached)
            .field("has_session_marker", &self.session_marker.is_some())
            .finish()
    }
}

pub struct ApplicationRuntime {
    persistence_us: Vec<u64>,
    application: ConnectionApplicationCoordinator,
    stream: StreamDecoder,
    session: Option<SessionWriter>,
    session_marker: Option<CommitMarker>,
    latest_bms: Option<coordinator::bms::BmsObservation>,
}

impl Default for ApplicationRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl Debug for ApplicationRuntime {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ApplicationRuntime")
            .field("snapshot", &self.snapshot())
            .finish()
    }
}

impl ApplicationRuntime {
    pub fn take_request_timings(&mut self) -> Vec<coordinator::RequestTiming> {
        self.application.take_request_timings()
    }
    pub fn take_persistence_timings(&mut self) -> Vec<u64> {
        std::mem::take(&mut self.persistence_us)
    }

    #[must_use]
    pub fn new() -> Self {
        Self {
            persistence_us: Vec::new(),
            application: ConnectionApplicationCoordinator::default(),
            stream: StreamDecoder::new(),
            session: None,
            session_marker: None,
            latest_bms: None,
        }
    }

    #[must_use]
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            application: self.application.snapshot(),
            session_attached: self.session.is_some(),
            session_marker: self.session_marker.clone(),
        }
    }

    #[must_use]
    pub fn configuration_schema(
        &self,
    ) -> Option<&coordinator::configuration_codec::ConfigurationSchema> {
        self.application.configuration_schema()
    }

    pub fn configuration_mutation_block_reason(
        &self,
        mutation: coordinator::mutation::ConfigurationMutation,
        now_ms: u64,
    ) -> Option<coordinator::ConfigurationWriteBlockReason> {
        self.application
            .configuration_mutation_block_reason(mutation, now_ms)
    }

    pub fn apply(&mut self, command: Command) -> Result<Vec<Effect>, RuntimeError> {
        match command {
            Command::Application(command) => {
                if matches!(
                    command,
                    coordinator::Command::Begin(_) | coordinator::Command::Reset { .. }
                ) {
                    self.stream = StreamDecoder::new();
                    self.latest_bms = None;
                }
                let effects = self.application.apply(command)?;
                self.translate(effects)
            }
            Command::ReceiveBytes {
                generation,
                bytes,
                now_ms,
                observed_at_epoch_ms,
            } => {
                if bytes.len() > MAX_STREAM_BYTES {
                    return Err(RuntimeError::Framing(FrameError::PayloadTooLarge));
                }
                let payloads = self.stream.append(&bytes)?;
                let mut output = Vec::new();
                for payload in payloads {
                    let effects = self.application.apply(coordinator::Command::Receive {
                        generation,
                        payload,
                        now_ms,
                        observed_at_epoch_ms,
                    })?;
                    append_bounded(&mut output, self.translate(effects)?)?;
                }
                Ok(output)
            }
            Command::AttachSession {
                path,
                mode,
                metadata,
            } => self.attach_session(&path, mode, metadata),
            Command::AppendLocations(locations) => self.append_locations(&locations),
            Command::ProfileChanged {
                saved_device_id,
                revision,
                values_json,
                at_ms,
            } => {
                let writer = self
                    .session
                    .as_mut()
                    .ok_or(RuntimeError::SessionNotAttached)?;
                let marker = writer.append_profile_change(
                    &saved_device_id,
                    revision,
                    &values_json,
                    at_ms,
                )?;
                self.session_marker = Some(marker.clone());
                Ok(vec![Effect::PublishSessionMarker(marker)])
            }
            Command::DetachSession => self.detach_session(),
        }
    }

    pub fn save_connection_context(
        &mut self,
        operation_id: &str,
        elapsed_ms: u64,
        at_ms: i64,
        context: session::ConnectionContext,
    ) -> Result<CommitMarker, RuntimeError> {
        let boundary = self
            .session
            .as_mut()
            .ok_or(RuntimeError::SessionNotAttached)?
            .append_connection_context(operation_id, elapsed_ms, at_ms, context)?;
        self.session_marker = Some(boundary.clone());
        Ok(boundary)
    }

    pub fn save_ride_marker(
        &mut self,
        operation_id: &str,
        elapsed_ms: u64,
        at_ms: i64,
        capture_location: bool,
    ) -> Result<(session::RideMarker, CommitMarker), RuntimeError> {
        let (marker, boundary) = self
            .session
            .as_mut()
            .ok_or(RuntimeError::SessionNotAttached)?
            .append_ride_marker(operation_id, elapsed_ms, at_ms, capture_location)?;
        self.session_marker = Some(boundary.clone());
        Ok((marker, boundary))
    }

    pub fn open_reader(
        path: impl AsRef<Path>,
    ) -> Result<session::SessionReader, session::ReaderError> {
        session::SessionReader::open(path)
    }

    pub fn open_pruner(
        path: impl AsRef<Path>,
    ) -> Result<session::SessionPruner, session::PruneError> {
        session::SessionPruner::open(path)
    }

    fn attach_session(
        &mut self,
        path: &Path,
        mode: SessionMode,
        metadata: SessionMetadata,
    ) -> Result<Vec<Effect>, RuntimeError> {
        if self.session.is_some() {
            return Err(RuntimeError::SessionAlreadyAttached);
        }
        validate_path(path)?;
        let writer = match mode {
            SessionMode::Create => SessionWriter::create(path, metadata),
            SessionMode::Open => SessionWriter::open(path),
        }?;
        let marker = writer.marker()?;
        self.session = Some(writer);
        self.session_marker = Some(marker.clone());
        Ok(vec![Effect::PublishSessionMarker(marker)])
    }

    fn append_locations(
        &mut self,
        locations: &[LocationObservation],
    ) -> Result<Vec<Effect>, RuntimeError> {
        let Some(writer) = self.session.as_mut() else {
            return Err(RuntimeError::SessionNotAttached);
        };
        match writer.append_locations(locations) {
            Ok(marker) => {
                self.session_marker = Some(marker.clone());
                Ok(vec![Effect::PublishSessionMarker(marker)])
            }
            Err(error) => Ok(vec![Effect::Failure(RuntimeFailure::Persistence(error))]),
        }
    }

    fn detach_session(&mut self) -> Result<Vec<Effect>, RuntimeError> {
        let Some(writer) = self.session.take() else {
            return Err(RuntimeError::SessionNotAttached);
        };
        self.session_marker = None;
        writer.checkpoint_and_close()?;
        Ok(Vec::new())
    }

    /// Commit after the service has consumed this observation and supplied its estimate.
    pub fn clear_recording(&mut self) {
        self.application.clear_recording();
    }

    pub fn mark_recording_gap(&mut self) {
        if let Some(writer) = self.session.as_mut() {
            writer.mark_recording_gap();
        }
    }

    pub fn interrupt_recording(
        &mut self,
        reason: session::InterruptionReason,
        at_ms: i64,
    ) -> Result<CommitMarker, RuntimeError> {
        let marker = self
            .session
            .as_mut()
            .ok_or(RuntimeError::SessionNotAttached)?
            .interrupt_recording(reason, at_ms)?;
        self.session_marker = Some(marker.clone());
        Ok(marker)
    }

    pub fn restore_recording(
        &mut self,
        now_ms: u64,
        elapsed_ms: u64,
        sequence: u64,
        riding_ms: u64,
        distance_m: Option<f64>,
        max_speed_kph: Option<f64>,
    ) {
        self.application.restore_recording(
            now_ms,
            elapsed_ms,
            sequence,
            riding_ms,
            distance_m,
            max_speed_kph,
        );
        self.mark_recording_gap();
    }

    pub fn record_sample(
        &mut self,
        sample: &telemetry::NormalizedSample,
        estimated_battery_level: Option<f64>,
    ) -> Result<Vec<Effect>, RuntimeError> {
        let mut output = Vec::new();
        if let Some(writer) = self.session.as_mut() {
            let started = std::time::Instant::now();
            let mut persisted = persisted_sample(
                sample,
                self.application.snapshot().current_limits.as_ref(),
                self.latest_bms.as_ref().map(|bms| {
                    (
                        bms.observed_at_epoch_ms,
                        bms.highest_circuitry_temperature_c(),
                        bms.highest_cell_temperature_c,
                    )
                }),
            );
            persisted
                .extensions
                .retain(|v| v.name != "estimatedBatteryLevel");
            if let Some(value) = estimated_battery_level {
                persisted.extensions.push(telemetry::ExtensionValue {
                    name: "estimatedBatteryLevel".into(),
                    value,
                });
            }
            let result = writer.append_samples(std::slice::from_ref(&persisted));
            if self.persistence_us.len() < 128 {
                self.persistence_us
                    .push(started.elapsed().as_micros().min(u64::MAX as u128) as u64);
            }
            match result {
                Ok(marker) => {
                    self.session_marker = Some(marker.clone());
                    push_bounded(&mut output, Effect::PublishSessionMarker(marker))?;
                }
                Err(error) => {
                    return Ok(vec![Effect::Failure(RuntimeFailure::Persistence(error))]);
                }
            }
        }
        Ok(output)
    }

    fn translate(&mut self, effects: Vec<CoordinatorEffect>) -> Result<Vec<Effect>, RuntimeError> {
        let mut output = Vec::with_capacity(effects.len());
        for effect in effects {
            match effect {
                CoordinatorEffect::Write(request) => {
                    push_bounded(&mut output, Effect::WriteBytes(encode(&request.payload)?))?;
                }
                CoordinatorEffect::PublishFaultHistory(observation) => {
                    if let Some(writer) = self.session.as_mut() {
                        match writer.append_fault_history(&observation) {
                            Ok(marker) => {
                                self.session_marker = Some(marker.clone());
                                push_bounded(&mut output, Effect::PublishSessionMarker(marker))?;
                            }
                            Err(error) => push_bounded(
                                &mut output,
                                Effect::Failure(RuntimeFailure::Persistence(error)),
                            )?,
                        }
                    }
                }
                CoordinatorEffect::PublishBmsObservation(observation) => {
                    self.latest_bms = Some((*observation).clone());
                    push_bounded(
                        &mut output,
                        Effect::Application(CoordinatorEffect::PublishBmsObservation(observation)),
                    )?;
                }
                other => push_bounded(&mut output, Effect::Application(other))?,
            }
        }
        Ok(output)
    }
}

fn persisted_sample(
    sample: &telemetry::NormalizedSample,
    limits: Option<&coordinator::controller_data::CurrentLimits>,
    bms_temperatures: Option<(i64, f64, f64)>,
) -> telemetry::NormalizedSample {
    let mut persisted = sample.clone();
    // Product-owned fractions use the bounded numeric extension storage. Capture
    // them now: a later connection's limits cannot describe this recorded ride.
    persisted
        .extensions
        .retain(|v| v.name != "motorLoad" && v.name != "batteryLoad");
    let load = load::calculate(sample, limits);
    for (name, value) in [("motorLoad", load.motor), ("batteryLoad", load.battery)] {
        if let Some(value) = value {
            persisted.extensions.push(telemetry::ExtensionValue {
                name: name.into(),
                value,
            });
        }
    }

    if let Some((observed_at_epoch_ms, circuitry_c, highest_cell_c)) = bms_temperatures
        && sample
            .observed_at_epoch_ms
            .checked_sub(observed_at_epoch_ms)
            .is_some_and(|age| (0..BMS_PERSISTENCE_MAX_AGE_MS).contains(&age))
    {
        persisted.bms_circuitry_temp_c = Some(circuitry_c);
        persisted.bms_highest_cell_temp_c = Some(highest_cell_c);
    }
    persisted
}

fn validate_path(path: &Path) -> Result<(), RuntimeError> {
    let bytes = path.as_os_str().as_encoded_bytes();
    if bytes.is_empty()
        || bytes.len() > MAX_SESSION_PATH_BYTES
        || bytes.contains(&0)
        || !path.is_absolute()
        || path.components().any(|part| part == Component::ParentDir)
    {
        Err(RuntimeError::InvalidSessionPath)
    } else {
        Ok(())
    }
}

fn push_bounded(effects: &mut Vec<Effect>, effect: Effect) -> Result<(), RuntimeError> {
    if effects.len() >= MAX_RUNTIME_EFFECTS {
        return Err(RuntimeError::EffectLimit);
    }
    effects.push(effect);
    Ok(())
}

fn append_bounded(target: &mut Vec<Effect>, mut source: Vec<Effect>) -> Result<(), RuntimeError> {
    if target.len().saturating_add(source.len()) > MAX_RUNTIME_EFFECTS {
        return Err(RuntimeError::EffectLimit);
    }
    target.append(&mut source);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use coordinator::discovery::Continuity;
    use telemetry::{
        AlertReason, FootpadState, NormalizedSample, PackageMode, PackageState, RideState,
        SetpointAdjustment, Settings, StopCondition,
    };

    static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn begin(now_ms: u64) -> coordinator::Command {
        coordinator::Command::Begin(coordinator::BeginFacts {
            now_ms,
            settings: Settings::new(1_000, 5_000).expect("settings"),
            preferred_controller_can_id: None,
            routing_hint: None,
            continuity: Continuity::default(),
            preferred_bms_can_id: None,
        })
    }

    fn sample(sequence: u64) -> NormalizedSample {
        NormalizedSample {
            sequence,
            observed_at_epoch_ms: 1_700_000_000_000 + sequence as i64,
            slow_observed_at_epoch_ms: None,
            elapsed_ms: sequence * 100,
            riding_elapsed_ms: 0,
            ride_distance_m: 0.0,
            max_speed_kph: None,
            ride_state: RideState::Idle,
            package_state: Some(PackageState::Ready),
            package_mode: Some(PackageMode::Normal),
            footpad_state: Some(FootpadState::None),
            stop_condition: Some(StopCondition::None),
            setpoint_adjustment: Some(SetpointAdjustment::None),
            wheelslip: Some(false),
            darkride: Some(false),
            charging: Some(false),
            alert_reason: Some(AlertReason::None),
            firmware_fault: None,
            imu_timeout_active: None,
            fatal_error_latched: Some(false),
            last_firmware_fault: None,
            fault_history: Vec::new(),
            imu_timeout_history: Vec::new(),
            pack_voltage_v: Some(80.0),
            duty_cycle: Some(0.0),
            controller_temp_c: Some(20.0),
            motor_temp_c: Some(20.0),
            bms_circuitry_temp_c: None,
            bms_highest_cell_temp_c: None,
            motor_current_a: Some(0.0),
            battery_current_a: Some(0.0),
            erpm: Some(0.0),
            speed_kph: Some(0.0),
            pitch_deg: Some(0.0),
            balance_pitch_deg: Some(0.0),
            roll_deg: Some(0.0),
            directional_motor_current_a: Some(0.0),
            filtered_motor_current_a: Some(0.0),
            requested_balance_current_a: Some(0.0),
            booster_current_a: Some(0.0),
            field_weakening_current_a: Some(0.0),
            footpad_adc1_v: Some(0.0),
            footpad_adc2_v: Some(0.0),
            remote_input: Some(0.0),
            setpoint_deg: Some(0.0),
            atr_setpoint_deg: Some(0.0),
            brake_tilt_setpoint_deg: Some(0.0),
            torque_tilt_setpoint_deg: Some(0.0),
            turn_tilt_setpoint_deg: Some(0.0),
            remote_setpoint_deg: Some(0.0),
            atr_acceleration_difference_erpm_per_second: Some(0.0),
            atr_speed_boost: Some(0.0),
            distance_m: Some(0.0),
            odometer_m: Some(0.0),
            amp_hours_drawn_ah: Some(0.0),
            amp_hours_charged_ah: Some(0.0),
            watt_hours_drawn_wh: Some(0.0),
            watt_hours_charged_wh: Some(0.0),
            battery_level: Some(1.0),
            charging_current_a: Some(0.0),
            charging_voltage_v: Some(0.0),
            extensions: Vec::new(),
        }
    }

    fn session_metadata() -> SessionMetadata {
        SessionMetadata {
            expected_riding_persistence_ms: 100,
            expected_idle_persistence_ms: 1_000,
            committed_at_epoch_ms: 1_700_000_000_000,
        }
    }

    #[test]
    fn retained_ride_reconnects_preserve_samples_clock_and_marker_alignment() {
        let directory = tempfile_directory("reconnect-clock");
        let mut runtime = ApplicationRuntime::new();
        runtime
            .apply(Command::AttachSession {
                path: directory.join("ride.sqlite3"),
                mode: SessionMode::Create,
                metadata: session_metadata(),
            })
            .unwrap();
        for (index, base) in [0, 170_000, 200_000].into_iter().enumerate() {
            let coordinator::Command::Begin(mut facts) = begin(base + 10) else {
                unreachable!()
            };
            facts.continuity = Continuity::new(index > 0, None, None);
            runtime
                .apply(Command::Application(coordinator::Command::Begin(facts)))
                .unwrap();
            let generation = runtime.snapshot().application.generation;
            // Legacy fixtures exercise the same session ownership as selectable telemetry.
            for payload in [firmware_response(), vec![36, 101, 0, 10]] {
                runtime
                    .apply(Command::Application(coordinator::Command::Receive {
                        generation,
                        payload,
                        now_ms: base + 20,
                        observed_at_epoch_ms: 1_700_000_000_000 + base as i64 + 20,
                    }))
                    .unwrap();
            }
            runtime
                .apply(Command::Application(coordinator::Command::Activate {
                    generation,
                    now_ms: base + 40,
                    session_started: index == 0,
                    cached_configuration_schema: None,
                }))
                .unwrap();
            let mut limits = vec![14];
            limits.extend_from_slice(&0x2EFD_0142_u32.to_be_bytes());
            limits.extend_from_slice(&[0; 4]);
            for limit in [100_f32, -100., 50., -20.] {
                limits.extend_from_slice(&limit.to_be_bytes());
            }
            runtime
                .apply(Command::Application(coordinator::Command::Receive {
                    generation,
                    payload: limits,
                    now_ms: base + 45,
                    observed_at_epoch_ms: 1_700_000_000_000 + base as i64 + 45,
                }))
                .unwrap();
            let fixture = include_str!("../../../fixtures/refloat/protocol-1.0.0.json");
            let hex = fixture
                .split_once("legacy-riding-all-data")
                .unwrap()
                .1
                .split_once("\"frameHex\": \"")
                .unwrap()
                .1
                .split('"')
                .next()
                .unwrap();
            let frame = hex
                .as_bytes()
                .chunks_exact(2)
                .map(|bytes| u8::from_str_radix(std::str::from_utf8(bytes).unwrap(), 16).unwrap())
                .collect();
            let effects = runtime
                .apply(Command::ReceiveBytes {
                    generation,
                    bytes: frame,
                    now_ms: base + 70,
                    observed_at_epoch_ms: 1_700_000_000_000 + base as i64 + 70,
                })
                .unwrap();
            let sample = effects
                .iter()
                .find_map(|effect| match effect {
                    Effect::Application(CoordinatorEffect::PublishTelemetry(sample)) => {
                        Some(sample)
                    }
                    _ => None,
                })
                .expect("published telemetry");
            assert_eq!(sample.sequence, index as u64 + 1);
            assert_eq!(sample.elapsed_ms, base + 30);
            runtime.record_sample(sample, None).unwrap();
            let boundary = runtime.snapshot().session_marker.unwrap();
            assert_eq!(boundary.stored_sample_count, index as u64 + 1);
            assert_eq!(boundary.recorded_sample_count, boundary.stored_sample_count);
            let (marker, _) = runtime
                .save_ride_marker(
                    &format!("00000000-0000-4000-8000-{index:012x}"),
                    base + 35,
                    1_700_000_000_000 + base as i64 + 75,
                    false,
                )
                .unwrap();
            assert_eq!(marker.elapsed_ms, sample.elapsed_ms + 5);
        }
        drop(runtime);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn begins_with_one_framed_firmware_request() {
        let mut runtime = ApplicationRuntime::new();
        let effects = runtime
            .apply(Command::Application(begin(10)))
            .expect("begin");
        let frame = effects
            .iter()
            .find_map(|effect| match effect {
                Effect::WriteBytes(bytes) => Some(bytes),
                _ => None,
            })
            .expect("write bytes");
        assert_eq!(float_view_vesc_frame::decode(frame), Ok(vec![0]));
        assert!(!format!("{runtime:?}").contains("payload"));
    }

    #[test]
    fn fragmented_response_is_retained_and_processed_once() {
        let mut runtime = ApplicationRuntime::new();
        runtime
            .apply(Command::Application(begin(10)))
            .expect("begin");
        let generation = runtime.snapshot().application.generation;
        let mut payload = vec![0, 6, 6];
        payload.extend_from_slice(b"THOR300\0");
        payload.extend_from_slice(&[7; 12]);
        payload.extend_from_slice(&[1, 0, 0, 0, 1, 0, 1, 0]);
        payload.extend_from_slice(b"Float\0");
        let frame = float_view_vesc_frame::encode(&payload).expect("frame");
        let split = frame.len() / 2;
        assert!(
            runtime
                .apply(Command::ReceiveBytes {
                    generation,
                    bytes: frame[..split].to_vec(),
                    now_ms: 20,
                    observed_at_epoch_ms: 1_700_000_000_020,
                })
                .expect("fragment")
                .is_empty()
        );
        let effects = runtime
            .apply(Command::ReceiveBytes {
                generation,
                bytes: frame[split..].to_vec(),
                now_ms: 21,
                observed_at_epoch_ms: 1_700_000_000_021,
            })
            .expect("complete");
        assert!(
            effects
                .iter()
                .any(|effect| matches!(effect, Effect::WriteBytes(_)))
        );
    }

    #[test]
    fn noise_and_multiple_frames_are_consumed_in_order() {
        let mut runtime = ApplicationRuntime::new();
        runtime
            .apply(Command::Application(begin(10)))
            .expect("begin");
        let generation = runtime.snapshot().application.generation;
        let mut bytes = vec![0xff, 0x01];
        bytes.extend(float_view_vesc_frame::encode(&firmware_response()).expect("firmware frame"));
        bytes.extend(float_view_vesc_frame::encode(&[36, 101, 0, 10]).expect("legacy info frame"));
        let effects = runtime
            .apply(Command::ReceiveBytes {
                generation,
                bytes,
                now_ms: 20,
                observed_at_epoch_ms: 1_700_000_000_020,
            })
            .expect("two responses");
        assert!(
            effects
                .iter()
                .any(|effect| matches!(effect, Effect::WriteBytes(_)))
        );
        assert!(effects.iter().any(|effect| matches!(
            effect,
            Effect::Application(CoordinatorEffect::PrepareActivation(_))
        )));
    }

    #[test]
    fn malformed_frame_is_consumed_and_the_stream_recovers() {
        let mut runtime = ApplicationRuntime::new();
        runtime
            .apply(Command::Application(begin(10)))
            .expect("begin");
        let generation = runtime.snapshot().application.generation;
        let mut corrupt = float_view_vesc_frame::encode(&firmware_response()).expect("frame");
        corrupt[4] ^= 0xff;
        assert_eq!(
            runtime
                .apply(Command::ReceiveBytes {
                    generation,
                    bytes: corrupt,
                    now_ms: 20,
                    observed_at_epoch_ms: 1_700_000_000_020,
                })
                .expect_err("bad CRC"),
            RuntimeError::Framing(FrameError::InvalidCrc)
        );
        let effects = runtime
            .apply(Command::ReceiveBytes {
                generation,
                bytes: float_view_vesc_frame::encode(&firmware_response()).expect("frame"),
                now_ms: 21,
                observed_at_epoch_ms: 1_700_000_000_021,
            })
            .expect("recovered");
        assert!(
            effects
                .iter()
                .any(|effect| matches!(effect, Effect::WriteBytes(_)))
        );
    }

    #[test]
    fn malformed_input_does_not_lose_valid_discovery_responses_in_the_same_chunk() {
        let mut runtime = ApplicationRuntime::new();
        runtime
            .apply(Command::Application(begin(10)))
            .expect("begin");
        let generation = runtime.snapshot().application.generation;
        let firmware = float_view_vesc_frame::encode(&firmware_response()).unwrap();
        let info = float_view_vesc_frame::encode(&[36, 101, 0, 10]).unwrap();
        let mut corrupt = float_view_vesc_frame::encode(&[36, 101, 20, 3]).unwrap();
        corrupt[4] ^= 0xff;
        let effects = runtime
            .apply(Command::ReceiveBytes {
                generation,
                bytes: [firmware, corrupt, vec![3, 0x0f, 0xfe], info].concat(),
                now_ms: 20,
                observed_at_epoch_ms: 1_700_000_000_020,
            })
            .expect("valid discovery responses survive intervening corruption");
        assert!(effects.iter().any(|effect| matches!(
            effect,
            Effect::Application(CoordinatorEffect::PrepareActivation(_))
        )));
    }

    #[test]
    fn stale_generation_is_diagnostic_only() {
        let mut runtime = ApplicationRuntime::new();
        runtime
            .apply(Command::Application(begin(10)))
            .expect("begin");
        let current = runtime.snapshot().application.generation;
        let stale = coordinator::Generation(current.0.wrapping_sub(1));
        let effects = runtime
            .apply(Command::Application(
                coordinator::Command::SelectController {
                    generation: stale,
                    can_id: 1,
                    now_ms: 20,
                },
            ))
            .expect("stale event");
        assert!(matches!(
            effects.as_slice(),
            [Effect::Application(CoordinatorEffect::Diagnostic(
                coordinator::Diagnostic::StaleEvent
            ))]
        ));
        assert_eq!(runtime.snapshot().application.generation, current);
    }

    #[test]
    fn session_records_both_battery_sources_and_reopens() {
        let directory = tempfile_directory("commit-order");
        let path = directory.join("session.sqlite");
        let mut runtime = ApplicationRuntime::new();
        runtime
            .apply(Command::AttachSession {
                path: path.clone(),
                mode: SessionMode::Create,
                metadata: session_metadata(),
            })
            .expect("attach");
        let effects = runtime
            .record_sample(&sample(1), Some(0.5))
            .expect("translate");
        assert!(
            matches!(effects.as_slice(), [Effect::PublishSessionMarker(marker)] if marker.committed_sample_sequence == 1)
        );
        runtime.apply(Command::DetachSession).expect("detach");
        let mut reader = ApplicationRuntime::open_reader(&path).expect("reader");
        assert_eq!(
            reader.marker().expect("marker").committed_sample_sequence,
            1
        );
        let marker = reader.marker().unwrap();
        let fields = vec!["batteryLevel".into(), "estimatedBatteryLevel".into()];
        let series = reader
            .reduce_series(
                &fields,
                0,
                100,
                10,
                history::GapPolicy::Automatic,
                session::PublishedBoundary::from(&marker),
            )
            .unwrap();
        assert_eq!(series.columns[0].values, vec![1.0]);
        assert_eq!(series.columns[1].values, vec![0.5]);
        reader.close().expect("close reader");
    }

    #[test]
    fn rejected_persistence_never_commits_a_marker() {
        let directory = tempfile_directory("battery-publication-gate");
        let mut runtime = ApplicationRuntime::new();
        runtime
            .apply(Command::AttachSession {
                path: directory.join("session.sqlite"),
                mode: SessionMode::Create,
                metadata: session_metadata(),
            })
            .unwrap();
        let mut invalid = sample(1);
        invalid.pack_voltage_v = Some(f64::NAN);
        let effects = runtime.record_sample(&invalid, Some(0.5)).unwrap();
        assert!(effects.iter().any(|e| matches!(e, Effect::Failure(_))));
        assert!(!effects.iter().any(|e| matches!(
            e,
            Effect::Application(CoordinatorEffect::PublishTelemetry(_))
        )));
        assert_eq!(
            runtime
                .snapshot()
                .session_marker
                .unwrap()
                .committed_sample_sequence,
            0
        );
    }

    #[test]
    fn recovered_faults_commit_before_another_telemetry_sample_or_disconnect() {
        let directory = tempfile_directory("fault-history");
        let path = directory.join("session.sqlite");
        let mut runtime = ApplicationRuntime::new();
        runtime
            .apply(Command::AttachSession {
                path: path.clone(),
                mode: SessionMode::Create,
                metadata: session_metadata(),
            })
            .unwrap();
        let effects = runtime
            .translate(vec![CoordinatorEffect::PublishFaultHistory(
                telemetry::FaultHistoryObservation {
                    source_clock: None,
                    elapsed_ms: 100,
                    observed_at_epoch_ms: 1_700_000_000_100,
                    records: vec![
                        telemetry::FaultRecord {
                            kind: telemetry::AlertKind::FirmwareFault,
                            source_ticks: 900,
                            active: true,
                            raw_code: 4,
                        },
                        telemetry::FaultRecord {
                            kind: telemetry::AlertKind::FirmwareFault,
                            source_ticks: 901,
                            active: false,
                            raw_code: 0,
                        },
                    ],
                },
            )])
            .unwrap();
        assert!(matches!(
            effects.as_slice(),
            [Effect::PublishSessionMarker(_)]
        ));
        runtime.apply(Command::DetachSession).unwrap();
        let mut reader = session::SessionReader::open(path).unwrap();
        let marker = reader.marker().unwrap();
        assert_eq!(marker.committed_sample_sequence, 0);
        let events = reader
            .event_page(0, 100, 100, None, (&marker).into())
            .unwrap();
        assert_eq!(events.rows.len(), 2);
        assert!(events.rows[0].details_json.contains("absoluteOverCurrent"));
    }

    #[test]
    fn profile_events_allocate_session_sequences_without_overwriting_telemetry() {
        let directory = tempfile_directory("profile-events");
        let mut runtime = ApplicationRuntime::new();
        runtime
            .apply(Command::AttachSession {
                path: directory.join("session.sqlite"),
                mode: SessionMode::Create,
                metadata: session_metadata(),
            })
            .unwrap();
        runtime.record_sample(&sample(1), Some(0.5)).unwrap();
        let before = runtime.snapshot().session_marker.unwrap();
        for revision in [1, 2] {
            runtime
                .apply(Command::ProfileChanged {
                    saved_device_id: "board".into(),
                    revision,
                    values_json: "{}".into(),
                    at_ms: 1_700_000_000_002,
                })
                .unwrap();
        }
        let after = runtime.snapshot().session_marker.unwrap();
        assert_eq!(
            after.committed_event_count,
            before.committed_event_count + 2
        );
        assert_eq!(
            after.committed_event_sequence,
            before.committed_event_sequence + 2
        );
        assert_eq!(
            after.committed_sample_sequence,
            before.committed_sample_sequence
        );
        runtime.apply(Command::DetachSession).unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn live_telemetry_without_session_has_no_marker() {
        let mut runtime = ApplicationRuntime::new();
        let effects = runtime
            .translate(vec![CoordinatorEffect::PublishTelemetry(Box::new(sample(
                1,
            )))])
            .expect("translate");
        assert!(matches!(
            effects.as_slice(),
            [Effect::Application(CoordinatorEffect::PublishTelemetry(_))]
        ));
    }

    #[test]
    fn locations_commit_through_the_attached_writer() {
        let directory = tempfile_directory("locations");
        let path = directory.join("session.sqlite");
        let mut runtime = ApplicationRuntime::new();
        runtime
            .apply(Command::AttachSession {
                path,
                mode: SessionMode::Create,
                metadata: session_metadata(),
            })
            .expect("attach");
        let effects = runtime
            .apply(Command::AppendLocations(vec![LocationObservation {
                observed_at_epoch_ms: 1_700_000_000_100,
                elapsed_ms: 100,
                latitude: -33.86,
                longitude: 151.20,
                accuracy_m: Some(5.0),
                altitude_m: None,
            }]))
            .expect("location");
        assert!(
            matches!(effects.as_slice(), [Effect::PublishSessionMarker(marker)] if marker.committed_location_sequence == 1)
        );
    }

    #[test]
    fn invalid_location_fails_atomically_and_the_writer_recovers() {
        let directory = tempfile_directory("location-recovery");
        let path = directory.join("session.sqlite");
        let mut runtime = ApplicationRuntime::new();
        runtime
            .apply(Command::AttachSession {
                path: path.clone(),
                mode: SessionMode::Create,
                metadata: session_metadata(),
            })
            .expect("attach");
        let failure = runtime
            .apply(Command::AppendLocations(vec![LocationObservation {
                observed_at_epoch_ms: 1_700_000_000_100,
                elapsed_ms: 100,
                latitude: f64::NAN,
                longitude: 151.20,
                accuracy_m: Some(5.0),
                altitude_m: None,
            }]))
            .expect("contained failure");
        assert_eq!(
            failure,
            [Effect::Failure(RuntimeFailure::Persistence(
                WriterError::InvalidInput
            ))]
        );
        runtime
            .apply(Command::AppendLocations(vec![LocationObservation {
                observed_at_epoch_ms: 1_700_000_000_101,
                elapsed_ms: 101,
                latitude: -33.86,
                longitude: 151.20,
                accuracy_m: Some(5.0),
                altitude_m: None,
            }]))
            .expect("recovered location");
        runtime.apply(Command::DetachSession).expect("detach");
        let mut reader = ApplicationRuntime::open_reader(&path).expect("reader");
        assert_eq!(reader.marker().expect("marker").recorded_location_count, 1);
        reader.close().expect("close reader");
        let mut pruner = ApplicationRuntime::open_pruner(&path).expect("pruner");
        assert!(pruner.preview(1).expect("preview").preview().skipped);
        pruner.close().expect("close pruner");
    }

    #[test]
    fn session_lifecycle_rejects_duplicates_and_missing_attachments() {
        let directory = tempfile_directory("session-lifecycle");
        let path = directory.join("session.sqlite");
        let mut runtime = ApplicationRuntime::new();
        assert_eq!(
            runtime
                .apply(Command::DetachSession)
                .expect_err("no session"),
            RuntimeError::SessionNotAttached
        );
        runtime
            .apply(Command::AttachSession {
                path: path.clone(),
                mode: SessionMode::Create,
                metadata: session_metadata(),
            })
            .expect("attach");
        assert_eq!(
            runtime
                .apply(Command::AttachSession {
                    path,
                    mode: SessionMode::Open,
                    metadata: session_metadata(),
                })
                .expect_err("duplicate"),
            RuntimeError::SessionAlreadyAttached
        );
    }

    #[test]
    fn session_loads_capture_filtered_current_signed_limits_and_missing_inputs() {
        let limits = coordinator::controller_data::CurrentLimits {
            motor_current_max_a: 100.,
            motor_current_min_a: -50.,
            battery_current_max_a: 50.,
            battery_current_min_a: -20.,
            battery_series_cells: None,
        };
        let mut value = sample(1);
        value.motor_current_a = Some(-10.);
        value.filtered_motor_current_a = Some(30.);
        value.directional_motor_current_a = Some(25.);
        value.battery_current_a = Some(-15.);
        let captured = persisted_sample(&value, Some(&limits), None);
        let load = |sample: &telemetry::NormalizedSample, name: &str| {
            sample
                .extensions
                .iter()
                .find(|v| v.name == name)
                .map(|v| v.value)
        };
        assert_eq!(load(&captured, "motorLoad"), Some(0.6));
        assert_eq!(load(&captured, "batteryLoad"), Some(0.75));
        value.filtered_motor_current_a = None;
        assert_eq!(
            load(&persisted_sample(&value, Some(&limits), None), "motorLoad"),
            Some(0.5)
        );
        value.directional_motor_current_a = None;
        assert_eq!(
            load(&persisted_sample(&value, Some(&limits), None), "motorLoad"),
            Some(0.2)
        );
        value.battery_current_a = Some(-40.);
        assert_eq!(
            load(
                &persisted_sample(&value, Some(&limits), None),
                "batteryLoad"
            ),
            Some(1.)
        );
        assert_eq!(
            load(&persisted_sample(&value, None, None), "motorLoad"),
            None
        );
        value.motor_current_a = None;
        assert_eq!(
            load(&persisted_sample(&value, Some(&limits), None), "motorLoad"),
            None
        );
        value.motor_current_a = Some(10.);
        value.extensions = (0..telemetry::MAX_EXTENSIONS)
            .map(|i| telemetry::ExtensionValue {
                name: format!("future{i}"),
                value: 1.,
            })
            .collect();
        let captured = persisted_sample(&value, Some(&limits), None);
        assert_eq!(captured.extensions.len(), telemetry::MAX_EXTENSIONS + 2);
        let directory = tempfile_directory("recorded-loads");
        let path = directory.join("session.sqlite");
        let mut writer = SessionWriter::create(&path, session_metadata()).unwrap();
        let marker = writer.append_samples(&[captured]).unwrap();
        writer.close().unwrap();
        let mut reader = session::SessionReader::open(&path).unwrap();
        let fields = vec!["motorLoad".to_owned(), "batteryLoad".to_owned()];
        let series = reader
            .reduce_series(
                &fields,
                0,
                value.elapsed_ms + 1,
                10,
                history::GapPolicy::Automatic,
                session::PublishedBoundary::from(&marker),
            )
            .unwrap();
        assert_eq!(series.columns[0].values, vec![0.1]);
        assert_eq!(series.columns[1].values, vec![1.]);
        reader.close().unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn session_samples_capture_only_fresh_bms_temperatures() {
        let value = sample(1);
        let observed = value.observed_at_epoch_ms;
        let fresh = persisted_sample(&value, None, Some((observed - 4_999, 38.5, 29.25)));
        assert_eq!(fresh.bms_circuitry_temp_c, Some(38.5));
        assert_eq!(fresh.bms_highest_cell_temp_c, Some(29.25));

        for bms in [
            Some((observed - 5_000, 40.0, 30.0)),
            Some((observed + 1, 40.0, 30.0)),
            None,
        ] {
            let omitted = persisted_sample(&value, None, bms);
            assert_eq!(omitted.bms_circuitry_temp_c, None);
            assert_eq!(omitted.bms_highest_cell_temp_c, None);
        }
    }

    #[test]
    fn oversized_stream_fails_closed_and_begin_resets_it() {
        let mut runtime = ApplicationRuntime::new();
        let error = runtime
            .apply(Command::ReceiveBytes {
                generation: coordinator::Generation(0),
                bytes: vec![0; MAX_STREAM_BYTES + 1],
                now_ms: 1,
                observed_at_epoch_ms: 1,
            })
            .expect_err("oversized");
        assert_eq!(error, RuntimeError::Framing(FrameError::PayloadTooLarge));
        assert!(runtime.apply(Command::Application(begin(2))).is_ok());
    }

    fn firmware_response() -> Vec<u8> {
        let mut payload = vec![0, 6, 6];
        payload.extend_from_slice(b"THOR300\0");
        payload.extend_from_slice(&[7; 12]);
        payload.extend_from_slice(&[1, 0, 0, 0, 1, 0, 1, 0]);
        payload.extend_from_slice(b"Float\0");
        payload
    }

    fn tempfile_directory(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "float-view-application-runtime-{label}-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).expect("create temp directory");
        path
    }
    #[test]
    fn canonical_load_winner_matches_capture_and_stable_ties() {
        let limits = coordinator::controller_data::CurrentLimits {
            motor_current_max_a: 100.,
            motor_current_min_a: -50.,
            battery_current_max_a: 50.,
            battery_current_min_a: -20.,
            battery_series_cells: None,
        };
        let mut s = sample(1);
        s.duty_cycle = Some(-0.8);
        s.motor_current_a = Some(-1.);
        s.filtered_motor_current_a = Some(40.);
        s.battery_current_a = Some(-16.);
        let value = load::calculate(&s, Some(&limits));
        assert_eq!(value.winner.unwrap().source, load::Source::Duty);
        s.duty_cycle = Some(0.1);
        assert_eq!(
            load::calculate(&s, Some(&limits)).winner.unwrap().source,
            load::Source::Motor
        );
        s.battery_current_a = Some(-40.);
        assert_eq!(
            load::calculate(&s, Some(&limits)).winner.unwrap().source,
            load::Source::Battery
        );
        let captured = persisted_sample(&s, Some(&limits), None);
        assert_eq!(
            captured
                .extensions
                .iter()
                .find(|v| v.name == "motorLoad")
                .unwrap()
                .value,
            value.motor.unwrap()
        );
        assert_eq!(load::calculate(&s, None).motor, None);
        s.duty_cycle = Some(f64::NAN);
        assert_eq!(load::calculate(&s, None).winner, None);
    }
}
