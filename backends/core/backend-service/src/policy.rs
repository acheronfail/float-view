//! Portable discovery, connection, recording and location policy.
use crate::{
    BackendService,
    operations::Failure,
    os::{self, Effect, Fact, LinkState, Permission, Radio},
};
use float_view_application_runtime::{
    Command, Effect as RuntimeEffect, SessionMode, coordinator as c, session, telemetry,
};
use float_view_product_store::{Board, SchemaIdentity, Session, Settings};
use std::collections::{BTreeMap, VecDeque};

#[derive(Clone, PartialEq)]
pub(crate) struct Device {
    pub id: String,
    pub name: Option<String>,
    pub rssi: Option<i32>,
    pub seen: u64,
    pub epoch: i64,
}
pub(crate) struct Connection {
    pub device: Device,
    pub saved: bool,
    pub generation: u64,
    // Presentation follows the logical connection, across transport attempts.
    pub live_activity_generation: Option<u64>,
    pub state: LinkState,
    pub board: Option<Board>,
    pub session: Option<Session>,
    pub session_storage_bytes: Option<u64>,
    pub session_start: Option<u64>,
    pub session_elapsed_offset: u64,
    pub continuity: c::discovery::Continuity,
    pub package_version: Option<String>,
    pub context_activation: Option<(u64, String)>,
    pub latest: Option<telemetry::NormalizedSample>,
    pub latest_load: float_view_application_runtime::load::Load,
    pub battery: crate::battery::State,
    pub live_widget_slots: [String; 5],
    pub bms: Option<c::bms::BmsObservation>,
    pub reconnect_started: Option<u64>,
    pub reconnect_attempt: u32,
    pub selected_can_id: Option<u8>,
    pub refloat_draft_key: Option<String>,
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Timer {
    RideResume,
    Speech,
    Deadline(c::scheduler::DeadlineToken),
    Kernel(c::TimerToken),
    Reconnect,
    Discovery,
    Request(u64),
    ReconnectLimit,
    ConnectionAttempt,
    BleWrite,
}
pub(crate) struct TimerEntry {
    pub kind: Timer,
    pub generation: c::Generation,
    pub repeat: Option<u64>,
    pub due: u64,
}
pub(crate) struct Capture {
    pub id: u64,
    pub start: u64,
    pub offset: u64,
    pub high_accuracy: bool,
}
#[derive(PartialEq)]
struct HostStatus(bool, bool, String, Option<String>, Vec<String>, bool);
pub(crate) struct Policy {
    pub announcements: crate::announcements::State,
    pub exchange: os::Exchange,
    pub ble: crate::ble::Transport,
    pub settings: Settings,
    pub radio: Radio,
    pub scan_permission: Permission,
    pub connect_permission: Permission,
    pub devices: BTreeMap<String, Device>,
    pub visible_devices: BTreeMap<String, Device>,
    pub scan: Option<(u64, u64)>,
    pub normal_scan_until: Option<u64>,
    pub foreground_observed: bool,
    pub auto_connect: crate::auto_connect::Opportunity,
    pub active: Option<Connection>,
    pub ride: Option<float_view_product_store::RideCheckpoint>,
    pub timers: BTreeMap<u64, TimerEntry>,
    pub location_authorization: os::LocationAuthorization,
    pub location_background: bool,
    pub permissions: Option<crate::permissions::Observation>,
    pub permission_presentation: Option<(u64, crate::permissions::Id, u64)>,
    pub foreground: bool,
    pub capture: Option<Capture>,
    pub latest_location: Option<crate::facts::LiveLocation>,
    pub available_bytes: u64,
    pub revision: u64,
    pub boards: Vec<crate::facts::SavedBoard>,
    pub saved_device_ids: Vec<String>,
    host_status: Option<HostStatus>,
    live_activity: Option<crate::live_activity::LiveActivity>,
}
impl Policy {
    pub fn new(settings: Settings) -> Self {
        Self {
            announcements: crate::announcements::State::default(),
            exchange: os::Exchange::default(),
            ble: crate::ble::Transport::default(),
            settings,
            radio: Radio::Unknown,
            scan_permission: Permission::Unknown,
            connect_permission: Permission::Unknown,
            devices: BTreeMap::new(),
            visible_devices: BTreeMap::new(),
            scan: None,
            normal_scan_until: None,
            foreground_observed: false,
            auto_connect: crate::auto_connect::Opportunity::Closed,
            active: None,
            ride: None,
            timers: BTreeMap::new(),
            location_authorization: os::LocationAuthorization::Unavailable,
            location_background: false,
            permissions: None,
            permission_presentation: None,
            foreground: true,
            capture: None,
            latest_location: None,
            available_bytes: 0,
            revision: 0,
            boards: Vec::new(),
            saved_device_ids: Vec::new(),
            host_status: None,
            live_activity: None,
        }
    }
}
fn allowed(p: Permission) -> bool {
    matches!(p, Permission::Granted | Permission::NotRequired)
}
pub(crate) fn checked_device(id: &str, name: Option<&str>) -> Result<(), Failure> {
    if id.is_empty()
        || id.len() > 128
        || id.contains('\0')
        || name.is_some_and(|s| s.len() > 128 || s.contains('\0'))
    {
        Err(Failure::InvalidRequest)
    } else {
        Ok(())
    }
}
impl BackendService {
    pub fn lifetime(&self) -> u64 {
        self.policy.exchange.lifetime
    }
    pub fn drain_os(&mut self) -> os::Drain {
        self.policy.exchange.drain()
    }
    pub fn apply_os_json(&mut self, bytes: &[u8]) -> Result<(), Failure> {
        if bytes.len() > os::MAX_ENVELOPE_BYTES {
            return Err(Failure::InvalidRequest);
        }
        let envelope = serde_json::from_slice(bytes).map_err(|_| Failure::InvalidRequest)?;
        self.apply_os(envelope)
    }
    pub fn apply_os(&mut self, envelope: os::Envelope) -> Result<(), Failure> {
        if self.stopping {
            return Err(Failure::Unavailable);
        }
        let stopping_connection = matches!(&envelope.fact, Fact::StopRequested {});
        if !stopping_connection {
            self.admit_revision()?;
        }
        let e = &self.policy.exchange;
        if envelope.lifetime != e.lifetime || envelope.sequence <= e.sequence {
            return Err(Failure::InvalidState);
        }
        if envelope.monotonic_ms < e.now
            || envelope.monotonic_ms > 9_007_199_254_740_991
            || envelope.sequence > 9_007_199_254_740_991
            || envelope.epoch_ms < 0
            || envelope.epoch_ms > 253_402_300_799_999
        {
            return Err(Failure::InvalidRequest);
        }
        match &envelope.fact {
            Fact::NativeDiagnostics {
                platform,
                os_version,
                callbacks,
                max_queue_delay_ms,
                max_queue_depth,
                overflows,
                exchange_failures,
            } if !matches!(platform.as_str(), "ios" | "macos" | "android")
                || os_version.len() > 128
                || *callbacks > 1_000_000
                || *max_queue_delay_ms > 86_400_000
                || *max_queue_depth > 64
                || *overflows > 1_000_000
                || *exchange_failures > 1_000_000 =>
            {
                return Err(Failure::InvalidRequest);
            }
            Fact::Discovered {
                device_id, name, ..
            } => checked_device(device_id, name.as_deref())?,
            Fact::Bytes { bytes, .. } if bytes.len() > 8_192 => {
                return Err(Failure::InvalidRequest);
            }
            Fact::Location {
                latitude,
                longitude,
                accuracy_m,
                observed_at_ms,
                ..
            } if !latitude.is_finite()
                || !longitude.is_finite()
                || latitude.abs() > 90.
                || longitude.abs() > 180.
                || accuracy_m.is_some_and(|v| !v.is_finite() || v < 0.)
                || *observed_at_ms < 0 =>
            {
                return Err(Failure::InvalidRequest);
            }
            _ => {}
        }
        if !matches!(
            envelope.fact,
            Fact::WriteProgress {
                progress: crate::ble::Progress::Failed,
                ..
            } | Fact::Notifications { success: false, .. }
                | Fact::Timer { .. }
                | Fact::StopRequested {}
                | Fact::PresentationStarted { .. }
                | Fact::PresentationFinished { .. }
                | Fact::UiCompleted { .. }
                | Fact::VoiceSettingsOpened { .. }
                | Fact::Foreground { foreground: false }
                | Fact::Bluetooth {
                    radio: Radio::PoweredOff,
                    ..
                }
                | Fact::Link {
                    state: LinkState::Disconnected | LinkState::Failed,
                    ..
                }
        ) {
            self.policy.exchange.admit()?;
        }
        self.policy.exchange.sequence = envelope.sequence;
        self.policy.exchange.now = envelope.monotonic_ms;
        self.policy.exchange.epoch = envelope.epoch_ms;
        if !stopping_connection {
            self.expire_paused_ride()?;
            self.sync_ride_timer()?;
        }
        let now = envelope.monotonic_ms;
        let epoch = envelope.epoch_ms;
        self.diagnostics.generation = self.policy.active.as_ref().map_or(0, |a| a.generation);
        match &envelope.fact {
            Fact::Timer { id } => {
                if let Some(timer) = self.policy.timers.get(id) {
                    self.diagnostics
                        .metric("timer_lateness_ms", now.saturating_sub(timer.due));
                }
            }
            Fact::Bytes { bytes, .. } => self
                .diagnostics
                .metric("notification_bytes", bytes.len() as u64),
            Fact::WriteProgress {
                operation,
                progress,
                ..
            } => self
                .diagnostics
                .write_progress(*operation, now, epoch, *progress),
            Fact::Link { generation, state } => self.diagnostics.event(
                now,
                epoch,
                "link",
                serde_json::json!({"generation":generation,"state":state}),
                true,
            ),
            Fact::Bluetooth {
                radio,
                scan,
                connect,
            } => self.diagnostics.event(
                now,
                epoch,
                "bluetooth",
                serde_json::json!({"radio":radio,"scan":scan,"connect":connect}),
                true,
            ),
            Fact::Foreground { foreground } => self.diagnostics.event(
                now,
                epoch,
                "foreground",
                serde_json::json!({"foreground":foreground}),
                true,
            ),
            _ => {}
        }
        if matches!(
            &envelope.fact,
            Fact::Link {
                state: LinkState::Failed,
                ..
            }
        ) {
            self.diagnostics
                .capture(now, epoch, "connection_failure", false);
        }
        self.diagnostics.tick(now, epoch);
        let scan_before = self.policy.scan;
        let connection_before = self.policy.active.as_ref().map(|a| (a.generation, a.state));
        // Expire before accepting a delayed OS result, even when its timer fact is queued behind it.
        let deadline_expired = self.policy.timers.values().any(|t| {
            matches!(t.kind, Timer::ConnectionAttempt | Timer::BleWrite)
                && t.due <= envelope.monotonic_ms
        });
        if deadline_expired {
            self.reconnect()?;
        }
        // Periodic capability observations are facts, not product mutations.
        // Consume their sequence/time without inventing public revisions.
        let expired: Vec<_> = self
            .pending
            .iter()
            .filter(|(_, p)| {
                p.kind != crate::dispatch::PendingKind::Speech
                    && p.deadline <= envelope.monotonic_ms
            })
            .map(|(id, _)| *id)
            .collect();
        for id in expired {
            self.timeout_operation(id);
        }
        if self
            .policy
            .permission_presentation
            .is_some_and(|(_, _, deadline)| deadline <= envelope.monotonic_ms)
        {
            self.policy.permission_presentation = None;
            self.changed()?;
        }
        let unchanged_capability = match &envelope.fact {
            Fact::SpeechReady { state } => *state == self.policy.announcements.audio,
            Fact::Permissions { observation } => {
                self.policy.permissions.as_ref() == Some(observation)
            }
            Fact::Bluetooth {
                radio,
                scan,
                connect,
            } => {
                *radio == self.policy.radio
                    && *scan == self.policy.scan_permission
                    && *connect == self.policy.connect_permission
            }
            Fact::Foreground { foreground } => {
                self.policy.foreground_observed && *foreground == self.policy.foreground
            }
            _ => false,
        };
        if unchanged_capability && !deadline_expired {
            return Ok(());
        }
        let discovery_timer = matches!(&envelope.fact, Fact::Timer { id }
            if self.policy.timers.get(id).is_some_and(|t| t.kind == Timer::Discovery));
        let discovery_before =
            discovery_timer.then(|| (self.policy.scan, self.policy.visible_devices.clone()));
        let inactive_timer = matches!(&envelope.fact, Fact::Timer { id }
            if self.policy.timers.get(id).is_none_or(|t| envelope.monotonic_ms < t.due));
        let discovery_only = matches!(envelope.fact, Fact::Discovered { .. } | Fact::Clock {});
        let speech_timer = matches!(&envelope.fact, Fact::Timer { id }
            if self.policy.timers.get(id).is_some_and(|t|t.kind==Timer::Speech));
        let private_completion = speech_timer
            || matches!(
                envelope.fact,
                Fact::SpeechFinished { .. }
                    | Fact::PresentationStarted { .. }
                    | Fact::PresentationFinished { .. }
                    | Fact::Profile { .. }
                    | Fact::Notifications { .. }
                    | Fact::WriteProgress { .. }
                    | Fact::Link { .. }
                    | Fact::Storage { .. }
                    | Fact::NativeDiagnostics { .. }
            );
        let same_foreground = matches!(envelope.fact, Fact::Foreground { foreground } if foreground == self.policy.foreground);
        let first_discovery = matches!(envelope.fact, Fact::Discovered { .. })
            && self.policy.visible_devices.is_empty();
        match envelope.fact {
            Fact::Permissions { observation } => {
                if !observation.valid() {
                    return Err(Failure::InvalidRequest);
                }
                (
                    self.policy.location_authorization,
                    self.policy.location_background,
                ) = observation.location_capability();
                if !observation.scan_location_ready() {
                    self.stop_scan();
                }
                self.policy.permissions = Some(observation);
            }
            Fact::NativeDiagnostics {
                platform,
                os_version,
                callbacks,
                max_queue_delay_ms,
                max_queue_depth,
                overflows,
                exchange_failures,
            } => {
                self.diagnostics.event(now, epoch, "native", serde_json::json!({"platform":platform,"os_version":os_version,"callbacks":callbacks,"max_queue_delay_ms":max_queue_delay_ms,"max_queue_depth":max_queue_depth,"overflows":overflows,"exchange_failures":exchange_failures}), true);
                if max_queue_delay_ms > 500 || overflows > 0 || exchange_failures > 0 {
                    self.diagnostics
                        .capture(now, epoch, "native_delay_or_failure", false);
                }
            }
            fact @ (Fact::SpeechReady { .. } | Fact::SpeechFinished { .. }) => {
                self.apply_speech_fact(fact)
            }
            Fact::Clock {} => {}
            Fact::StopRequested {} => {
                self.cancel_auto_connect();
                self.disconnect("native_stop_requested")?;
            }
            Fact::Bluetooth {
                radio,
                scan,
                connect,
            } => {
                self.policy.radio = radio;
                self.policy.scan_permission = scan;
                self.policy.connect_permission = connect;
                if radio != Radio::PoweredOn || !allowed(scan) {
                    self.stop_scan();
                }
                if self.policy.active.is_some() {
                    if !allowed(connect) {
                        self.disconnect("permission_denied")?;
                    } else if radio != Radio::PoweredOn {
                        self.reconnect()?;
                    }
                }
            }
            Fact::Discovered {
                scan_id,
                device_id,
                name,
                rssi,
                advertises_uart,
            } => {
                if self.policy.scan.is_some_and(|s| s.0 == scan_id)
                    && crate::ble::eligible(
                        advertises_uart,
                        &device_id,
                        &self.policy.saved_device_ids,
                    )
                {
                    self.expire_discovery();
                    if !self.policy.devices.contains_key(&device_id)
                        && self.policy.devices.len() >= 50
                    {
                        let oldest = self
                            .policy
                            .devices
                            .values()
                            .min_by_key(|d| (d.seen, d.rssi.unwrap_or(-127)))
                            .map(|d| d.id.clone());
                        if let Some(id) = oldest {
                            self.policy.devices.remove(&id);
                        }
                    }
                    self.policy.devices.insert(
                        device_id.clone(),
                        Device {
                            id: device_id.clone(),
                            name,
                            rssi,
                            seen: envelope.monotonic_ms,
                            epoch: envelope.epoch_ms,
                        },
                    );
                    self.auto_connect_discovered(&device_id)?;
                }
            }
            Fact::Link { generation, state } => {
                if self.policy.active.as_ref().is_some_and(|a| {
                    a.generation == generation && a.state != LinkState::Disconnected
                }) {
                    match state {
                        LinkState::Disconnected | LinkState::Failed => {
                            if self
                                .runtime
                                .snapshot()
                                .application
                                .mutations
                                .controller_actions
                                .shutdown_pending
                            {
                                self.disconnect("controller_shutdown")?;
                            } else {
                                self.reconnect()?;
                            }
                        }
                        LinkState::Ready => {}
                        _ if !self.policy.ble.ready => {
                            self.policy.active.as_mut().unwrap().state = state
                        }
                        _ => {}
                    }
                }
            }
            Fact::Profile {
                generation,
                operation,
                profile,
            } => {
                if generation == operation
                    && generation == self.policy.ble.generation
                    && generation != 0
                {
                    let id = self.policy.exchange.id()?;
                    match self.policy.ble.profile(generation, profile, id) {
                        Ok(Some(mode)) => {
                            self.policy
                                .active
                                .as_mut()
                                .ok_or(Failure::InvalidState)?
                                .state = LinkState::EnablingNotifications;
                            self.policy.exchange.push(Effect::EnableNotifications {
                                generation,
                                operation: id,
                                mode,
                            })?;
                        }
                        Ok(None) => {}
                        Err(()) => self.reconnect()?,
                    }
                }
            }
            Fact::Notifications {
                generation,
                operation,
                success,
            } => {
                match self
                    .policy
                    .ble
                    .notifications(generation, operation, success)
                {
                    Ok(true) => {
                        self.policy
                            .active
                            .as_mut()
                            .ok_or(Failure::InvalidState)?
                            .state = LinkState::Ready;
                        self.begin_runtime()?;
                    }
                    Ok(false) => {}
                    Err(()) => self.reconnect()?,
                }
            }
            Fact::WriteProgress {
                generation,
                operation,
                progress,
            } => match self.policy.ble.progress(generation, operation, progress) {
                Ok(true) => {
                    self.cancel_timer(Timer::BleWrite);
                    self.emit_ble_write()?;
                }
                Ok(false) => {}
                Err(()) => self.reconnect()?,
            },
            Fact::Bytes { generation, bytes } => {
                if self
                    .policy
                    .active
                    .as_ref()
                    .is_some_and(|a| a.generation == generation && a.state == LinkState::Ready)
                {
                    if self
                        .policy
                        .active
                        .as_ref()
                        .is_some_and(|a| a.session.is_some())
                        && self.policy.available_bytes < 262_144_000
                    {
                        self.disconnect("storage_full")?;
                    } else {
                        let generation = self.runtime.snapshot().application.generation;
                        self.runtime_command(Command::ReceiveBytes {
                            generation,
                            bytes,
                            now_ms: envelope.monotonic_ms,
                            observed_at_epoch_ms: envelope.epoch_ms,
                        })?;
                    }
                }
            }
            Fact::Timer { id } => self.fire_timer(id)?,
            Fact::Foreground { foreground } => {
                let entering =
                    foreground && (!self.policy.foreground_observed || !self.policy.foreground);
                if entering && self.policy.foreground_observed && self.policy.scan.take().is_some()
                {
                    // Fence queued observations from the previous visit while preserving normal demand.
                    self.policy.exchange.request_stop_scan();
                }
                self.policy.foreground_observed = true;
                self.policy.foreground = foreground;
                if entering {
                    self.policy.auto_connect = if self.policy.active.is_none() {
                        crate::auto_connect::Opportunity::Waiting
                    } else {
                        crate::auto_connect::Opportunity::Closed
                    };
                } else if !foreground {
                    self.cancel_auto_connect();
                }
                if !foreground
                    && self
                        .policy
                        .active
                        .as_ref()
                        .is_some_and(|a| a.state != LinkState::Ready)
                {
                    self.clear_connection_editor_state()?;
                }
            }
            Fact::Storage { available_bytes } => self.policy.available_bytes = available_bytes,
            Fact::LocationSpeed {
                capture_id,
                speed_mps,
                accuracy_mps,
                age_ms,
            } => {
                if self
                    .policy
                    .capture
                    .as_ref()
                    .is_some_and(|c| c.id == capture_id)
                {
                    self.calibration
                        .speed(envelope.monotonic_ms, age_ms, speed_mps, accuracy_mps);
                }
            }
            Fact::Location {
                capture_id,
                latitude,
                longitude,
                accuracy_m,
                altitude_m,
                observed_at_ms,
            } => {
                if let Some(capture) = self.policy.capture.as_ref().filter(|c| c.id == capture_id) {
                    let persist = self.policy.settings.location_recording_enabled
                        && self.policy.active.as_ref().is_some_and(|a| {
                            a.saved
                                && a.session.is_some()
                                && a.latest
                                    .as_ref()
                                    .is_some_and(|s| s.ride_state == telemetry::RideState::Riding)
                        });
                    if !persist {
                        return Ok(());
                    }
                    let altitude_m = altitude_m.filter(|value| value.is_finite());
                    let elapsed_ms = capture
                        .offset
                        .saturating_add(envelope.monotonic_ms.saturating_sub(capture.start));
                    self.runtime_command(Command::AppendLocations(vec![
                        session::LocationObservation {
                            observed_at_epoch_ms: observed_at_ms,
                            elapsed_ms,
                            latitude,
                            longitude,
                            accuracy_m,
                            altitude_m,
                        },
                    ]))?;
                    self.policy.latest_location = Some(crate::facts::LiveLocation {
                        latitude,
                        longitude,
                        accuracy_m,
                        altitude_m,
                        observed_at: crate::projection::date(observed_at_ms),
                    });
                }
            }
            Fact::PresentationStarted { id, accepted } => {
                let _ = self.presentation_started(id, accepted);
            }
            Fact::PresentationFinished { id } => {
                let _ = self.finish_presentation(id);
            }
            Fact::UiCompleted { id, success } => self.complete_ui(id, success),
            Fact::VoiceSettingsOpened { id, success } => self.complete_voice_settings(id, success),
        }
        self.step_auto_connect()?;
        self.location_eligibility()?;
        self.step_announcements()?;
        if first_discovery {
            self.policy.visible_devices = self.policy.devices.clone();
        }
        let unchanged_discovery = discovery_before.is_some_and(|(scan, devices)| {
            scan == self.policy.scan && devices == self.policy.visible_devices
        });
        if (!discovery_only
            && !private_completion
            && !inactive_timer
            && !unchanged_discovery
            && !same_foreground)
            || self.battery_warning() != self.policy.announcements.last_published_battery_warning
            || first_discovery
            || scan_before != self.policy.scan
            || connection_before != self.policy.active.as_ref().map(|a| (a.generation, a.state))
        {
            self.changed()?;
        }
        Ok(())
    }
    pub(crate) fn admit_revision(&self) -> Result<(), Failure> {
        // Leave a fixed reserve for accepted work and mandatory shutdown cleanup.
        if self.policy.revision >= 9_007_199_254_740_991 - 65_536 {
            Err(Failure::Unavailable)
        } else {
            Ok(())
        }
    }
    pub(crate) fn changed(&mut self) -> Result<(), Failure> {
        self.refresh_battery()?;
        self.refresh_battery_context();
        self.policy.announcements.last_published_battery_warning = self.battery_warning();
        let runtime = self.runtime.snapshot().application;
        if let Some(active) = self.policy.active.as_mut()
            && active.live_activity_generation.is_none()
            && active.state == LinkState::Ready
            && active.reconnect_started.is_none()
            && runtime.phase == c::Phase::Ready
            && !runtime.standalone_bms
        {
            active.live_activity_generation = Some(active.generation);
        }
        let live_activity = self.live_activity();
        if self.policy.live_activity != live_activity {
            self.policy.exchange.live_activity = Some(Effect::LiveActivity {
                state: live_activity.clone(),
            });
            self.policy.live_activity = live_activity;
        }
        let status = HostStatus(
            self.policy.active.is_some(),
            self.policy
                .active
                .as_ref()
                .is_some_and(|a| a.session.is_some()),
            self.policy.settings.theme_preference.clone(),
            self.policy.active.as_ref().map(|a| {
                a.board
                    .as_ref()
                    .map(|b| b.display_name().to_owned())
                    .or(a.device.name.clone())
                    .unwrap_or_else(|| a.device.id.clone())
            }),
            self.policy.saved_device_ids.clone(),
            self.policy.settings.announcements.volume_percent > 0
                && (self.policy.settings.announcements.speed_enabled
                    || self.policy.settings.announcements.load_enabled
                    || self.policy.settings.announcements.footpad_enabled
                    || self.policy.settings.announcements.battery_charge_enabled),
        );
        if self.policy.host_status.as_ref() != Some(&status) {
            self.policy.exchange.status = Some(Effect::HostState {
                speech_enabled: status.5,
                connected: status.0,
                recording: status.1,
                theme_preference: status.2.clone(),
                display_name: status.3.clone(),
                saved_device_ids: status.4.clone(),
            });
            self.policy.host_status = Some(status);
        }

        self.policy.revision = self
            .policy
            .revision
            .checked_add(1)
            .filter(|v| *v <= 9_007_199_254_740_991)
            .ok_or(Failure::Unavailable)?;
        self.notifications.send_replace(self.policy.revision);
        Ok(())
    }
    pub fn start_scan(&mut self, timeout_ms: u32) -> Result<u64, Failure> {
        self.admit_revision()?;
        if !(1..=60_000).contains(&timeout_ms) {
            return Err(Failure::InvalidRequest);
        }
        if !allowed(self.policy.scan_permission)
            || self
                .policy
                .permissions
                .as_ref()
                .is_some_and(|p| !p.scan_location_ready())
        {
            return Err(Failure::PermissionRequired);
        }
        // Apple cannot report radio readiness until the permission-triggering
        // manager exists. Let clients request access before checking the radio.
        if self.policy.radio != Radio::PoweredOn {
            return Err(Failure::Unavailable);
        }
        if self
            .policy
            .normal_scan_until
            .is_none_or(|until| until <= self.policy.exchange.now)
        {
            self.policy.normal_scan_until = Some(self.policy.exchange.now + u64::from(timeout_ms));
        }
        self.step_auto_connect()?;
        self.changed()?;
        self.policy.scan.map(|s| s.0).ok_or(Failure::Unavailable)
    }
    pub(crate) fn stop_scan(&mut self) {
        self.policy.normal_scan_until = None;
        if self.policy.scan.take().is_some() {
            self.policy.exchange.request_stop_scan();
        }
    }
    fn expire_discovery(&mut self) {
        let now = self.policy.exchange.now;
        self.policy
            .devices
            .retain(|_, d| now.saturating_sub(d.seen) < 120_000);
    }
    pub fn connect(&mut self, id: &str, saved: bool) -> Result<(), Failure> {
        self.admit_revision()?;
        checked_device(id, None)?;
        self.policy.exchange.admit()?;
        if let Some(active) = &self.policy.active {
            if active.device.id != id
                || self.runtime.snapshot().application.phase != c::Phase::Failed
            {
                return Err(Failure::InvalidState);
            }
            self.disconnect("replaced_failed_connection")?;
        }
        if self.policy.radio != Radio::PoweredOn {
            return Err(Failure::Unavailable);
        }
        if !allowed(self.policy.connect_permission) {
            return Err(Failure::PermissionRequired);
        }
        let device = self.policy.devices.get(id).ok_or(Failure::NotFound)?;
        let device = Device {
            id: device.id.clone(),
            name: device.name.clone(),
            rssi: device.rssi,
            seen: device.seen,
            epoch: device.epoch,
        };
        let board = if saved {
            self.store
                .boards()
                .map_err(crate::store_failure)?
                .into_iter()
                .find(|b| b.local_identifier.as_deref() == Some(id))
        } else {
            None
        };
        if let Some(ride) = self
            .policy
            .ride
            .as_ref()
            .filter(|r| r.paused_at_ms.is_some())
            .cloned()
            && (!saved
                || board
                    .as_ref()
                    .is_none_or(|b| b.saved_device_id != ride.saved_device_id))
        {
            self.finish_paused_ride(&ride.session_id, "different_board")?;
        }
        self.stop_scan();
        let generation = self.policy.exchange.id()?;
        self.policy.active = Some(Connection {
            device,
            saved,
            generation,
            live_activity_generation: None,
            state: LinkState::Connecting,
            board,
            session: None,
            session_storage_bytes: None,
            session_start: None,
            session_elapsed_offset: 0,
            continuity: c::discovery::Continuity::default(),
            refloat_draft_key: None,
            package_version: None,
            context_activation: None,
            latest: None,
            latest_load: Default::default(),
            battery: crate::battery::State::default(),
            live_widget_slots: float_view_product_store::Settings::default().live_widget_slots,
            bms: None,
            reconnect_started: None,
            reconnect_attempt: 0,
            selected_can_id: None,
        });
        self.policy.ble.begin(generation);
        self.policy.exchange.push(Effect::Connect {
            generation,
            device_id: id.into(),
        })?;
        self.arm_timer(Timer::ConnectionAttempt, 10_000, None)?;
        self.changed()
    }
    fn begin_runtime(&mut self) -> Result<(), Failure> {
        let a = self.policy.active.as_ref().ok_or(Failure::InvalidState)?;
        let profile = a
            .board
            .as_ref()
            .map(|b| self.store.profile(&b.saved_device_id))
            .transpose()
            .map_err(crate::store_failure)?;
        let hint = a
            .board
            .as_ref()
            .map(|b| self.store.routing_hint(&b.saved_device_id))
            .transpose()
            .map_err(crate::store_failure)?
            .flatten();
        let preference = |key: &str| {
            profile
                .as_ref()
                .and_then(|p| p.values.get(key))
                .and_then(|v| v.as_u64())
                .and_then(|v| u8::try_from(v).ok())
        };
        self.runtime_command(Command::Application(c::Command::Begin(c::BeginFacts {
            now_ms: self.policy.exchange.now,
            settings: telemetry::Settings::new(
                self.policy.settings.idle_probe_interval_ms,
                self.policy.settings.post_ride_tail_ms,
            )
            .map_err(|_| Failure::InvalidRequest)?,
            preferred_controller_can_id: preference("preferredCanId"),
            preferred_bms_can_id: preference("preferredBmsCanId"),
            routing_hint: hint.and_then(|h| {
                h.controller_uuid
                    .and_then(|uuid| c::discovery::RoutingHint::new(h.can_id, uuid).ok())
            }),
            continuity: a.continuity,
        })))
    }
    pub fn disconnect(&mut self, reason: &str) -> Result<(), Failure> {
        self.calibration = crate::calibration::Calibration::default();
        let Some(active) = self.policy.active.as_ref() else {
            return Ok(());
        };
        let generation = active.generation;
        let session = active.session.clone();
        // Reserved cleanup is independent of queue capacity and storage. Queue
        // it before any fallible work, including editor and recording cleanup.
        self.policy.exchange.clear_connection(generation);
        self.policy.ble.clear();
        self.policy.timers.retain(|_, t| {
            matches!(
                t.kind,
                Timer::Request(_) | Timer::Discovery | Timer::Speech | Timer::RideResume
            )
        });
        self.policy.capture = None;
        self.fail_kernel_requests("connection_replaced");
        self.diagnostics.event(
            self.policy.exchange.now,
            self.policy.exchange.epoch,
            "disconnect",
            serde_json::json!({"reason":reason.chars().take(64).collect::<String>()}),
            true,
        );
        // Result::and evaluates each cleanup eagerly; keep the first error
        // without letting it skip release, catalog work or state publication.
        let mut result = self.clear_connection_editor_state();
        if self.runtime.snapshot().session_attached {
            let interruption = match reason {
                "explicit_disconnect" | "native_stop_requested" => {
                    session::InterruptionReason::Pause
                }
                "reconnect_timeout" => session::InterruptionReason::ConnectionLoss,
                _ => session::InterruptionReason::Unknown,
            };
            let saved = self
                .runtime
                .interrupt_recording(interruption, self.policy.exchange.epoch)
                .map_err(|_| Failure::Unavailable)
                .and_then(|marker| {
                    session.as_ref().map_or(Ok(()), |session| {
                        self.store
                            .apply_session_marker(&session.session_id, &marker)
                            .map_err(crate::store_failure)
                    })
                });
            result = result.and(saved);
            result = result.and(
                self.runtime
                    .apply(Command::DetachSession)
                    .map(|_| ())
                    .map_err(|_| Failure::Internal),
            );
        }
        if let Some(session) = session {
            let pause = matches!(
                reason,
                "explicit_disconnect"
                    | "native_stop_requested"
                    | "controller_shutdown"
                    | "service_shutdown"
                    | "reconnect_timeout"
            ) && self.policy.ride.is_some();
            // Logical pause state describes the connection we just released.
            // It is not evidence for a historical interruption reason.
            let mut fallback = self
                .policy
                .ride
                .clone()
                .filter(|r| pause && r.session_id == session.session_id);
            if let Some(ride) = fallback.as_mut()
                && ride.paused_at_ms.is_none()
            {
                let window = self.policy.settings.ride_resume_window_minutes;
                let deadline = self.policy.exchange.epoch + window as i64 * 60_000;
                if deadline <= 253_402_300_799_999 {
                    ride.window_minutes = window;
                    ride.paused_at_ms = Some(self.policy.exchange.epoch);
                    ride.resume_until_ms = Some(deadline);
                }
            }
            let catalog = if pause {
                self.store.pause_ride(self.policy.exchange.epoch)
            } else {
                self.store
                    .close_session(
                        &session.session_id,
                        self.policy.exchange.epoch.max(session.started_at_ms),
                        reason,
                    )
                    .map(|_| ())
            };
            result = result.and(catalog.map_err(crate::store_failure));
            match self.store.ride_checkpoint() {
                Ok(ride) => {
                    self.policy.ride = if pause
                        && ride.as_ref().is_some_and(|r| {
                            r.session_id == session.session_id && r.paused_at_ms.is_none()
                        }) {
                        fallback
                    } else {
                        ride
                    };
                }
                Err(error) => {
                    self.policy.ride = fallback;
                    result = result.and(Err(crate::store_failure(error)));
                }
            }
        }
        result = result.and(
            self.runtime
                .apply(Command::Application(c::Command::Reset {
                    now_ms: self.policy.exchange.now,
                }))
                .map(|_| ())
                .map_err(|_| Failure::Internal),
        );
        self.policy.active = None;
        self.policy.latest_location = None;
        result = result.and(self.sync_ride_timer());
        result = result.and(self.refresh_boards().map_err(crate::store_failure));
        result = result.and(self.changed());
        if let Err(error) = &result {
            self.record_operation_failure("device.disconnect", error);
        }
        self.diagnostics
            .finish(self.policy.exchange.now, self.policy.exchange.epoch);
        result
    }
    fn reconnect(&mut self) -> Result<(), Failure> {
        self.calibration = crate::calibration::Calibration::default();
        // A discovery rejection needs an explicit new attempt, even if BLE drops later.
        if self.runtime.snapshot().application.phase == c::Phase::Failed {
            if let Some(active) = self.policy.active.as_mut() {
                active.reconnect_started = None;
                active.state = LinkState::Failed;
            }
            return self.changed();
        }
        if !self.policy.foreground {
            self.clear_connection_editor_state()?;
        }
        self.record_configuration_contents(None);
        self.diagnostics.capture(
            self.policy.exchange.now,
            self.policy.exchange.epoch,
            "reconnect",
            true,
        );
        self.fail_kernel_requests("connection_replaced");
        let Some(a) = self.policy.active.as_mut() else {
            return Ok(());
        };
        a.battery.reconnect();
        if self.runtime.snapshot().session_attached {
            let marker = self
                .runtime
                .interrupt_recording(
                    session::InterruptionReason::ConnectionLoss,
                    self.policy.exchange.epoch,
                )
                .map_err(|_| Failure::Unavailable)?;
            if let Some(session) = a.session.as_ref() {
                self.store
                    .apply_session_marker(&session.session_id, &marker)
                    .map_err(crate::store_failure)?;
            }
        }
        if a.session.is_some() {
            self.store
                .pause_ride(self.policy.exchange.epoch)
                .map_err(crate::store_failure)?;
            self.policy.ride = self.store.ride_checkpoint().map_err(crate::store_failure)?;
        }
        if a.reconnect_started.is_none() {
            a.reconnect_started = Some(self.policy.exchange.now);
        }
        let elapsed = self
            .policy
            .exchange
            .now
            .saturating_sub(a.reconnect_started.unwrap());
        if elapsed >= self.policy.settings.reconnect_duration_ms {
            return self.disconnect("reconnect_timeout");
        }
        self.policy.ble.clear();
        a.state = LinkState::Disconnected;
        self.policy.exchange.clear_connection(a.generation);
        self.policy.timers.retain(|_, t| {
            matches!(
                t.kind,
                Timer::Request(_) | Timer::Discovery | Timer::Speech | Timer::RideResume
            )
        });
        self.policy.capture = None;
        let delay = (1_000u64 << a.reconnect_attempt.min(5))
            .min(30_000)
            .min(self.policy.settings.reconnect_duration_ms - elapsed);
        self.arm_timer(Timer::Reconnect, delay, None)?;
        self.arm_timer(
            Timer::ReconnectLimit,
            self.policy.settings.reconnect_duration_ms - elapsed,
            None,
        )
    }
    pub(crate) fn arm_timer(
        &mut self,
        kind: Timer,
        delay_ms: u64,
        repeat: Option<u64>,
    ) -> Result<(), Failure> {
        self.cancel_timer(kind);
        if self.policy.timers.len() >= 2_048 {
            return Err(Failure::Unavailable);
        }
        let id = self.policy.exchange.id()?;
        self.policy.timers.insert(
            id,
            TimerEntry {
                kind,
                generation: self.runtime.snapshot().application.generation,
                repeat,
                due: self.policy.exchange.now.saturating_add(delay_ms),
            },
        );
        self.policy.exchange.push(Effect::ArmTimer {
            id,
            delay_ms,
            connection: !matches!(
                kind,
                Timer::Request(_) | Timer::Discovery | Timer::Speech | Timer::RideResume
            ),
        })
    }
    pub(crate) fn cancel_timer(&mut self, kind: Timer) {
        if let Some(id) = self
            .policy
            .timers
            .iter()
            .find(|(_, t)| t.kind == kind)
            .map(|(id, _)| *id)
        {
            self.policy.timers.remove(&id);
            // Cancelled IDs can never fire a logical timer even if the OS queue is full.
            let _ = self.policy.exchange.push(Effect::CancelTimer { id });
        }
    }
    fn fire_timer(&mut self, id: u64) -> Result<(), Failure> {
        let Some(timer) = self.policy.timers.remove(&id) else {
            return Ok(());
        };
        if self.policy.exchange.now < timer.due {
            let delay_ms = timer.due - self.policy.exchange.now;
            self.policy.exchange.push(Effect::ArmTimer {
                id,
                delay_ms,
                connection: !matches!(
                    timer.kind,
                    Timer::Request(_) | Timer::Discovery | Timer::Speech | Timer::RideResume
                ),
            })?;
            self.policy.timers.insert(id, timer);
            return Ok(());
        }
        match timer.kind {
            Timer::RideResume => self.expire_paused_ride()?,
            Timer::Speech => self.step_announcements()?,
            Timer::Request(request) => {
                if let Some(p) = self.pending.get(&request) {
                    if self.policy.exchange.now < p.deadline {
                        self.arm_timer(
                            Timer::Request(request),
                            p.deadline - self.policy.exchange.now,
                            None,
                        )?;
                    } else {
                        self.timeout_operation(request);
                    }
                }
            }
            Timer::Discovery => {
                self.expire_discovery();
                self.policy.visible_devices = self.policy.devices.clone();
                self.step_auto_connect()?;
                if self.policy.scan.is_some() || !self.policy.devices.is_empty() {
                    self.arm_timer(Timer::Discovery, 250, Some(250))?;
                }
            }
            Timer::ReconnectLimit => self.disconnect("reconnect_timeout")?,
            Timer::ConnectionAttempt | Timer::BleWrite => self.reconnect()?,
            Timer::Reconnect => {
                if self
                    .policy
                    .active
                    .as_ref()
                    .and_then(|a| a.reconnect_started)
                    .is_some_and(|start| {
                        self.policy.exchange.now.saturating_sub(start)
                            >= self.policy.settings.reconnect_duration_ms
                    })
                {
                    return self.disconnect("reconnect_timeout");
                }
                if self.policy.radio != Radio::PoweredOn {
                    return self.reconnect();
                }
                if let Some(a) = self.policy.active.as_mut() {
                    a.reconnect_attempt += 1;
                    a.generation = self.policy.exchange.id()?;
                    a.state = LinkState::Connecting;
                    self.policy.ble.begin(a.generation);
                    self.policy.exchange.push(Effect::Connect {
                        generation: a.generation,
                        device_id: a.device.id.clone(),
                    })?;
                    self.arm_timer(Timer::ConnectionAttempt, 10_000, None)?;
                }
            }
            Timer::Deadline(token) => {
                self.runtime_command(Command::Application(c::Command::DeadlineFired {
                    generation: timer.generation,
                    token,
                    now_ms: self.policy.exchange.now,
                }))?
            }
            Timer::Kernel(token) => {
                if let Some(interval) = timer.repeat {
                    self.arm_timer(timer.kind, interval, Some(interval))?;
                }
                self.runtime_command(Command::Application(c::Command::TimerFired {
                    generation: timer.generation,
                    token,
                    now_ms: self.policy.exchange.now,
                }))?;
            }
        }
        Ok(())
    }
    fn emit_ble_write(&mut self) -> Result<(), Failure> {
        let operation = self.policy.exchange.id()?;
        if let Some((mode, bytes)) = self.policy.ble.next(operation) {
            self.diagnostics.write_started(
                operation,
                self.policy.exchange.now,
                self.policy.exchange.epoch,
                bytes.len(),
            );
            self.arm_timer(Timer::BleWrite, crate::ble::DEADLINE_MS, None)?;
            self.policy.exchange.push(Effect::Write {
                generation: self.policy.ble.generation,
                operation,
                mode,
                bytes,
            })?;
        }
        Ok(())
    }
    pub(crate) fn runtime_command(&mut self, command: Command) -> Result<(), Failure> {
        let runtime_started = std::time::Instant::now();
        let context = match &command {
            Command::Application(command) => self.operation_context(command),
            _ => None,
        };
        let mut effects: VecDeque<_> = match self.runtime.apply(command) {
            Ok(effects) => effects.into(),
            Err(error) => {
                for request in self.runtime.take_request_timings() {
                    self.record_request_diagnostic(&request, true);
                }
                self.runtime_failure(&error, context);
                return Err(Failure::InvalidState);
            }
        };
        let mut count = 0;
        while let Some(effect) = effects.pop_front() {
            count += 1;
            if count > os::RUNTIME_RESERVE {
                return Err(Failure::Unavailable);
            }
            match effect {
                RuntimeEffect::WriteBytes(bytes) => {
                    if self.policy.ble.admit(&bytes).is_err() {
                        self.reconnect()?;
                        return Ok(());
                    }
                    self.emit_ble_write()?;
                }
                RuntimeEffect::PublishSessionMarker(marker) => {
                    self.diagnostics.event(self.policy.exchange.now, self.policy.exchange.epoch, "recording", serde_json::json!({"accepted":marker.recorded_sample_count,"stored":marker.stored_sample_count,"sequence":marker.committed_sample_sequence,"elapsed_ms":marker.committed_elapsed_ms}), false);
                    let catalog_started = std::time::Instant::now();
                    if let Some(active) = self.policy.active.as_mut()
                        && let Some(session) = active.session.as_mut()
                    {
                        self.store
                            .apply_session_marker(&session.session_id, &marker)
                            .map_err(crate::store_failure)?;
                        self.diagnostics.metric(
                            "catalog_us",
                            catalog_started.elapsed().as_micros().min(u64::MAX as u128) as u64,
                        );
                        let old_storage_bytes = active.session_storage_bytes;
                        active.session_storage_bytes =
                            self.store.session_storage_bytes(&session.session_id).ok();
                        let old = session.clone();
                        *session = self
                            .store
                            .session(&session.session_id)
                            .map_err(crate::store_failure)?;
                        if let Some(board) = self
                            .policy
                            .boards
                            .iter_mut()
                            .find(|b| b.device_history_id == session.device_history_id)
                        {
                            board.summary.total_storage_bytes = match (
                                board.summary.total_storage_bytes,
                                old_storage_bytes,
                                active.session_storage_bytes,
                            ) {
                                (Some(total), Some(old), Some(new)) => {
                                    total.checked_sub(old).and_then(|v| v.checked_add(new))
                                }
                                _ => self
                                    .store
                                    .board_session_storage_bytes(
                                        &session.device_history_id,
                                        Some(&session.session_id),
                                    )
                                    .ok()
                                    .zip(active.session_storage_bytes)
                                    .and_then(|(rest, active)| rest.checked_add(active)),
                            };
                            board.summary.total_riding_elapsed_ms = board
                                .summary
                                .total_riding_elapsed_ms
                                .saturating_sub(old.riding_elapsed_ms)
                                .saturating_add(session.riding_elapsed_ms);
                            if let Some(distance) = session.distance_m {
                                board.summary.total_distance_m = Some(
                                    board.summary.total_distance_m.unwrap_or(0.)
                                        - old.distance_m.unwrap_or(0.)
                                        + distance,
                                );
                            }
                        }
                    }
                }
                RuntimeEffect::Failure(
                    float_view_application_runtime::RuntimeFailure::Persistence(error),
                ) => {
                    self.runtime_failure(
                        &float_view_application_runtime::RuntimeError::Persistence(error),
                        None,
                    );
                    self.disconnect("storage_failure")?;
                    return Err(Failure::Unavailable);
                }
                RuntimeEffect::Application(effect) => match effect {
                    c::Effect::ArmDeadline { token, timeout_ms } => {
                        self.arm_timer(Timer::Deadline(token), timeout_ms, None)?
                    }
                    c::Effect::CancelDeadline(token) => self.cancel_timer(Timer::Deadline(token)),
                    c::Effect::ReplaceTimer { token, interval_ms } => {
                        // Refloat owns periodic poll/layout timers. BMS consumes its
                        // timer on fire and schedules a new one after the response;
                        // mutation timers are also one-shot (lighting rearms itself).
                        let repeat = match token {
                            c::TimerToken::Refloat(_) => Some(interval_ms),
                            c::TimerToken::Bms(_) | c::TimerToken::Mutation(_) => None,
                        };
                        self.arm_timer(Timer::Kernel(token), interval_ms, repeat)?
                    }
                    c::Effect::CancelTimer(token) => self.cancel_timer(Timer::Kernel(token)),
                    c::Effect::PrepareActivation(facts) => {
                        let command = match self.prepare_activation(*facts) {
                            Ok(c) => c,
                            Err(e) => {
                                self.disconnect("activation_failed")?;
                                return Err(e);
                            }
                        };
                        effects.extend(self.runtime.apply(command).map_err(|_| Failure::Internal)?);
                    }
                    c::Effect::PublishState(state) => {
                        self.complete_calibration_start()?;
                        if state.phase == c::Phase::Ready {
                            if let Some(a) = self.policy.active.as_mut() {
                                a.reconnect_started = None;
                                a.reconnect_attempt = 0;
                            }
                            self.cancel_timer(Timer::Reconnect);
                            self.cancel_timer(Timer::ReconnectLimit);
                            self.cancel_timer(Timer::ConnectionAttempt);
                        }
                    }
                    c::Effect::PublishTelemetry(sample) => {
                        self.calibration.board(self.policy.exchange.now, &sample);
                        self.record_telemetry_contents(&sample);
                        self.observe_announcement(&sample);
                        self.step_announcements()?;
                        self.diagnostics.sample(
                            self.policy.exchange.now,
                            self.policy.exchange.epoch,
                            sample.sequence,
                            sample.elapsed_ms,
                            sample.ride_state == telemetry::RideState::Riding,
                        );
                        let previous = self
                            .policy
                            .active
                            .as_ref()
                            .map(|a| (a.battery.clone(), a.latest.clone(), a.latest_load));
                        self.accept_battery_sample((*sample).clone())?;
                        let level = self
                            .policy
                            .active
                            .as_ref()
                            .and_then(|a| a.battery.estimate.level);
                        let recorded = self
                            .runtime
                            .record_sample(&sample, level)
                            .map_err(|_| Failure::Internal)?;
                        if recorded
                            .iter()
                            .any(|e| matches!(e, RuntimeEffect::Failure(_)))
                            && let (Some(active), Some((battery, latest, load))) =
                                (self.policy.active.as_mut(), previous)
                        {
                            active.battery = battery;
                            active.latest = latest;
                            active.latest_load = load;
                        }
                        // Publish this commit (or stop on failure) before the next observation.
                        for effect in recorded.into_iter().rev() {
                            effects.push_front(effect);
                        }
                    }
                    c::Effect::PublishBmsObservation(sample) => {
                        if let Some(a) = self.policy.active.as_mut() {
                            a.bms = Some(*sample);
                        }
                    }
                    c::Effect::StoreRoutingHint(identity) => {
                        if let Some(b) = self.policy.active.as_ref().and_then(|a| a.board.as_ref())
                            && let Some(can_id) = identity.route.can_id()
                        {
                            self.store
                                .set_routing_hint(
                                    &b.saved_device_id,
                                    Some(&float_view_product_store::RoutingHint {
                                        can_id,
                                        controller_uuid: Some(identity.identity.controller_uuid),
                                    }),
                                    self.policy.exchange.epoch,
                                )
                                .map_err(crate::store_failure)?;
                        }
                    }
                    c::Effect::ClearRoutingHint => {
                        if let Some(b) = self.policy.active.as_ref().and_then(|a| a.board.as_ref())
                        {
                            self.store
                                .set_routing_hint(
                                    &b.saved_device_id,
                                    None,
                                    self.policy.exchange.epoch,
                                )
                                .map_err(crate::store_failure)?;
                        }
                    }
                    c::Effect::ApplyConfigurationCache(cache) => match cache.into_inner() {
                        c::configuration::CacheEffect::Store { identity, bytes } => self
                            .store
                            .store_schema(&cache_identity(identity), &bytes)
                            .map_err(crate::store_failure)?,
                        c::configuration::CacheEffect::Remove { identity } => self
                            .store
                            .remove_schema(&cache_identity(identity))
                            .map_err(crate::store_failure)?,
                    },
                    c::Effect::Failure(c::Failure::Discovery(issue)) => {
                        if let Some(active) = self.policy.active.as_mut() {
                            active.reconnect_started = None;
                        }
                        self.policy.timers.retain(|_, timer| {
                            !matches!(
                                timer.kind,
                                Timer::Reconnect
                                    | Timer::ReconnectLimit
                                    | Timer::ConnectionAttempt
                                    | Timer::BleWrite
                            )
                        });
                        self.diagnostics.event(
                            self.policy.exchange.now,
                            self.policy.exchange.epoch,
                            "failure",
                            serde_json::json!({"code":issue.code.as_str()}),
                            true,
                        );
                        self.diagnostics.capture(
                            self.policy.exchange.now,
                            self.policy.exchange.epoch,
                            "connection_failure",
                            true,
                        );
                    }
                    c::Effect::Mutation(event) => match event {
                        c::MutationEvent::Idempotent | c::MutationEvent::Confirmed(_) => {
                            self.complete_mutation(true)
                        }
                        c::MutationEvent::Failed { .. } => self.complete_mutation(false),
                        c::MutationEvent::Released(_) => {}
                    },
                    c::Effect::Failure(c::Failure::Mutation { token, reason }) => {
                        self.record_mutation_failure(token, reason);
                        self.fail_kernel_requests("mutation");
                    }
                    c::Effect::Failure(c::Failure::Configuration(error)) => {
                        self.record_configuration_contents(None);
                        self.diagnostics.configuration_failure(
                            self.policy.exchange.now,
                            self.policy.exchange.epoch,
                            &error,
                            self.runtime.snapshot().application.generation.0,
                            self.pending
                                .iter()
                                .find(|(_, p)| p.diagnostic_kind.is_some())
                                .map(|(id, _)| *id),
                        );
                        self.fail_kernel_requests("configuration");
                    }
                    c::Effect::Failure(_) => {
                        self.diagnostics.event(
                            self.policy.exchange.now,
                            self.policy.exchange.epoch,
                            "failure",
                            serde_json::json!({"code":"telemetry"}),
                            true,
                        );
                        self.diagnostics.capture(
                            self.policy.exchange.now,
                            self.policy.exchange.epoch,
                            "protocol_failure",
                            false,
                        );
                        self.fail_kernel_requests("protocol");
                    }
                    c::Effect::Diagnostic(value) => {
                        self.diagnostics.event(
                            self.policy.exchange.now,
                            self.policy.exchange.epoch,
                            "protocol_diagnostic",
                            serde_json::json!({"code":match value {
                                c::Diagnostic::StaleEvent=>"StaleEvent",c::Diagnostic::UnexpectedResponse=>"UnexpectedResponse",c::Diagnostic::MalformedResponse(_)=>"MalformedResponse",c::Diagnostic::Scheduler(_)=>"Scheduler",c::Diagnostic::Telemetry(_)=>"telemetry",c::Diagnostic::Bms(_)=>"bms",c::Diagnostic::EnqueueRejected=>"EnqueueRejected",c::Diagnostic::Mutation(_)=>"Mutation",c::Diagnostic::ConfigurationStale=>"ConfigurationStale"
                            }}),
                            true,
                        );
                        if matches!(value, c::Diagnostic::MalformedResponse(_)) {
                            self.diagnostics.capture(
                                self.policy.exchange.now,
                                self.policy.exchange.epoch,
                                "protocol_failure",
                                false,
                            );
                        }
                    }
                    c::Effect::PublishBmsState(_) => {}
                    // Framed writes and durable fault history are consumed by the runtime.
                    c::Effect::Write(_) | c::Effect::PublishFaultHistory(_) => {
                        return Err(Failure::Internal);
                    }
                },
            }
        }
        self.diagnostics.metric(
            "runtime_us",
            runtime_started.elapsed().as_micros().min(u64::MAX as u128) as u64,
        );
        for duration in self.runtime.take_persistence_timings() {
            self.diagnostics.metric("append_us", duration);
            if duration > 50_000 {
                self.diagnostics.capture(
                    self.policy.exchange.now,
                    self.policy.exchange.epoch,
                    "slow_storage",
                    false,
                );
            }
        }
        for request in self.runtime.take_request_timings() {
            self.diagnostics
                .metric("request_queue_ms", request.queue_ms);
            if request.outcome != "sent" {
                self.diagnostics
                    .metric("request_response_ms", request.response_ms);
            }
            let anomaly =
                request.outcome == "timeout" || request.queue_ms > 500 || request.response_ms > 500;
            self.record_request_diagnostic(&request, anomaly || request.kind == "configuration");
            if anomaly {
                self.diagnostics.capture(
                    self.policy.exchange.now,
                    self.policy.exchange.epoch,
                    "request_delay",
                    false,
                );
            }
        }
        self.complete_configuration();
        Ok(())
    }
    fn prepare_activation(&mut self, facts: c::ActivationFacts) -> Result<Command, Failure> {
        if facts.generation != self.runtime.snapshot().application.generation {
            return Err(Failure::InvalidState);
        }
        let a = self.policy.active.as_mut().ok_or(Failure::InvalidState)?;
        a.refloat_draft_key = Some(
            facts
                .selected
                .identity
                .controller_uuid
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect(),
        );
        if a.battery
            .controller(facts.selected.identity.controller_uuid)
        {
            a.latest = None;
            a.latest_load = Default::default();
            self.policy.announcements.invalidate();
        }
        let mut session_started = false;
        if a.saved {
            let board = self
                .store
                .ensure_board(
                    &a.device.id,
                    a.device.name.as_deref(),
                    Some(&facts.selected.identity.controller_uuid),
                    self.policy.exchange.epoch,
                )
                .map_err(crate::store_failure)?;
            a.board = Some(board.clone());
            if let Some(can_id) = a.selected_can_id.take() {
                let profile = self
                    .store
                    .profile(&board.saved_device_id)
                    .map_err(crate::store_failure)?;
                self.store
                    .update_profile(
                        &board.saved_device_id,
                        profile.revision,
                        &format!("{{\"preferredCanId\":{can_id}}}"),
                        self.policy.exchange.epoch,
                    )
                    .map_err(crate::store_failure)?;
            }
            let resume = self
                .policy
                .ride
                .as_ref()
                .filter(|r| r.paused_at_ms.is_some())
                .cloned();
            if let Some(ride) = resume.as_ref() {
                if ride.saved_device_id == board.saved_device_id
                    && ride.controller_uuid == facts.selected.identity.controller_uuid
                {
                    a.session = Some(
                        self.store
                            .session(&ride.session_id)
                            .map_err(crate::store_failure)?,
                    );
                } else {
                    if self.runtime.snapshot().session_attached {
                        self.runtime
                            .apply(Command::DetachSession)
                            .map_err(|_| Failure::Internal)?;
                    }
                    self.store
                        .close_session(
                            &ride.session_id,
                            self.policy.exchange.epoch,
                            "different_controller",
                        )
                        .map_err(crate::store_failure)?;
                    self.policy.ride = None;
                    a.session = None;
                }
            }
            if a.session.is_none() {
                a.session_start = Some(self.policy.exchange.now);
                a.session_elapsed_offset = 0;
                a.session = Some(
                    self.store
                        .create_session(
                            &board.saved_device_id,
                            self.policy.exchange.epoch,
                            self.policy.available_bytes,
                        )
                        .map_err(crate::store_failure)?,
                );
                a.continuity = c::discovery::Continuity::new(
                    true,
                    Some(facts.selected.route),
                    Some(facts.selected.identity.controller_uuid),
                );
                session_started = true;
            }
            if !self.runtime.snapshot().session_attached {
                let id = &a.session.as_ref().ok_or(Failure::Internal)?.session_id;
                self.runtime
                    .apply(Command::AttachSession {
                        path: self.store.session_path(id).map_err(crate::store_failure)?,
                        mode: SessionMode::Open,
                        metadata: session::SessionMetadata {
                            expected_riding_persistence_ms: self
                                .policy
                                .settings
                                .riding_persist_interval_ms,
                            expected_idle_persistence_ms: self
                                .policy
                                .settings
                                .idle_persist_interval_ms,
                            committed_at_epoch_ms: self.policy.exchange.epoch,
                        },
                    })
                    .map_err(|_| Failure::Internal)?;
            }
            let session = a.session.as_ref().ok_or(Failure::Internal)?;
            if resume
                .as_ref()
                .is_some_and(|r| r.session_id == session.session_id)
            {
                let elapsed = session.committed_elapsed_ms.max(
                    self.policy
                        .exchange
                        .epoch
                        .saturating_sub(session.started_at_ms)
                        .max(0) as u64,
                );
                a.session_start = Some(self.policy.exchange.now);
                a.session_elapsed_offset = elapsed;
                self.runtime.restore_recording(
                    self.policy.exchange.now,
                    elapsed,
                    session.committed_sequence,
                    session.riding_elapsed_ms,
                    session.distance_m,
                    session.max_speed_mps.map(|v| v * 3.6),
                );
            }
            let operation_id = match &a.context_activation {
                Some((generation, id)) if *generation == facts.generation.0 => id.clone(),
                _ => {
                    let mut bytes = [0u8; 16];
                    getrandom::fill(&mut bytes).map_err(|_| Failure::Unavailable)?;
                    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
                    let id = format!(
                        "{}-{}-{}-{}-{}",
                        &hex[..8],
                        &hex[8..12],
                        &hex[12..16],
                        &hex[16..20],
                        &hex[20..]
                    );
                    a.context_activation = Some((facts.generation.0, id.clone()));
                    id
                }
            };
            let firmware = |identity: &c::firmware::FirmwareIdentity| session::ContextFirmware {
                major: identity.major,
                minor: identity.minor,
                test_version: identity.test_version,
                hardware_name: Some(identity.hardware_name.clone()),
                firmware_name: identity.firmware_name.clone(),
            };
            let context = session::ConnectionContext {
                version: 1,
                refloat_version: facts.refloat_version.to_string(),
                controller: firmware(&facts.selected.identity),
                transport: firmware(&facts.transport),
                connection: facts
                    .selected
                    .route
                    .can_id()
                    .map_or(session::ContextRoute::Direct, |can_id| {
                        session::ContextRoute::Can { can_id }
                    }),
            };
            let elapsed = a.session_elapsed_offset.saturating_add(
                self.policy
                    .exchange
                    .now
                    .saturating_sub(a.session_start.unwrap_or(self.policy.exchange.now)),
            );
            let boundary = self
                .runtime
                .save_connection_context(
                    &operation_id,
                    elapsed,
                    self.policy.exchange.epoch,
                    context,
                )
                .map_err(|_| Failure::Unavailable)?;
            self.store
                .apply_session_marker(&session.session_id, &boundary)
                .map_err(crate::store_failure)?;
            a.session = Some(
                self.store
                    .session(&session.session_id)
                    .map_err(crate::store_failure)?,
            );
            let session = a.session.as_ref().ok_or(Failure::InvalidState)?;
            a.continuity = c::discovery::Continuity::new(
                true,
                Some(facts.selected.route),
                Some(facts.selected.identity.controller_uuid),
            );
            self.store
                .own_ride(
                    &session.session_id,
                    &board.saved_device_id,
                    facts.selected.identity.controller_uuid,
                    self.policy.settings.ride_resume_window_minutes,
                )
                .map_err(crate::store_failure)?;
            self.policy.ride = self.store.ride_checkpoint().map_err(crate::store_failure)?;
        }
        self.diagnostics.metadata(self.policy.exchange.now,self.policy.exchange.epoch,serde_json::json!({
            "firmware_major":facts.selected.identity.major,"firmware_minor":facts.selected.identity.minor,"package":facts.refloat_version.to_string(),"hardware":facts.selected.identity.hardware_name,"route":if facts.selected.route.can_id().is_some(){"can"}else{"direct"},
            "riding_poll_ms":telemetry::RIDING_INTERVAL_MS,"idle_poll_ms":self.policy.settings.idle_probe_interval_ms
        }));
        self.diagnostics.event(
            self.policy.exchange.now,
            self.policy.exchange.epoch,
            "activated",
            serde_json::json!({"application_generation":facts.generation.0,"new_session":session_started}),
            true,
        );
        a.package_version = Some(facts.refloat_version.to_string());
        self.cancel_timer(Timer::RideResume);
        self.refresh_boards().map_err(crate::store_failure)?;
        let cached = facts
            .configuration_cache_identity
            .map(|i| self.store.cached_schema(&cache_identity(i)))
            .transpose()
            .map_err(crate::store_failure)?
            .flatten();
        self.diagnostics.event(
            self.policy.exchange.now, self.policy.exchange.epoch, "configuration_bootstrap",
            serde_json::json!({"custom_configuration_count":facts.selected.identity.custom_configuration_count,
                "cached_schema":cached.is_some()}), true,
        );
        Ok(Command::Application(c::Command::Activate {
            generation: facts.generation,
            now_ms: self.policy.exchange.now,
            session_started,
            cached_configuration_schema: cached,
        }))
    }
    pub(crate) fn location_eligibility(&mut self) -> Result<(), Failure> {
        let generation = self.runtime.snapshot().application.generation.0;
        if self.calibration.generation != generation
            || !self
                .policy
                .active
                .as_ref()
                .is_some_and(|a| a.state == LinkState::Ready)
        {
            self.calibration = crate::calibration::Calibration::default();
        }
        if self.calibration.collecting()
            && self
                .policy
                .exchange
                .now
                .saturating_sub(self.calibration.started)
                >= crate::calibration::MAX_DURATION_MS
        {
            self.calibration.finish();
        }
        if let Some(summary) = self.calibration.diagnostic(self.policy.exchange.now) {
            self.diagnostics.event(
                self.policy.exchange.now,
                self.policy.exchange.epoch,
                if self.calibration.collecting() {
                    "calibration"
                } else {
                    "calibration_outcome"
                },
                serde_json::to_value(summary).expect("bounded calibration summary"),
                true,
            );
            if self.calibration.state.status == "insufficient" {
                self.diagnostics.capture(
                    self.policy.exchange.now,
                    self.policy.exchange.epoch,
                    "calibration_failure",
                    true,
                );
            } else if self.calibration.state.status == "ready" {
                self.diagnostics.capture(
                    self.policy.exchange.now,
                    self.policy.exchange.epoch,
                    "calibration_complete",
                    true,
                );
            }
        }
        let calibrating = self.calibration.collecting();
        let allowed = matches!(
            self.policy.location_authorization,
            os::LocationAuthorization::Authorized | os::LocationAuthorization::ForegroundOnly
        ) && (self.policy.foreground
            || (self.policy.location_background
                && self.policy.location_authorization == os::LocationAuthorization::Authorized));
        let recording = self.policy.settings.location_recording_enabled
            && self.policy.active.as_ref().is_some_and(|a| {
                a.saved
                    && a.session.is_some()
                    && a.state == LinkState::Ready
                    && a.latest
                        .as_ref()
                        .is_some_and(|s| s.ride_state == telemetry::RideState::Riding)
            });
        let enabled = allowed
            && (recording
                || (calibrating && self.runtime.snapshot().application.phase == c::Phase::Ready));
        if !allowed || !recording {
            self.policy.latest_location = None;
        }
        if self
            .policy
            .capture
            .as_ref()
            .is_some_and(|c| c.high_accuracy != calibrating)
        {
            self.policy.capture = None;
            self.policy.latest_location = None;
            self.policy.exchange.request_stop_location();
        }
        if enabled && self.policy.capture.is_none() {
            let id = self.policy.exchange.id()?;
            let start = self
                .policy
                .active
                .as_ref()
                .and_then(|a| a.session_start)
                .unwrap_or(self.policy.exchange.now);
            let offset = self
                .policy
                .active
                .as_ref()
                .map_or(0, |a| a.session_elapsed_offset);
            self.policy.capture = Some(Capture {
                id,
                start,
                offset,
                high_accuracy: calibrating,
            });
            self.policy.exchange.push(Effect::StartLocation {
                capture_id: id,
                high_accuracy: calibrating,
            })?;
        } else if !enabled && self.policy.capture.take().is_some() {
            self.policy.exchange.request_stop_location();
        }
        Ok(())
    }
}
fn cache_identity(i: c::configuration::CacheIdentity) -> SchemaIdentity {
    SchemaIdentity {
        firmware_version: i.firmware_version,
        hardware_name: i.hardware_name,
        package_version: i.package_version,
        custom_index: i.custom_index,
        hardware_configuration_crc: i.hardware_configuration_crc,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    #[test]
    fn native_and_ui_diagnostics_are_bounded_and_do_not_publish_state() {
        let mut t = Test::new();
        let revision = t.service.service_revision();
        for platform in ["ios", "macos", "android"] {
            t.fact(
                Fact::NativeDiagnostics {
                    platform: platform.into(),
                    os_version: "test".into(),
                    callbacks: 10,
                    max_queue_delay_ms: 20,
                    max_queue_depth: 2,
                    overflows: 0,
                    exchange_failures: 0,
                },
                100,
            )
            .unwrap();
        }
        t.service
            .report_ui_diagnostics(crate::diagnostics::UiReport {
                snapshots: 10,
                max_sample_age_ms: 20,
                max_delivery_gap_ms: 30,
                max_handler_ms: 1,
            })
            .unwrap();
        assert_eq!(t.service.service_revision(), revision);
        assert!(matches!(
            t.fact(
                Fact::NativeDiagnostics {
                    platform: "ios".into(),
                    os_version: "test".into(),
                    callbacks: 10,
                    max_queue_delay_ms: 20,
                    max_queue_depth: 65,
                    overflows: 0,
                    exchange_failures: 0,
                },
                100
            ),
            Err(Failure::InvalidRequest)
        ));
    }
    #[test]
    fn failed_initial_transport_captures_diagnostics_without_saved_or_guest_recordings() {
        for saved in [false, true] {
            let mut t = Test::new();
            t.discover();
            let revision = t.service.catalog_revision();
            t.service.connect("test-device", saved).unwrap();
            let generation = t.service.policy.active.as_ref().unwrap().generation;
            t.fact(
                Fact::Link {
                    generation,
                    state: LinkState::Failed,
                },
                4,
            )
            .unwrap();
            assert!(!t.service.snapshot().session_attached);
            assert_eq!(t.service.catalog_revision(), revision);
            let list = t.service.diagnostic_list();
            let incidents = list["incidents"].as_array().unwrap();
            assert!(!incidents.is_empty());
            let id = incidents[0]["incidentId"].as_str().unwrap();
            let work = t.service.begin_diagnostic_report(1, Some(id)).unwrap();
            let preview = t
                .service
                .complete_diagnostic_report(work.run().unwrap())
                .unwrap();
            assert!(!preview.complete);
            assert!(preview.summary.contains("Excludes routes"));
        }
    }
    #[test]
    fn calibration_capture_is_temporary_private_and_rejects_old_capture_facts() {
        use crate::operations::Operation;
        let mut t = Test::new();
        t.activate(true);
        t.service.policy.location_authorization = os::LocationAuthorization::Authorized;
        t.service.policy.foreground = true;
        assert!(!t.service.policy.settings.location_recording_enabled);
        t.start_calibration();
        let capture = t.service.policy.capture.as_ref().unwrap();
        assert!(capture.high_accuracy);
        let id = capture.id;
        t.fact(
            Fact::Location {
                capture_id: id,
                latitude: -33.8,
                longitude: 151.2,
                accuracy_m: Some(5.),
                altitude_m: None,
                observed_at_ms: 1_700_000_000_100,
            },
            100,
        )
        .unwrap();
        assert_eq!(
            t.service
                .runtime
                .snapshot()
                .session_marker
                .unwrap()
                .recorded_location_count,
            0
        );
        assert!(t.service.policy.latest_location.is_none());
        t.service
            .dispatch(1, Operation::CancelSpeedCalibration)
            .unwrap();
        assert!(t.service.policy.capture.is_none());
        t.fact(
            Fact::LocationSpeed {
                capture_id: id,
                speed_mps: Some(5.),
                accuracy_mps: Some(0.1),
                age_ms: 0,
            },
            110,
        )
        .unwrap();
        assert_eq!(
            t.service.published_snapshot().speed_calibration.status,
            "idle"
        );
        assert!(!t.service.policy.settings.location_recording_enabled);
    }

    #[test]
    fn calibration_deadline_and_explicit_finish_restore_capture_policy() {
        #[allow(dead_code)]
        mod samples {
            use float_view_application_runtime::telemetry as float_view_refloat_telemetry_service;
            include!("../../session-sqlite/tests/support/mod.rs");
        }
        let mut t = Test::new();
        t.activate(true);
        t.service.policy.location_authorization = os::LocationAuthorization::Authorized;
        t.service.policy.foreground = true;
        t.start_calibration();
        assert!(matches!(
            t.service
                .dispatch(1, crate::operations::Operation::FinishSpeedCalibration),
            Err(Failure::InvalidState)
        ));
        let deadline = t.service.calibration.started + crate::calibration::MAX_DURATION_MS;
        t.service.policy.exchange.now = deadline - 1;
        t.service.location_eligibility().unwrap();
        let before_deadline = t.service.published_snapshot().speed_calibration;
        assert_eq!(before_deadline.status, "collecting");
        assert_eq!(crate::calibration::MAX_DURATION_MS, 180_000);
        assert_eq!(
            t.service.published_snapshot().speed_calibration.status,
            "collecting"
        );
        t.service.policy.exchange.now = deadline;
        t.service.location_eligibility().unwrap();
        assert_eq!(
            t.service.published_snapshot().speed_calibration.status,
            "insufficient"
        );
        assert!(t.service.policy.capture.is_none());
        let incidents = t.service.diagnostic_list();
        assert_eq!(incidents["incidents"][0]["reason"], "calibration_failure");
        for recording in [false, true] {
            let mut t = Test::new();
            t.activate(true);
            t.service.policy.location_authorization = os::LocationAuthorization::Authorized;
            t.service.policy.foreground = true;
            t.service.policy.settings.location_recording_enabled = recording;
            let mut sample = samples::sample(1, 100);
            sample.ride_state = telemetry::RideState::Riding;
            sample.package_mode = Some(telemetry::PackageMode::Normal);
            sample.wheelslip = Some(false);
            sample.speed_kph = Some(18.);
            t.service.policy.active.as_mut().unwrap().latest = Some(sample.clone());
            t.start_calibration();
            let high = t.service.policy.capture.as_ref().unwrap().id;
            t.service.policy.active.as_mut().unwrap().latest = Some(sample.clone());
            for at in (1_000..=40_000).step_by(100) {
                t.service.calibration.board(at, &sample);
                if at % 1000 == 0 {
                    t.service.calibration.speed(at, 0, Some(4.8), Some(0.1));
                    t.service.policy.exchange.now = at;
                    t.service.location_eligibility().unwrap();
                }
            }
            assert_eq!(t.service.calibration.state.status, "refining");
            assert_eq!(t.service.policy.capture.as_ref().unwrap().id, high);
            assert!(t.service.policy.capture.as_ref().unwrap().high_accuracy);
            if recording {
                t.service
                    .dispatch(1, crate::operations::Operation::FinishSpeedCalibration)
                    .unwrap();
            } else {
                t.service.policy.exchange.now =
                    t.service.calibration.started + crate::calibration::MAX_DURATION_MS;
                t.service.location_eligibility().unwrap();
            }
            assert_eq!(t.service.calibration.state.status, "ready");
            assert_eq!(
                t.service.calibration.state.recommended_diameter_mm,
                Some(268.8)
            );
            if recording {
                let low = t.service.policy.capture.as_ref().unwrap();
                assert!(!low.high_accuracy);
                assert_ne!(low.id, high);
            } else {
                assert!(t.service.policy.capture.is_none());
            }
            assert_eq!(
                t.service.policy.settings.location_recording_enabled,
                recording
            );
        }
    }

    #[test]
    fn calibration_cancelling_preparation_cannot_start_capture_from_a_late_motor_read() {
        use crate::operations::Operation;
        let mut t = Test::new();
        t.activate(true);
        t.service.policy.location_authorization = os::LocationAuthorization::Authorized;
        t.service.policy.foreground = true;
        t.service
            .dispatch(1, Operation::StartSpeedCalibration { diameter_mm: 280. })
            .unwrap();
        t.service
            .dispatch(1, Operation::CancelSpeedCalibration)
            .unwrap();
        t.complete_calibration_reads();
        assert!(!t.service.calibration.collecting());
        assert!(t.service.policy.capture.is_none());
    }

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    struct Test {
        service: BackendService,
        root: PathBuf,
    }
    impl Test {
        fn new() -> Self {
            let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
                "float-view-policy-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&root).unwrap();
            Self {
                service: BackendService::open(&root).unwrap(),
                root,
            }
        }
        fn fact(&mut self, fact: Fact, now: u64) -> Result<(), Failure> {
            if let Fact::Link {
                generation,
                state: LinkState::Ready,
            } = fact
            {
                self.fact(
                    Fact::Profile {
                        generation,
                        operation: generation,
                        profile: crate::ble::Profile {
                            service: true,
                            notify: true,
                            with_response: 244,
                            without_response: 20,
                        },
                    },
                    now,
                )?;
                let operation = self.service.policy.ble.setup;
                return self.fact(
                    Fact::Notifications {
                        generation,
                        operation,
                        success: true,
                    },
                    now,
                );
            }
            let p = &self.service.policy.exchange;
            let e = os::Envelope {
                lifetime: p.lifetime,
                sequence: p.sequence + 1,
                monotonic_ms: now,
                epoch_ms: 1_700_000_000_000 + now as i64,
                fact,
            };
            self.service.apply_os(e)
        }
        fn drain(&mut self) {
            while !self.service.drain_os().effects.is_empty() {}
        }
        fn discover(&mut self) {
            let base = self.service.policy.exchange.now.max(
                self.service
                    .policy
                    .ride
                    .as_ref()
                    .and_then(|r| r.paused_at_ms)
                    .map_or(0, |v| v.saturating_sub(1_700_000_000_000).max(0) as u64),
            );
            self.fact(
                Fact::Bluetooth {
                    radio: Radio::PoweredOn,
                    scan: Permission::Granted,
                    connect: Permission::Granted,
                },
                base + 1,
            )
            .unwrap();
            self.fact(
                Fact::Storage {
                    available_bytes: 1_000_000_000,
                },
                base + 2,
            )
            .unwrap();
            let scan_id = self.service.start_scan(10_000).unwrap();
            self.fact(
                Fact::Discovered {
                    advertises_uart: true,
                    scan_id,
                    device_id: "test-device".into(),
                    name: Some("Board".into()),
                    rssi: Some(-40),
                },
                base + 3,
            )
            .unwrap();
            self.drain();
        }
        fn activate(&mut self, saved: bool) {
            self.discover();
            self.service.connect("test-device", saved).unwrap();
            let generation = self.service.policy.active.as_ref().unwrap().generation;
            self.fact(
                Fact::Link {
                    generation,
                    state: LinkState::Ready,
                },
                self.service.policy.exchange.now + 1,
            )
            .unwrap();
            self.identify();
        }
        fn start_calibration(&mut self) {
            self.service
                .dispatch(
                    1,
                    crate::operations::Operation::StartSpeedCalibration { diameter_mm: 280. },
                )
                .unwrap();
            self.complete_calibration_reads();
            assert!(self.service.calibration.collecting());
        }
        fn complete_calibration_reads(&mut self) {
            let fixtures: serde_json::Value = serde_json::from_str(include_str!(
                "../../../fixtures/refloat/protocol-1.0.0.json"
            ))
            .unwrap();
            let hex = fixtures["cases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["name"] == "legacy-idle-all-data")
                .unwrap()["frameHex"]
                .as_str()
                .unwrap();
            let bytes: Vec<u8> = (0..hex.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
                .collect();
            let mut idle = bytes[2..2 + usize::from(bytes[1])].to_vec();
            idle[10] = 14;
            for _ in 0..8 {
                let snapshot = self.service.runtime.snapshot().application;
                if !snapshot.wheel_diameter.reading {
                    return;
                }
                let request = snapshot.scheduler.in_flight.unwrap();
                let payload = match request.expected_response.command {
                    14 => {
                        let mut p = vec![14];
                        p.extend_from_slice(&0x2efd0142_u32.to_be_bytes());
                        p.extend_from_slice(&[0; 4]);
                        for v in [100_f32, -100., 50., -20.] {
                            p.extend_from_slice(&v.to_be_bytes());
                        }
                        p
                    }
                    36 => idle.clone(),
                    62 => vec![62],
                    command => panic!("unexpected preparation request {command}"),
                };
                self.service.policy.exchange.now += 1;
                self.service.policy.exchange.epoch += 1;
                self.service
                    .runtime_command(Command::Application(c::Command::Receive {
                        generation: snapshot.generation,
                        payload,
                        now_ms: self.service.policy.exchange.now,
                        observed_at_epoch_ms: self.service.policy.exchange.epoch,
                    }))
                    .unwrap();
            }
            panic!("calibration read did not complete");
        }
        fn riding_sample(&mut self, now_ms: u64) {
            let generation = self.service.runtime.snapshot().application.generation;
            if self
                .service
                .runtime
                .snapshot()
                .application
                .current_limits
                .is_none()
            {
                let mut payload = vec![14];
                payload.extend_from_slice(&0x2EFD_0142_u32.to_be_bytes());
                payload.extend_from_slice(&[0; 4]);
                for value in [100_f32, -100., 50., -20.] {
                    payload.extend_from_slice(&value.to_be_bytes());
                }
                self.service
                    .runtime_command(Command::Application(c::Command::Receive {
                        generation,
                        payload,
                        now_ms,
                        observed_at_epoch_ms: 1_700_000_000_000 + now_ms as i64,
                    }))
                    .unwrap();
            }
            if self
                .service
                .policy
                .active
                .as_ref()
                .unwrap()
                .latest
                .is_some()
            {
                let id = self
                    .service
                    .policy
                    .timers
                    .iter()
                    .find_map(|(id, timer)| {
                        matches!(timer.kind, Timer::Kernel(c::TimerToken::Refloat(_)))
                            .then_some(*id)
                    })
                    .unwrap();
                self.fact(Fact::Timer { id }, now_ms).unwrap();
            }
            let fixtures: serde_json::Value = serde_json::from_str(include_str!(
                "../../../fixtures/refloat/protocol-1.0.0.json"
            ))
            .unwrap();
            let hex = fixtures["cases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|case| case["name"] == "legacy-riding-all-data")
                .unwrap()["frameHex"]
                .as_str()
                .unwrap();
            let bytes = (0..hex.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
                .collect();
            let generation = self.service.runtime.snapshot().application.generation;
            self.service
                .runtime_command(Command::ReceiveBytes {
                    generation,
                    bytes,
                    now_ms,
                    observed_at_epoch_ms: 1_700_000_000_000 + now_ms as i64,
                })
                .unwrap();
            self.service.changed().unwrap();
        }
        fn identify(&mut self) {
            self.identify_controller([7; 12]);
        }
        fn identify_controller(&mut self, uuid: [u8; 12]) {
            let mut payload = vec![0, 6, 6];
            payload.extend_from_slice(b"THOR300\0");
            payload.extend_from_slice(&uuid);
            payload.extend_from_slice(&[1, 0, 0, 0, 1, 0, 1, 0]);
            payload.extend_from_slice(b"Float\0");
            let generation = self.service.runtime.snapshot().application.generation;
            for payload in [payload, vec![36, 101, 0, 10]] {
                self.service
                    .runtime_command(Command::Application(c::Command::Receive {
                        generation,
                        payload,
                        now_ms: self.service.policy.exchange.now,
                        observed_at_epoch_ms: self.service.policy.exchange.epoch,
                    }))
                    .unwrap();
            }
            self.drain();
        }
    }
    #[test]
    fn verified_controller_switches_keep_board_profiles_and_recordings_separate() {
        let mut t = Test::new();
        t.service.policy.settings = t
            .service
            .store
            .update_settings(0, r#"{"minimumSessionDistance":0}"#)
            .unwrap();
        t.activate(true);
        let a = t
            .service
            .policy
            .active
            .as_ref()
            .unwrap()
            .board
            .clone()
            .unwrap();
        let first_session = t.service.policy.ride.as_ref().unwrap().session_id.clone();
        let profile_a = t
            .service
            .store
            .update_profile(
                &a.saved_device_id,
                0,
                r#"{"motor":"hub","seriesCount":16,"parallelCount":2}"#,
                1,
            )
            .unwrap();
        t.fact(Fact::Foreground { foreground: true }, 100).unwrap();
        t.riding_sample(100);
        t.service.disconnect("explicit_disconnect").unwrap();

        // The same OS/Bluetooth device now identifies a different controller.
        t.discover();
        t.service.connect("test-device", true).unwrap();
        let generation = t.service.policy.active.as_ref().unwrap().generation;
        t.fact(
            Fact::Link {
                generation,
                state: LinkState::Ready,
            },
            t.service.policy.exchange.now + 1,
        )
        .unwrap();
        t.identify_controller([8; 12]);
        let b = t
            .service
            .policy
            .active
            .as_ref()
            .unwrap()
            .board
            .clone()
            .unwrap();
        let second_session = t.service.policy.ride.as_ref().unwrap().session_id.clone();
        assert_ne!(a.saved_device_id, b.saved_device_id);
        assert_ne!(first_session, second_session);
        assert_eq!(
            b.device_history_id,
            float_view_product_store::board_identity(Some(&[8; 12])).unwrap()
        );
        assert_eq!(
            t.service
                .store
                .session(&first_session)
                .unwrap()
                .device_history_id,
            a.device_history_id
        );
        assert_eq!(
            t.service.store.session(&first_session).unwrap().state,
            "completed"
        );
        assert_eq!(
            t.service
                .store
                .session(&second_session)
                .unwrap()
                .device_history_id,
            b.device_history_id
        );
        assert_eq!(
            t.service.store.profile(&a.saved_device_id).unwrap(),
            profile_a
        );
        assert!(
            !t.service
                .store
                .profile(&b.saved_device_id)
                .unwrap()
                .missing_fields()
                .is_empty()
        );
        let state = t.service.published_snapshot();
        assert_eq!(
            state
                .saved_boards
                .iter()
                .find(|board| board.saved_device_id == a.saved_device_id)
                .unwrap()
                .bluetooth_identifier,
            None
        );
        assert_eq!(
            state
                .saved_boards
                .iter()
                .find(|board| board.saved_device_id == b.saved_device_id)
                .unwrap()
                .bluetooth_identifier
                .as_deref(),
            Some("test-device")
        );
        assert_eq!(
            state
                .active
                .unwrap()
                .saved_device
                .as_ref()
                .map(|board| board.saved_device_id.as_str()),
            Some(b.saved_device_id.as_str())
        );
        let now = t.service.policy.exchange.now + 100;
        t.fact(Fact::Foreground { foreground: true }, now).unwrap();
        t.riding_sample(now);
        t.service.disconnect("explicit_disconnect").unwrap();

        // Returning to the first controller uses its old profile without conflict.
        t.activate(true);
        assert_eq!(
            t.service
                .policy
                .active
                .as_ref()
                .unwrap()
                .board
                .as_ref()
                .unwrap()
                .saved_device_id,
            a.saved_device_id
        );
        let third_session = t
            .service
            .store
            .session(&t.service.policy.ride.as_ref().unwrap().session_id)
            .unwrap();
        assert_eq!(third_session.device_history_id, a.device_history_id);
        assert_eq!(third_session.profile_snapshot["seriesCount"], 16);
        assert_eq!(
            t.service
                .store
                .session(&second_session)
                .unwrap()
                .device_history_id,
            b.device_history_id
        );
        assert_eq!(
            t.service
                .store
                .board(&b.saved_device_id)
                .unwrap()
                .local_identifier,
            None
        );
        assert_eq!(t.service.store.boards().unwrap().len(), 2);
    }

    #[test]
    fn unsupported_refloat_snapshot_survives_link_loss_without_recovery_or_session() {
        for saved in [false, true] {
            let mut t = Test::new();
            t.discover();
            t.service.connect("test-device", saved).unwrap();
            let link_generation = t.service.policy.active.as_ref().unwrap().generation;
            t.fact(
                Fact::Link {
                    generation: link_generation,
                    state: LinkState::Ready,
                },
                4,
            )
            .unwrap();
            let mut firmware = vec![0, 6, 6];
            firmware.extend_from_slice(b"THOR300\0");
            firmware.extend_from_slice(&[7; 12]);
            firmware.extend_from_slice(&[1, 0, 0, 0, 1, 0, 1, 0]);
            firmware.extend_from_slice(b"Float\0");
            let mut info = vec![0; 61];
            info[..5].copy_from_slice(&[36, 101, 0, 2, 0]);
            info[5..12].copy_from_slice(b"refloat");
            info[25..28].copy_from_slice(&[1, 3, 1]);
            info[28..32].copy_from_slice(b"beta");
            let generation = t.service.runtime.snapshot().application.generation;
            // A rejection during an existing recovery must supersede its presentation and timers.
            t.service.policy.active.as_mut().unwrap().reconnect_started = Some(4);
            t.service
                .arm_timer(Timer::ReconnectLimit, 1_000, None)
                .unwrap();
            for payload in [firmware, info] {
                t.service
                    .runtime_command(Command::Application(c::Command::Receive {
                        generation,
                        payload,
                        now_ms: 5,
                        observed_at_epoch_ms: 1_700_000_000_005,
                    }))
                    .unwrap();
            }
            let snapshot = t.service.published_snapshot();
            let active = snapshot.active.unwrap();
            assert_eq!(active.state, "failed");
            assert!(active.active_session.is_none());
            let issue = active.connection_issue.unwrap();
            assert_eq!(issue.code, "unsupported_refloat");
            let compatibility = issue.refloat_compatibility.unwrap();
            assert_eq!(compatibility.reported_version, "1.3.1-beta");
            assert_eq!(
                compatibility.supported_versions.len(),
                c::compatibility::SUPPORTED_VERSIONS.len()
            );
            assert!(
                compatibility
                    .supported_versions
                    .contains(&"1.3.x".to_string())
            );
            t.fact(
                Fact::Link {
                    generation: link_generation,
                    state: LinkState::Disconnected,
                },
                6,
            )
            .unwrap();
            assert_eq!(
                t.service.published_snapshot().active.unwrap().state,
                "failed"
            );
            assert!(
                !t.service
                    .policy
                    .timers
                    .values()
                    .any(|timer| matches!(timer.kind, Timer::Reconnect | Timer::ReconnectLimit))
            );
            assert_eq!(
                t.service.runtime.snapshot().application.generation,
                generation
            );
            t.service.connect("test-device", saved).unwrap();
            assert!(
                t.service
                    .published_snapshot()
                    .active
                    .unwrap()
                    .connection_issue
                    .is_none()
            );
        }
    }

    #[test]
    fn refloat_poll_timer_keeps_repeating_without_a_response() {
        let mut t = Test::new();
        t.activate(false);
        for _ in 0..3 {
            let (id, due, kind, interval) = t
                .service
                .policy
                .timers
                .iter()
                .find_map(|(id, timer)| match timer.kind {
                    Timer::Kernel(c::TimerToken::Refloat(token))
                        if token.kind == telemetry::TimerKind::Poll =>
                    {
                        Some((*id, timer.due, timer.kind, timer.repeat.unwrap()))
                    }
                    _ => None,
                })
                .expect("periodic Refloat poll");
            t.fact(Fact::Timer { id }, due).unwrap();
            assert!(!t.service.policy.timers.contains_key(&id));
            let replacement = t
                .service
                .policy
                .timers
                .values()
                .find(|timer| timer.kind == kind)
                .expect("poll rearmed");
            assert_eq!(replacement.due, due + interval);
            t.drain();
        }
    }

    #[test]
    fn completed_bms_polls_do_not_accumulate_host_timers() {
        let mut t = Test::new();
        t.discover();
        t.service.connect("test-device", false).unwrap();
        let generation = t.service.policy.active.as_ref().unwrap().generation;
        t.fact(
            Fact::Link {
                generation,
                state: LinkState::Ready,
            },
            4,
        )
        .unwrap();
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../../fixtures/vesc-bms/source-derived.json"
        ))
        .unwrap();
        let payload = |name: &str| {
            let hex = fixtures["cases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|case| case["name"] == name)
                .unwrap()["payloadHex"]
                .as_str()
                .unwrap();
            (0..hex.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
                .collect::<Vec<_>>()
        };
        let mut now = 10;
        for cycle in 0..32 {
            // Complete host writes before delivering the device response.
            for effect in t.service.drain_os().effects {
                if let Effect::Write {
                    generation,
                    operation,
                    ..
                } = effect
                {
                    for progress in [
                        crate::ble::Progress::Submitted,
                        crate::ble::Progress::Acknowledged,
                    ] {
                        t.fact(
                            Fact::WriteProgress {
                                generation,
                                operation,
                                progress,
                            },
                            now,
                        )
                        .unwrap();
                    }
                }
            }
            t.service.policy.exchange.now = now;
            t.service
                .runtime_command(Command::Application(c::Command::Receive {
                    generation: t.service.runtime.snapshot().application.generation,
                    payload: payload(if cycle == 0 {
                        "vbms32-firmware-6.06"
                    } else {
                        "vbms-values-legacy-typical"
                    }),
                    now_ms: now,
                    observed_at_epoch_ms: 1_700_000_000_000 + now as i64,
                }))
                .unwrap();
            if cycle == 0 {
                now += 100;
                continue;
            }
            let timers: Vec<_> = t
                .service
                .policy
                .timers
                .iter()
                .filter(|(_, timer)| matches!(timer.kind, Timer::Kernel(c::TimerToken::Bms(_))))
                .map(|(id, timer)| (*id, timer.due))
                .collect();
            assert_eq!(timers.len(), 1, "BMS poll {cycle} leaked a host timer");
            let (id, due) = timers[0];
            t.fact(Fact::Timer { id }, due).unwrap();
            assert!(
                !t.service
                    .policy
                    .timers
                    .values()
                    .any(|timer| matches!(timer.kind, Timer::Kernel(c::TimerToken::Bms(_)))),
                "a consumed BMS timer must stay disarmed while its request is in flight"
            );
            now = due + 100;
        }
    }

    #[test]
    fn live_activity_tracks_ready_boards_coalesces_telemetry_and_ends_on_disconnect() {
        #[allow(dead_code)]
        mod samples {
            use float_view_application_runtime::telemetry as float_view_refloat_telemetry_service;
            include!("../../session-sqlite/tests/support/mod.rs");
        }
        for saved in [false, true] {
            let mut t = Test::new();
            assert!(t.service.live_activity().is_none());
            t.activate(saved);
            t.service.changed().unwrap();
            let initial = t.service.live_activity().unwrap();
            assert!(initial.percentage.is_none());
            assert!(initial.battery_voltage.is_none());
            t.drain();
            t.service.policy.settings.unit_preference = "imperial".into();
            for sequence in 1..=100 {
                let mut sample = samples::sample(sequence, sequence * 100);
                sample.duty_cycle = Some(0.42);
                sample.package_state =
                    Some(float_view_application_runtime::telemetry::PackageState::Ready);
                sample.footpad_state =
                    Some(float_view_application_runtime::telemetry::FootpadState::Left);
                sample.speed_kph = Some(3.);
                sample.distance_m = Some(0.); // Board trip counter restarted.
                sample.ride_distance_m = sequence as f64;
                sample.battery_level = Some(0.67);
                sample.pack_voltage_v = Some(75.56);
                sample.controller_temp_c = Some(42.);
                sample.motor_temp_c = Some(54.);
                t.service.accept_battery_sample(sample).unwrap();
                t.service.changed().unwrap();
            }
            let effects = t.service.drain_os().effects;
            let states: Vec<_> = effects
                .iter()
                .filter_map(|e| match e {
                    Effect::LiveActivity { state } => Some(state),
                    _ => None,
                })
                .collect();
            assert_eq!(states.len(), 1);
            let state = states[0].as_ref().unwrap();
            assert_eq!(state.source.as_deref(), Some("duty"));
            assert_eq!(state.percentage, Some(42.));
            assert_eq!(state.status.as_deref(), Some("Stopped"));
            assert_eq!(
                state.footpad_left,
                crate::live_activity::FootpadIndicator::Active
            );
            assert_eq!(
                state.footpad_right,
                crate::live_activity::FootpadIndicator::Warning
            );
            assert_eq!(state.distance_meters, Some(100.));
            assert_eq!(
                t.service
                    .published_snapshot()
                    .active
                    .unwrap()
                    .latest_sample
                    .unwrap()
                    .distance_m,
                state.distance_meters
            );
            assert_eq!(state.battery_percent, if saved { Some(67.) } else { None });
            assert_eq!(state.battery_voltage, Some(75.56));
            assert_eq!(state.highest_temperature_c, Some(54.));
            assert_eq!(state.temperature_source.as_deref(), Some("Motor"));
            assert_eq!(
                serde_json::to_value(state).unwrap()["battery_voltage"],
                75.56
            );
            assert!(state.imperial);
            assert!(
                !effects
                    .iter()
                    .any(|e| matches!(e, Effect::HostState { .. }))
            );
            t.service.disconnect("user").unwrap();
            assert!(t.service.live_activity().is_none());
            assert!(
                t.service
                    .drain_os()
                    .effects
                    .iter()
                    .any(|e| matches!(e, Effect::LiveActivity { state: None }))
            );
        }
    }

    #[test]
    fn live_activity_survives_background_reconnect_but_ends_when_abandoned() {
        for saved in [false, true] {
            let mut t = Test::new();
            t.activate(saved);
            t.service.changed().unwrap();
            let generation = t.service.live_activity().unwrap().generation;
            t.fact(Fact::Foreground { foreground: false }, 100).unwrap();
            t.service.reconnect().unwrap();
            t.service.changed().unwrap();
            let reconnecting = t.service.live_activity().unwrap();
            assert_eq!(reconnecting.generation, generation);
            assert_eq!(reconnecting.status.as_deref(), Some("Reconnecting"));
            assert_eq!(reconnecting.observed_at, None);
            assert_eq!(reconnecting.percentage, None);
            assert_eq!(reconnecting.battery_voltage, None);
            assert_eq!(
                reconnecting.footpad_left,
                crate::live_activity::FootpadIndicator::Neutral
            );
            let due = t
                .service
                .policy
                .timers
                .iter()
                .find(|(_, timer)| timer.kind == Timer::Reconnect)
                .map(|(id, timer)| (*id, timer.due))
                .unwrap();
            t.fact(Fact::Timer { id: due.0 }, due.1).unwrap();
            let next = t.service.policy.active.as_ref().unwrap().generation;
            assert_ne!(next, generation);
            assert_eq!(t.service.live_activity().unwrap().generation, generation);
            t.fact(
                Fact::Link {
                    generation: next,
                    state: LinkState::Ready,
                },
                due.1 + 1,
            )
            .unwrap();
            t.identify();
            assert_eq!(t.service.live_activity().unwrap().generation, generation);
            assert_ne!(
                t.service.live_activity().unwrap().status.as_deref(),
                Some("Reconnecting")
            );
            t.service.reconnect().unwrap();
            t.service.changed().unwrap();
            let limit = t
                .service
                .policy
                .timers
                .iter()
                .find(|(_, timer)| timer.kind == Timer::ReconnectLimit)
                .map(|(id, timer)| (*id, timer.due))
                .unwrap();
            t.fact(Fact::Timer { id: limit.0 }, limit.1).unwrap();
            assert!(t.service.live_activity().is_none());
            t.activate(saved);
            t.service.changed().unwrap();
            assert_ne!(t.service.live_activity().unwrap().generation, generation);
        }
    }

    #[test]
    fn live_activity_does_not_start_during_initial_discovery() {
        let mut t = Test::new();
        t.discover();
        t.service.connect("test-device", false).unwrap();
        assert!(t.service.live_activity().is_none());
        t.service.reconnect().unwrap();
        t.service.changed().unwrap();
        assert!(t.service.live_activity().is_none());
    }

    #[test]
    fn ride_markers_are_session_scoped_and_survive_reconnect_and_close() {
        use crate::{dispatch::Dispatch, facts::Completion, operations::Operation};
        let mut t = Test::new();
        t.activate(true);
        let id = t
            .service
            .policy
            .active
            .as_ref()
            .unwrap()
            .session
            .as_ref()
            .unwrap()
            .session_id
            .clone();
        let operation = || Operation::AddRideMarker {
            session_id: id.clone(),
            operation_id: "00000000-0000-4000-8000-000000000001".into(),
        };
        let Dispatch::Complete(first) = t.service.dispatch(1, operation()).unwrap() else {
            panic!("pending")
        };
        let Completion::RideMarker { marker, .. } = *first else {
            panic!("marker")
        };
        let Dispatch::Complete(retry) = t.service.dispatch(1, operation()).unwrap() else {
            panic!("pending")
        };
        let Completion::RideMarker {
            marker: repeated, ..
        } = *retry
        else {
            panic!("marker")
        };
        assert_eq!(marker, repeated);
        t.service.reconnect().unwrap();
        assert!(t.service.dispatch(1, operation()).is_ok());
        assert!(
            t.service
                .dispatch(
                    1,
                    Operation::AddRideMarker {
                        session_id: "other".into(),
                        operation_id: marker.operation_id.clone()
                    }
                )
                .is_err()
        );
        t.service.disconnect("test").unwrap();
        assert!(
            t.service.store.session(&id).is_ok(),
            "An idle marked session is retained"
        );
        assert!(t.service.dispatch(1, operation()).is_err());
    }

    impl Drop for Test {
        fn drop(&mut self) {
            let _ = self.service.disconnect("test");
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
    #[test]
    fn revision_exhaustion_and_oversize_notifications_reject_before_mutation() {
        let mut t = Test::new();
        t.discover();
        let revision = t.service.service_revision();
        let sequence = t.service.policy.exchange.sequence;
        assert!(matches!(
            t.fact(
                Fact::Bytes {
                    generation: 0,
                    bytes: vec![0; 8193]
                },
                4
            ),
            Err(Failure::InvalidRequest)
        ));
        assert_eq!(t.service.policy.exchange.sequence, sequence);
        assert_eq!(t.service.service_revision(), revision);
        t.service.policy.revision = 9_007_199_254_740_991 - 65_536;
        assert!(matches!(
            t.service.connect("test-device", true),
            Err(Failure::Unavailable)
        ));
        assert!(t.service.policy.active.is_none());
        assert!(t.service.store.boards().unwrap().is_empty());
    }
    #[test]
    fn shutdown_is_accepted_immediately_and_link_loss_does_not_reconnect() {
        let mut t = Test::new();
        t.activate(false);
        let document: serde_json::Value = serde_json::from_str(include_str!(
            "../../../fixtures/refloat/protocol-1.0.0.json"
        ))
        .unwrap();
        let hex = document["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["name"] == "legacy-idle-all-data")
            .unwrap()["frameHex"]
            .as_str()
            .unwrap();
        let bytes: Vec<u8> = (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
            .collect();
        let generation = t.service.policy.active.as_ref().unwrap().generation;
        for now in (1000..=10000).step_by(1000) {
            let due: Vec<_> = t
                .service
                .policy
                .timers
                .iter()
                .filter(|(_, timer)| timer.due <= now)
                .map(|(id, _)| *id)
                .collect();
            for id in due {
                t.fact(Fact::Timer { id }, now).unwrap();
            }
            t.fact(
                Fact::Bytes {
                    generation,
                    bytes: bytes.clone(),
                },
                now,
            )
            .unwrap();
            t.drain();
            if t.service
                .runtime
                .snapshot()
                .application
                .mutations
                .controller_actions
                .shutdown_available
            {
                break;
            }
        }
        assert!(matches!(
            t.service
                .dispatch(1, crate::operations::Operation::ShutdownController)
                .unwrap(),
            crate::Dispatch::Complete(_)
        ));
        assert!(
            t.service
                .runtime
                .snapshot()
                .application
                .mutations
                .controller_actions
                .shutdown_pending
        );
        t.fact(
            Fact::Link {
                generation,
                state: LinkState::Disconnected,
            },
            10001,
        )
        .unwrap();
        assert!(t.service.policy.active.is_none());
        assert!(
            !t.service
                .policy
                .timers
                .values()
                .any(|timer| timer.kind == Timer::Reconnect)
        );
    }
    #[test]
    fn reconnect_deadline_expires_even_without_an_os_failure_callback() {
        let mut t = Test::new();
        t.activate(true);
        let generation = t.service.policy.active.as_ref().unwrap().generation;
        t.fact(
            Fact::Link {
                generation,
                state: LinkState::Disconnected,
            },
            100,
        )
        .unwrap();
        let deadline = *t
            .service
            .policy
            .timers
            .iter()
            .find(|(_, v)| v.kind == Timer::ReconnectLimit)
            .unwrap()
            .0;
        t.fact(Fact::Timer { id: deadline }, 300_100).unwrap();
        assert!(t.service.policy.active.is_none());
        assert!(!t.service.runtime.snapshot().session_attached);
    }
    #[test]
    fn location_capture_uses_session_clock_and_revocation_rejects_late_observations() {
        #[allow(dead_code)]
        mod samples {
            use float_view_application_runtime::telemetry as float_view_refloat_telemetry_service;
            include!("../../session-sqlite/tests/support/mod.rs");
        }
        let mut t = Test::new();
        t.activate(true);
        t.service.policy.settings.location_recording_enabled = true;
        let mut sample = samples::sample(1, 100);
        sample.ride_state = telemetry::RideState::Riding;
        t.service.policy.active.as_mut().unwrap().latest = Some(sample);
        t.fact(
            Fact::Permissions {
                observation: crate::permissions::Observation {
                    location: crate::permissions::Grant {
                        access: Permission::Granted,
                        requestable: false,
                        rationale: false,
                    },
                    scope: crate::permissions::Scope::Always,
                    location_services: Some(true),
                    ..crate::permissions::Observation::unknown(crate::permissions::Platform::Ios)
                },
            },
            100,
        )
        .unwrap();
        let capture_id = t.service.policy.capture.as_ref().unwrap().id;
        t.fact(
            Fact::Location {
                capture_id,
                latitude: -33.8,
                longitude: 151.2,
                accuracy_m: Some(5.),
                altitude_m: Some(-8.),
                observed_at_ms: 1_700_000_000_110,
            },
            110,
        )
        .unwrap();
        assert_eq!(
            t.service
                .runtime
                .snapshot()
                .session_marker
                .unwrap()
                .recorded_location_count,
            1
        );
        assert_eq!(
            t.service
                .policy
                .latest_location
                .as_ref()
                .unwrap()
                .altitude_m,
            Some(-8.)
        );
        let session_id = t
            .service
            .policy
            .active
            .as_ref()
            .unwrap()
            .session
            .as_ref()
            .unwrap()
            .session_id
            .clone();
        let save = |service: &mut BackendService, n: u64| {
            let crate::dispatch::Dispatch::Complete(result) = service
                .dispatch(
                    1,
                    crate::operations::Operation::AddRideMarker {
                        session_id: session_id.clone(),
                        operation_id: format!("00000000-0000-4000-8000-{n:012x}"),
                    },
                )
                .unwrap()
            else {
                panic!("pending")
            };
            let crate::facts::Completion::RideMarker { marker, .. } = *result else {
                panic!("marker")
            };
            marker
        };
        let marker = save(&mut t.service, 1);
        let session_start = t
            .service
            .policy
            .active
            .as_ref()
            .unwrap()
            .session_start
            .unwrap();
        assert_eq!(marker.elapsed_ms, 110 - session_start);
        assert_eq!(
            marker.location.as_ref().unwrap().elapsed_ms,
            marker.elapsed_ms
        );
        // Restart capture without changing the ride clock.
        // The next location must stay aligned with markers and telemetry.
        t.service.policy.capture = None;
        t.service.location_eligibility().unwrap();
        let resumed_capture = t.service.policy.capture.as_ref().unwrap().id;
        t.fact(
            Fact::Location {
                capture_id: resumed_capture,
                latitude: -33.81,
                longitude: 151.21,
                accuracy_m: Some(5.),
                altitude_m: None,
                observed_at_ms: 1_700_000_000_111,
            },
            111,
        )
        .unwrap();
        assert_eq!(
            t.service
                .runtime
                .snapshot()
                .session_marker
                .unwrap()
                .committed_location_elapsed_ms,
            111 - session_start
        );
        t.fact(Fact::Foreground { foreground: false }, 111).unwrap();
        assert!(t.service.policy.capture.is_some());
        t.fact(
            Fact::Permissions {
                observation: crate::permissions::Observation {
                    location: crate::permissions::Grant {
                        access: Permission::Granted,
                        requestable: false,
                        rationale: false,
                    },
                    scope: crate::permissions::Scope::WhileInUse,
                    location_services: Some(true),
                    ..crate::permissions::Observation::unknown(crate::permissions::Platform::Ios)
                },
            },
            112,
        )
        .unwrap();
        assert!(t.service.policy.capture.is_none());
        t.fact(
            Fact::Location {
                capture_id,
                latitude: -33.9,
                longitude: 151.3,
                accuracy_m: None,
                altitude_m: Some(42.),
                observed_at_ms: 1_700_000_000_113,
            },
            113,
        )
        .unwrap();
        assert_eq!(
            t.service
                .runtime
                .snapshot()
                .session_marker
                .unwrap()
                .recorded_location_count,
            2
        );
        assert!(t.service.policy.latest_location.is_none());
        t.fact(Fact::Foreground { foreground: false }, 700).unwrap();
        assert!(save(&mut t.service, 2).location.is_none());
        t.service.policy.settings.location_recording_enabled = false;
        t.fact(Fact::Foreground { foreground: true }, 1_300)
            .unwrap();
        assert!(save(&mut t.service, 3).location.is_none());
    }
    #[test]
    fn temporal_charge_survives_identity_only_edits_and_rejected_mutations() {
        #[allow(dead_code)]
        mod samples {
            use float_view_application_runtime::telemetry as float_view_refloat_telemetry_service;
            include!("../../session-sqlite/tests/support/mod.rs");
        }
        use crate::battery_estimator::Method;
        let mut t = Test::new();
        t.activate(true);
        let id = t
            .service
            .policy
            .active
            .as_ref()
            .unwrap()
            .board
            .as_ref()
            .unwrap()
            .saved_device_id
            .clone();
        let mut profile = t
            .service
            .store
            .update_profile(
                &id,
                0,
                r#"{"batteryPresetId":"fungineers-funwheel-x7s-molicel-p30b"}"#,
                1,
            )
            .unwrap();
        profile = t
            .service
            .store
            .update_profile(
                &id,
                profile.revision,
                r#"{"batteryCapacityAh":9,"batteryMinimumCellVoltageV":2.7}"#,
                2,
            )
            .unwrap();
        let mut sample = samples::sample(1, 0);
        sample.pack_voltage_v = Some(78.);
        sample.battery_current_a = Some(60.);
        t.service.policy.exchange.now = 0;
        t.service.accept_battery_sample(sample.clone()).unwrap();
        t.service.changed().unwrap();
        sample.sequence = 2;
        sample.pack_voltage_v = Some(63.);
        t.service.policy.exchange.now = 1000;
        t.service.accept_battery_sample(sample.clone()).unwrap();
        t.service.changed().unwrap();
        let tracked = t
            .service
            .published_snapshot()
            .active
            .unwrap()
            .battery_estimate;
        assert_eq!(tracked.method, Some(Method::ChargeIntegrated));
        assert!((tracked.level.unwrap() - (0.8 - 1. / 540.)).abs() < 1e-12);
        // A burst must account for every accepted current pair before publication.
        sample.sequence = 3;
        sample.battery_current_a = Some(0.);
        t.service.policy.exchange.now = 1500;
        t.service.accept_battery_sample(sample.clone()).unwrap();
        sample.sequence = 4;
        sample.battery_current_a = Some(60.);
        t.service.policy.exchange.now = 2000;
        t.service.accept_battery_sample(sample.clone()).unwrap();
        t.service.changed().unwrap();
        let burst = t
            .service
            .published_snapshot()
            .active
            .unwrap()
            .battery_estimate;
        assert!((burst.level.unwrap() - (tracked.level.unwrap() - 30. / 32400.)).abs() < 1e-12);
        let tracked = burst;
        // Same effective settings, different named identity; no charge reset.
        profile = t
            .service
            .store
            .update_profile(
                &id,
                profile.revision,
                r#"{"batteryPresetId":null,"motor":"custom"}"#,
                3,
            )
            .unwrap();
        t.service.changed().unwrap();
        assert_eq!(
            t.service
                .published_snapshot()
                .active
                .unwrap()
                .battery_estimate
                .level,
            tracked.level
        );
        assert!(
            t.service
                .store
                .update_profile(&id, profile.revision, r#"{"batteryCapacityAh":0}"#, 4)
                .is_err()
        );
        assert!(
            t.service
                .store
                .update_profile(&id, 0, r#"{"batteryCapacityAh":8}"#, 4)
                .is_err()
        );
        t.service.changed().unwrap();
        assert_eq!(
            t.service
                .published_snapshot()
                .active
                .unwrap()
                .battery_estimate
                .level,
            tracked.level
        );
        // Reordered time and duplicate sequence leave the accepted sample/state intact.
        sample.sequence = 3;
        t.service.policy.exchange.now = 999;
        t.service.accept_battery_sample(sample.clone()).unwrap();
        t.service.changed().unwrap();
        assert_eq!(
            t.service
                .published_snapshot()
                .active
                .unwrap()
                .battery_estimate
                .level,
            tracked.level
        );
        sample.sequence = 2;
        t.service.policy.exchange.now = 1100;
        t.service.accept_battery_sample(sample.clone()).unwrap();
        t.service.changed().unwrap();
        assert_eq!(
            t.service
                .published_snapshot()
                .active
                .unwrap()
                .battery_estimate
                .level,
            tracked.level
        );
        profile = t
            .service
            .store
            .update_profile(&id, profile.revision, r#"{"batteryCapacityAh":null}"#, 5)
            .unwrap();
        t.service.changed().unwrap();
        let cleared = t
            .service
            .published_snapshot()
            .active
            .unwrap()
            .battery_estimate;
        assert_eq!(cleared.profile_revision, Some(profile.revision));
        assert!((cleared.level.unwrap() - 0.3).abs() < 1e-12);
        assert_eq!(cleared.method, Some(Method::VoltageSmoothed));
        // Controller replacement cannot retain the old controller's charge or sample.
        let b = &mut t.service.policy.active.as_mut().unwrap().battery;
        b.controller([1; 12]);
        assert!(b.controller([2; 12]));
        assert!(b.estimate.level.is_none());
    }

    #[test]
    fn battery_estimates_follow_accepted_samples_configuration_and_reconnect() {
        #[allow(dead_code)]
        mod samples {
            use float_view_application_runtime::telemetry as float_view_refloat_telemetry_service;
            include!("../../session-sqlite/tests/support/mod.rs");
        }
        use crate::battery_estimator::UnavailableReason;
        let mut t = Test::new();
        t.activate(true);
        let id = t
            .service
            .policy
            .active
            .as_ref()
            .unwrap()
            .board
            .as_ref()
            .unwrap()
            .saved_device_id
            .clone();
        let profile = t.service.store.update_profile(&id, 0,
            r#"{"seriesCount":20.0,"parallelCount":2.0,"batteryCellProfileId":"molicel-p45b","batteryMinimumCellVoltageV":2.7}"#, 5).unwrap();
        t.service.changed().unwrap();
        let mut sample = samples::sample(1, 100);
        sample.pack_voltage_v = Some(72.1);
        sample.battery_current_a = Some(20.);
        sample.battery_level = Some(0.8);
        t.service.policy.exchange.now = 100;
        t.service.accept_battery_sample(sample.clone()).unwrap();
        t.service.changed().unwrap();
        let first = t.service.published_snapshot().active.unwrap();
        assert!((first.battery_estimate.level.unwrap() - 0.5).abs() < 1e-12);
        assert_eq!(first.latest_sample.unwrap().battery_level, Some(0.8));
        // Reading/recreating clients and unrelated publications never advance the filter.
        t.service.changed().unwrap();
        assert_eq!(
            t.service
                .published_snapshot()
                .active
                .unwrap()
                .battery_estimate,
            first.battery_estimate
        );
        sample.pack_voltage_v = Some(60.);
        t.service.accept_battery_sample(sample.clone()).unwrap();
        t.service.changed().unwrap();
        assert_eq!(
            t.service
                .published_snapshot()
                .active
                .unwrap()
                .battery_estimate,
            first.battery_estimate
        );
        t.service.reconnect().unwrap();
        t.service.changed().unwrap();
        assert_eq!(
            t.service
                .published_snapshot()
                .active
                .unwrap()
                .battery_estimate,
            first.battery_estimate
        );
        // Edit during reconnect recomputes old sample, then the next generation retains that seed without counting the disconnect.
        let edited = t
            .service
            .store
            .update_profile(
                &id,
                profile.revision,
                r#"{"batteryMinimumCellVoltageV":3.23}"#,
                6,
            )
            .unwrap();
        t.service.changed().unwrap();
        assert_eq!(
            t.service
                .published_snapshot()
                .active
                .unwrap()
                .battery_estimate
                .profile_revision,
            Some(edited.revision)
        );
        sample.sequence = 1;
        sample.pack_voltage_v = Some(75.5);
        sample.battery_current_a = None;
        t.service.accept_battery_sample(sample.clone()).unwrap();
        t.service.changed().unwrap();
        assert!(
            (t.service
                .published_snapshot()
                .active
                .unwrap()
                .battery_estimate
                .level
                .unwrap()
                - (0.5 - 0.1) / 0.9)
                .abs()
                < 1e-12
        );
        sample.sequence = 2;
        sample.pack_voltage_v = None;
        t.service.accept_battery_sample(sample).unwrap();
        t.service.changed().unwrap();
        assert_eq!(
            t.service
                .published_snapshot()
                .active
                .unwrap()
                .battery_estimate
                .unavailable_reason,
            Some(UnavailableReason::MissingVoltage)
        );
        t.service.disconnect("test").unwrap();
        t.service.connect("test-device", false).unwrap();
        t.service.changed().unwrap();
        let estimate = t
            .service
            .published_snapshot()
            .active
            .unwrap()
            .battery_estimate;
        assert_eq!(estimate.level, None);
        assert_eq!(
            estimate.unavailable_reason,
            Some(UnavailableReason::NotApplicable)
        );
    }
    #[test]
    fn saved_activation_attaches_before_ready_and_guest_never_creates_storage() {
        for saved in [false, true] {
            let mut t = Test::new();
            t.activate(saved);
            assert_eq!(
                t.service.runtime.snapshot().application.phase,
                c::Phase::Ready
            );
            assert_eq!(t.service.runtime.snapshot().session_attached, saved);
            if saved {
                let id = &t
                    .service
                    .policy
                    .active
                    .as_ref()
                    .unwrap()
                    .session
                    .as_ref()
                    .unwrap()
                    .session_id;
                let mut reader =
                    session::SessionReader::open(t.service.store.session_path(id).unwrap())
                        .unwrap();
                let boundary = reader.marker().unwrap();
                let contexts = reader.connection_contexts((&boundary).into()).unwrap();
                assert_eq!(contexts.len(), 1);
                assert_eq!(boundary.recorded_sample_count, 0);
                assert_eq!(contexts[0].context.refloat_version, "1.0");
                let text = serde_json::to_string(&contexts).unwrap();
                assert!(!text.contains("controllerUuid"));
            }

            assert_eq!(t.service.store.boards().unwrap().len(), usize::from(saved));
            if saved {
                let active = t.service.policy.active.as_ref().unwrap();
                let expected = active.session_storage_bytes.unwrap();
                assert!(expected > 0);
                assert_eq!(
                    t.service.published_snapshot().saved_boards[0]
                        .summary
                        .total_storage_bytes,
                    Some(expected)
                );
            }
            assert_eq!(
                t.service
                    .store
                    .sessions(None, 100, None, false)
                    .unwrap()
                    .items
                    .len(),
                usize::from(saved)
            );
        }
    }
    #[test]
    fn stale_os_lifetimes_sequences_connections_and_timers_do_not_activate() {
        let mut t = Test::new();
        t.discover();
        t.service.connect("test-device", true).unwrap();
        let generation = t.service.policy.active.as_ref().unwrap().generation;
        t.fact(
            Fact::Link {
                generation: generation + 1,
                state: LinkState::Ready,
            },
            4,
        )
        .unwrap();
        assert_eq!(
            t.service.runtime.snapshot().application.phase,
            c::Phase::Disconnected
        );
        let e = os::Envelope {
            lifetime: 0,
            sequence: 100,
            monotonic_ms: 100,
            epoch_ms: 100,
            fact: Fact::Link {
                generation,
                state: LinkState::Ready,
            },
        };
        assert!(t.service.apply_os(e).is_err());
        t.fact(Fact::Timer { id: u64::MAX }, 5).unwrap();
        assert!(!t.service.runtime.snapshot().session_attached);
        assert!(
            t.service
                .apply_os_json(br#"{"lifetime":1,"unexpected":true}"#)
                .is_err()
        );
    }
    #[test]
    fn first_scan_requests_permission_before_radio_readiness() {
        let mut t = Test::new();
        t.fact(
            Fact::Bluetooth {
                radio: Radio::Unknown,
                scan: Permission::NotDetermined,
                connect: Permission::NotDetermined,
            },
            1,
        )
        .unwrap();
        assert!(matches!(
            t.service.start_scan(5_000),
            Err(Failure::PermissionRequired)
        ));
        assert!(t.service.policy.scan.is_none());
        t.fact(
            Fact::Bluetooth {
                radio: Radio::Unknown,
                scan: Permission::Granted,
                connect: Permission::Granted,
            },
            2,
        )
        .unwrap();
        assert!(matches!(
            t.service.start_scan(5_000),
            Err(Failure::Unavailable)
        ));
        t.fact(
            Fact::Bluetooth {
                radio: Radio::PoweredOn,
                scan: Permission::Granted,
                connect: Permission::Granted,
            },
            3,
        )
        .unwrap();
        assert!(t.service.start_scan(5_000).is_ok());
    }

    #[test]
    fn unchanged_discovery_ticks_preserve_revision_but_scan_expiry_publishes() {
        let mut t = Test::new();
        t.discover();
        let revision = t.service.service_revision();
        for now in [253, 503, 753, 10_003] {
            let id = *t
                .service
                .policy
                .timers
                .iter()
                .find(|(_, timer)| timer.kind == Timer::Discovery)
                .unwrap()
                .0;
            t.fact(Fact::Timer { id }, now).unwrap();
            if now < 10_003 {
                assert_eq!(t.service.service_revision(), revision);
            }
        }
        assert!(t.service.service_revision() > revision);
        assert!(t.service.policy.scan.is_none());
    }

    #[test]
    fn discovery_is_bounded_and_scan_deadline_is_service_owned() {
        let mut t = Test::new();
        t.discover();
        let scan_id = t.service.policy.scan.unwrap().0;
        for n in 0..60 {
            t.fact(
                Fact::Discovered {
                    advertises_uart: true,
                    scan_id,
                    device_id: format!("device-{n}"),
                    name: None,
                    rssi: Some(-60),
                },
                10 + n,
            )
            .unwrap();
        }
        assert_eq!(t.service.policy.devices.len(), 50);
        let id = *t
            .service
            .policy
            .timers
            .iter()
            .find(|(_, v)| v.kind == Timer::Discovery)
            .unwrap()
            .0;
        t.fact(Fact::Timer { id }, 10_002).unwrap();
        assert!(t.service.policy.scan.is_none());
        assert!(
            t.service
                .drain_os()
                .effects
                .iter()
                .any(|e| matches!(e, Effect::StopScan))
        );
    }
    #[test]
    fn storage_failure_never_publishes_ready_or_attaches_guest_writer() {
        let mut t = Test::new();
        t.discover();
        t.fact(Fact::Storage { available_bytes: 0 }, 4).unwrap();
        t.service.connect("test-device", true).unwrap();
        let generation = t.service.policy.active.as_ref().unwrap().generation;
        t.fact(
            Fact::Link {
                generation,
                state: LinkState::Ready,
            },
            5,
        )
        .unwrap();
        let mut payload = vec![0, 6, 6];
        payload.extend_from_slice(b"THOR300\0");
        payload.extend_from_slice(&[7; 12]);
        payload.extend_from_slice(&[1, 0, 0, 0, 1, 0, 1, 0]);
        payload.extend_from_slice(b"Float\0");
        let generation = t.service.runtime.snapshot().application.generation;
        t.service
            .runtime_command(Command::Application(c::Command::Receive {
                generation,
                payload,
                now_ms: 5,
                observed_at_epoch_ms: 1_700_000_000_005,
            }))
            .unwrap();
        assert!(
            t.service
                .runtime_command(Command::Application(c::Command::Receive {
                    generation,
                    payload: vec![36, 101, 0, 10],
                    now_ms: 5,
                    observed_at_epoch_ms: 1_700_000_000_005
                }))
                .is_err()
        );
        assert!(!t.service.runtime.snapshot().session_attached);
        assert!(t.service.policy.active.is_none());
        assert!(
            t.service
                .store
                .sessions(None, 100, None, false)
                .unwrap()
                .items
                .is_empty()
        );
    }
    #[test]
    fn failed_context_commit_prevents_saved_reactivation_and_preserves_history() {
        let mut t = Test::new();
        t.activate(true);
        let id = t
            .service
            .policy
            .active
            .as_ref()
            .unwrap()
            .session
            .as_ref()
            .unwrap()
            .session_id
            .clone();
        let path = t.service.store.session_path(&id).unwrap();
        let (_, marker) = t
            .service
            .runtime
            .save_ride_marker(
                "00000000-0000-4000-8000-000000000001",
                0,
                t.service.policy.exchange.epoch,
                false,
            )
            .unwrap();
        t.service.store.apply_session_marker(&id, &marker).unwrap();

        t.service.reconnect().unwrap();
        let (timer, due) = t
            .service
            .policy
            .timers
            .iter()
            .find(|(_, entry)| entry.kind == Timer::Reconnect)
            .map(|(id, entry)| (*id, entry.due))
            .unwrap();
        t.fact(Fact::Timer { id: timer }, due).unwrap();
        let generation = t.service.policy.active.as_ref().unwrap().generation;
        t.fact(
            Fact::Link {
                generation,
                state: LinkState::Ready,
            },
            due + 1,
        )
        .unwrap();
        let mut firmware = vec![0, 6, 6];
        firmware.extend_from_slice(b"THOR300\0");
        firmware.extend_from_slice(&[7; 12]);
        firmware.extend_from_slice(&[1, 0, 0, 0, 1, 0, 1, 0]);
        firmware.extend_from_slice(b"Float\0");
        let generation = t.service.runtime.snapshot().application.generation;
        t.service
            .runtime_command(Command::Application(c::Command::Receive {
                generation,
                payload: firmware,
                now_ms: due + 1,
                observed_at_epoch_ms: 1_700_000_000_000 + due as i64 + 1,
            }))
            .unwrap();
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch("CREATE TRIGGER reject_context BEFORE INSERT ON session_event WHEN NEW.kind='connectionContext' BEGIN SELECT RAISE(ABORT,'failure'); END;").unwrap();
        assert!(
            t.service
                .runtime_command(Command::Application(c::Command::Receive {
                    generation,
                    payload: vec![36, 101, 0, 10],
                    now_ms: due + 1,
                    observed_at_epoch_ms: 1_700_000_000_000 + due as i64 + 1
                }))
                .is_err()
        );
        assert!(
            t.service
                .policy
                .active
                .as_ref()
                .is_none_or(|a| a.state != LinkState::Ready)
        );
        db.execute_batch("DROP TRIGGER reject_context;").unwrap();
        drop(db);
        let mut reader = session::SessionReader::open(&path).unwrap();
        let boundary = reader.marker().unwrap();
        assert_eq!(
            reader
                .connection_contexts((&boundary).into())
                .unwrap()
                .len(),
            1
        );
        assert_eq!(boundary.recorded_sample_count, 0);
    }

    #[test]
    fn can_snapshot_keeps_gateway_identity_separate_from_motor_firmware() {
        let mut t = Test::new();
        t.discover();
        t.service.connect("test-device", true).unwrap();
        let generation = t.service.policy.active.as_ref().unwrap().generation;
        t.fact(
            Fact::Link {
                generation,
                state: LinkState::Ready,
            },
            4,
        )
        .unwrap();
        let mut gateway = vec![0, 6, 6];
        gateway.extend_from_slice(b"VESC Express T\0");
        gateway.extend_from_slice(&[2; 12]);
        gateway.extend_from_slice(&[1, 0, 5, 1, 1, 0, 1, 0]);
        gateway.extend_from_slice(b"VESC Express\0");
        let mut motor = vec![0, 6, 6];
        motor.extend_from_slice(b"Thor300\0");
        motor.extend_from_slice(&[7; 12]);
        motor.extend_from_slice(&[1, 0, 0, 0, 1, 0, 1, 0]);
        motor.extend_from_slice(b"Float\0");
        for payload in [
            gateway,
            vec![62, 1],
            motor,
            vec![50, 0, 2, 0, 0, 1],
            vec![36, 101, 0, 10],
        ] {
            let generation = t.service.runtime.snapshot().application.generation;
            t.service
                .runtime_command(Command::Application(c::Command::Receive {
                    generation,
                    payload,
                    now_ms: t.service.policy.exchange.now,
                    observed_at_epoch_ms: t.service.policy.exchange.epoch,
                }))
                .unwrap();
        }
        let snapshot = t.service.published_snapshot();
        assert_eq!(
            snapshot.firmware.unwrap().hardware_name.as_deref(),
            Some("Thor300")
        );
        let transport = snapshot.active.unwrap().transport_firmware.unwrap();
        assert_eq!(transport.hardware_name.as_deref(), Some("VESC Express T"));
        assert_eq!(transport.firmware_name.as_deref(), Some("VESC Express"));
        assert_eq!(transport.vesc_version, "6.06");
        assert_eq!(transport.test_version, 0);
        let public = serde_json::to_value(&transport).unwrap();
        assert!(public.get("controllerUuid").is_none());
        assert!(public.get("address").is_none());
        let active = t.service.policy.active.as_ref().unwrap();
        let id = &active.session.as_ref().unwrap().session_id;
        let mut reader =
            session::SessionReader::open(t.service.store.session_path(id).unwrap()).unwrap();
        let boundary = reader.marker().unwrap();
        let contexts = reader.connection_contexts((&boundary).into()).unwrap();
        assert_eq!(contexts.len(), 1);
        assert_eq!(
            contexts[0].context.transport.firmware_name.as_deref(),
            Some("VESC Express")
        );
        assert_eq!(
            contexts[0].context.controller.hardware_name.as_deref(),
            Some("Thor300")
        );
        assert!(matches!(
            contexts[0].context.connection,
            session::ContextRoute::Can { can_id: 1 }
        ));
    }

    #[test]
    fn stable_firmware_remains_read_write_when_configuration_is_unavailable() {
        let mut t = Test::new();
        t.activate(false);
        let snapshot = t.service.published_snapshot();
        assert_eq!(snapshot.configuration.availability, "unavailable");
        assert!(!snapshot.configuration.writable);
        assert_eq!(snapshot.firmware.unwrap().access_mode, "readWrite");
    }

    #[test]
    fn editor_state_tracks_connection_lifetime_and_background_link_loss() {
        use serde_json::json;
        for foreground in [true, false] {
            let mut t = Test::new();
            t.activate(false);
            let active = t.service.policy.active.as_ref().unwrap();
            let key = active.refloat_draft_key.clone().unwrap();
            let generation = active.generation;
            let draft = serde_json::from_value::<float_view_product_store::RefloatEditorDraft>(json!({
                "version":1,"identity":{"packageName":"refloat","packageVersion":"1.3.0","schemaFingerprint":"a".repeat(64),"wireSignature":123},
                "source":"current","values":{"gain":{"type":"double","value":1.2}},"inputs":{},
                "position":{"sectionKey":"Ride","search":"gain","controlsExpanded":false,"scrollTop":123}
            })).unwrap();
            t.service
                .store
                .set_refloat_editor_draft(&key, &draft, 10)
                .unwrap();
            let other = "aa".repeat(12);
            t.service
                .store
                .set_refloat_editor_draft(&other, &draft, 10)
                .unwrap();
            t.service.set_ui_checkpoint(json!({"version":1,"route":{"kind":"live"},"live":{"deviceId":"test-device","mode":"normal"},"surface":{"kind":"refloatConfiguration"}})).unwrap();
            t.fact(Fact::Foreground { foreground }, 90).unwrap();
            // Ordinary backgrounding while still connected retains both checkpoints.
            assert!(
                t.service
                    .store
                    .refloat_editor_draft(&key)
                    .unwrap()
                    .is_some()
            );
            assert!(t.service.ui_checkpoint().is_some());
            t.fact(
                Fact::Link {
                    generation,
                    state: LinkState::Disconnected,
                },
                100,
            )
            .unwrap();
            assert_eq!(
                t.service
                    .store
                    .refloat_editor_draft(&key)
                    .unwrap()
                    .is_some(),
                foreground
            );
            assert_eq!(t.service.ui_checkpoint().is_some(), foreground);
            assert!(matches!(
                t.service
                    .set_refloat_editor_draft("test-device", 1, draft.clone()),
                Err(Failure::InvalidState)
            ));
            if foreground {
                // Moving an already disconnected connection into the background also clears it.
                t.fact(Fact::Foreground { foreground: false }, 101).unwrap();
                assert!(
                    t.service
                        .store
                        .refloat_editor_draft(&key)
                        .unwrap()
                        .is_none()
                );
            }
            t.service
                .store
                .set_refloat_editor_draft(&key, &draft, 102)
                .unwrap();
            t.service.disconnect("reconnect_timeout").unwrap();
            assert!(
                t.service
                    .store
                    .refloat_editor_draft(&key)
                    .unwrap()
                    .is_none()
            );
            assert!(t.service.ui_checkpoint().is_none());
            assert!(
                t.service
                    .store
                    .refloat_editor_draft(&other)
                    .unwrap()
                    .is_some()
            );
        }
    }

    #[test]
    fn resume_expiry_does_not_shorten_bluetooth_retries() {
        let mut t = Test::new();
        t.activate(true);
        t.service.policy.settings = t
            .service
            .store
            .update_settings(0, r#"{"rideResumeWindowMinutes":1}"#)
            .unwrap();
        t.service.reconnect().unwrap();
        let id = t.service.policy.ride.as_ref().unwrap().session_id.clone();
        let deadline = t
            .service
            .policy
            .ride
            .as_ref()
            .unwrap()
            .resume_until_ms
            .unwrap();
        t.fact(
            Fact::Storage {
                available_bytes: 1_000_000_000,
            },
            (deadline - 1_700_000_000_000) as u64,
        )
        .unwrap();
        assert!(t.service.policy.ride.is_none());
        assert!(t.service.policy.active.as_ref().unwrap().session.is_none());
        assert!(
            t.service
                .policy
                .active
                .as_ref()
                .unwrap()
                .reconnect_started
                .is_some()
        );
        assert!(
            t.service
                .policy
                .timers
                .values()
                .any(|timer| timer.kind == Timer::Reconnect)
        );
        assert!(matches!(
            t.service.store.session(&id),
            Err(float_view_product_store::Error::NotFound)
        ));
    }
    #[test]
    fn persisted_interruption_causes_follow_user_actions_and_automatic_recovery() {
        #[allow(dead_code)]
        mod samples {
            use float_view_application_runtime::telemetry as float_view_refloat_telemetry_service;
            include!("../../session-sqlite/tests/support/mod.rs");
        }
        for (action, expected) in [
            ("explicit_disconnect", session::InterruptionReason::Pause),
            ("native_stop_requested", session::InterruptionReason::Pause),
            (
                "connection_loss",
                session::InterruptionReason::ConnectionLoss,
            ),
            ("service_shutdown", session::InterruptionReason::Unknown),
            ("pause_during_recovery", session::InterruptionReason::Pause),
        ] {
            let mut t = Test::new();
            t.activate(true);
            let id = t.service.policy.ride.as_ref().unwrap().session_id.clone();
            let mut sample = samples::sample(1, 0);
            sample.observed_at_epoch_ms = t.service.policy.exchange.epoch;
            t.service.runtime.record_sample(&sample, None).unwrap();
            let marker = t.service.runtime.snapshot().session_marker.unwrap();
            t.service.store.apply_session_marker(&id, &marker).unwrap();
            if matches!(action, "connection_loss" | "pause_during_recovery") {
                t.service.reconnect().unwrap();
            }
            if action != "connection_loss" {
                t.service
                    .disconnect(if action == "pause_during_recovery" {
                        "explicit_disconnect"
                    } else {
                        action
                    })
                    .unwrap();
                // The reason must already be durable before any resumed sample.
                let db =
                    rusqlite::Connection::open(t.service.store.session_path(&id).unwrap()).unwrap();
                let reason: String = db.query_row("SELECT json_extract(details_json,'$.reason') FROM session_event WHERE kind='recordingInterrupted' ORDER BY sequence DESC LIMIT 1", [], |r| r.get(0)).unwrap();
                assert_eq!(
                    serde_json::from_value::<session::InterruptionReason>(serde_json::json!(
                        reason
                    ))
                    .unwrap(),
                    expected
                );
                drop(db);
                if action == "explicit_disconnect" {
                    let replacement = samples::TestDirectory::new();
                    let old = std::mem::replace(
                        &mut t.service,
                        BackendService::open(replacement.path()).unwrap(),
                    );
                    drop(old);
                    t.service = BackendService::open(&t.root).unwrap();
                }
                t.activate(true);
            }
            sample.sequence = 2;
            sample.elapsed_ms = 10_000;
            sample.observed_at_epoch_ms += 10_000;
            t.service.runtime.record_sample(&sample, None).unwrap();
            let mut reader =
                session::SessionReader::open(t.service.store.session_path(&id).unwrap()).unwrap();
            let marker = reader.marker().unwrap();
            assert_eq!(
                reader.recording_breaks((&marker).into()).unwrap()[0].reason,
                expected,
                "{action}"
            );
        }
    }

    mod disconnect_failures {
        include!("../tests/policy/disconnect.rs");
    }

    #[test]
    fn explicit_pause_resume_restart_and_end_keep_one_ride() {
        let mut t = Test::new();
        t.activate(true);
        let id = t.service.policy.ride.as_ref().unwrap().session_id.clone();
        t.riding_sample(100);
        t.riding_sample(1100);
        let distance = t
            .service
            .published_snapshot()
            .active
            .unwrap()
            .latest_sample
            .unwrap()
            .distance_m
            .unwrap();
        assert!(distance > 0.0);
        let peak = t
            .service
            .published_snapshot()
            .active
            .unwrap()
            .latest_sample
            .unwrap()
            .max_speed_kph
            .unwrap();
        assert!(peak > 0.0);
        assert_eq!(
            t.service.store.session(&id).unwrap().max_speed_mps,
            Some(peak / 3.6)
        );
        assert_eq!(
            t.service.store.session(&id).unwrap().distance_m,
            Some(distance)
        );
        t.service.disconnect("explicit_disconnect").unwrap();
        assert!(t.service.policy.active.is_none());
        assert_eq!(
            t.service
                .published_snapshot()
                .paused_ride
                .unwrap()
                .session_id,
            id
        );
        // Replacing the shared owner leaves the paused ride recoverable.
        let old = std::mem::replace(
            &mut t.service,
            BackendService::open(&{
                let path = t.root.with_extension("replacement");
                std::fs::create_dir(&path).unwrap();
                path
            })
            .unwrap(),
        );
        drop(old);
        t.service = BackendService::open(&t.root).unwrap();
        t.activate(true);
        assert_eq!(
            t.service
                .policy
                .active
                .as_ref()
                .unwrap()
                .session
                .as_ref()
                .unwrap()
                .session_id,
            id
        );
        assert!(t.service.published_snapshot().paused_ride.is_none());
        t.riding_sample(10_000);
        let snapshot = t.service.published_snapshot().active.unwrap();
        let latest = snapshot.latest_sample.unwrap();
        assert_eq!(latest.distance_m, Some(distance));
        assert_eq!(latest.max_speed_kph, Some(peak));
        assert_eq!(
            t.service.live_activity().unwrap().distance_meters,
            Some(distance)
        );
        t.riding_sample(11_000);
        let snapshot = t.service.published_snapshot().active.unwrap();
        assert!(snapshot.latest_sample.unwrap().distance_m.unwrap() > distance);
        let mut reader =
            session::SessionReader::open(t.service.store.session_path(&id).unwrap()).unwrap();
        let boundary = reader.marker().unwrap();
        let contexts = reader.connection_contexts((&boundary).into()).unwrap();
        assert_eq!(contexts.len(), 2);
        assert_eq!(
            contexts[0].context.refloat_version,
            contexts[1].context.refloat_version
        );
        assert_ne!(contexts[0].operation_id, contexts[1].operation_id);
        assert!(contexts[1].elapsed_ms >= contexts[0].elapsed_ms);
        drop(reader);
        t.service.end_ride(&id).unwrap();
        assert!(t.service.policy.active.is_none());
        assert!(t.service.policy.ride.is_none());
        assert!(matches!(
            t.service.end_ride(&id),
            Err(Failure::InvalidState)
        ));
        std::fs::remove_dir_all(t.root.with_extension("replacement")).unwrap();
    }
    #[test]
    fn pause_expiry_and_wrong_controller_do_not_resume_old_recording() {
        let mut t = Test::new();
        t.activate(true);
        let id = t.service.policy.ride.as_ref().unwrap().session_id.clone();
        t.service.disconnect("explicit_disconnect").unwrap();
        let deadline = t
            .service
            .policy
            .ride
            .as_ref()
            .unwrap()
            .resume_until_ms
            .unwrap();
        t.service.policy.exchange.epoch = deadline;
        t.service.expire_paused_ride().unwrap();
        assert!(t.service.policy.ride.is_none());
        t.activate(true);
        assert_ne!(t.service.policy.ride.as_ref().unwrap().session_id, id);
        t.service.disconnect("explicit_disconnect").unwrap();
        let r = t.service.policy.ride.clone().unwrap();
        // A different controller at the same Bluetooth endpoint cannot inherit the ride.
        let db = rusqlite::Connection::open(t.root.join("catalog.sqlite")).unwrap();
        db.execute(
            "UPDATE ride_checkpoint SET controller_uuid=?",
            [&[8u8; 12][..]],
        )
        .unwrap();
        drop(db);
        t.service.policy.ride = t.service.store.ride_checkpoint().unwrap();
        t.activate(true);
        assert_ne!(
            t.service.policy.ride.as_ref().unwrap().session_id,
            r.session_id
        );
    }
    #[test]
    fn reconnect_preserves_session_identity_and_old_timer_cannot_disconnect_new_connection() {
        let mut t = Test::new();
        t.activate(true);
        let session = t
            .service
            .policy
            .active
            .as_ref()
            .unwrap()
            .session
            .as_ref()
            .unwrap()
            .session_id
            .clone();
        let generation = t.service.policy.active.as_ref().unwrap().generation;
        t.fact(
            Fact::Link {
                generation,
                state: LinkState::Disconnected,
            },
            100,
        )
        .unwrap();
        let timer = *t
            .service
            .policy
            .timers
            .iter()
            .find(|(_, t)| t.kind == Timer::Reconnect)
            .unwrap()
            .0;
        t.fact(Fact::Timer { id: timer }, 1_100).unwrap();
        let next = t.service.policy.active.as_ref().unwrap().generation;
        assert_ne!(next, generation);
        t.fact(
            Fact::Link {
                generation: next,
                state: LinkState::Ready,
            },
            1_101,
        )
        .unwrap();
        t.identify();
        assert_eq!(
            t.service
                .policy
                .active
                .as_ref()
                .unwrap()
                .session
                .as_ref()
                .unwrap()
                .session_id,
            session
        );
        let mut reader =
            session::SessionReader::open(t.service.store.session_path(&session).unwrap()).unwrap();
        let boundary = reader.marker().unwrap();
        let contexts = reader.connection_contexts((&boundary).into()).unwrap();
        assert_eq!(contexts.len(), 2);
        assert_eq!(
            contexts[0].context.refloat_version,
            contexts[1].context.refloat_version
        );
        assert!(contexts[1].elapsed_ms >= 1_000);
        drop(reader);

        t.fact(Fact::Timer { id: timer }, 1_102).unwrap();
        t.fact(
            Fact::Link {
                generation,
                state: LinkState::Disconnected,
            },
            1_103,
        )
        .unwrap();
        assert!(
            t.service
                .policy
                .active
                .as_ref()
                .unwrap()
                .reconnect_started
                .is_none()
        );
    }
    #[test]
    fn cleanup_reserve_remains_available_at_effect_saturation() {
        let mut t = Test::new();
        t.activate(true);
        while t.service.policy.exchange.push(Effect::StopScan).is_ok() {}
        assert!(t.service.policy.exchange.admit().is_err());
        t.service.disconnect("explicit").unwrap();
        assert!(!t.service.runtime.snapshot().session_attached);
        let effects = t.service.drain_os().effects;
        assert!(
            effects
                .iter()
                .any(|e| matches!(e, Effect::Disconnect { .. }))
        );
        assert!(effects.iter().any(|e| matches!(e, Effect::StopLocation)));
        assert!(
            effects
                .iter()
                .any(|e| matches!(e, Effect::CancelConnectionTimers))
        );
    }
    #[test]
    fn ble_setup_and_write_deadlines_reject_late_success_and_failure_is_once() {
        let mut t = Test::new();
        t.discover();
        t.service.connect("test-device", false).unwrap();
        let generation = t.service.policy.ble.generation;
        t.fact(
            Fact::Profile {
                generation,
                operation: generation,
                profile: crate::ble::Profile {
                    service: true,
                    notify: true,
                    with_response: 20,
                    without_response: 20,
                },
            },
            4,
        )
        .unwrap();
        let operation = t.service.policy.ble.setup;
        t.fact(
            Fact::Notifications {
                generation,
                operation,
                success: true,
            },
            10_003,
        )
        .unwrap();
        assert!(!t.service.policy.ble.ready);
        assert_eq!(
            t.service.policy.active.as_ref().unwrap().state,
            LinkState::Disconnected
        );
        let reconnect_due = t
            .service
            .policy
            .timers
            .values()
            .find(|t| t.kind == Timer::Reconnect)
            .unwrap()
            .due;
        t.fact(
            Fact::Link {
                generation,
                state: LinkState::Failed,
            },
            10_004,
        )
        .unwrap();
        assert_eq!(
            t.service
                .policy
                .timers
                .values()
                .find(|t| t.kind == Timer::Reconnect)
                .unwrap()
                .due,
            reconnect_due
        );

        let mut t = Test::new();
        t.discover();
        t.service.connect("test-device", false).unwrap();
        let generation = t.service.policy.ble.generation;
        t.fact(
            Fact::Link {
                generation,
                state: LinkState::Ready,
            },
            4,
        )
        .unwrap();
        t.service.cancel_timer(Timer::ConnectionAttempt);
        let due = t
            .service
            .policy
            .timers
            .values()
            .find(|t| t.kind == Timer::BleWrite)
            .unwrap()
            .due;
        let mut write = None;
        loop {
            let effects = t.service.drain_os().effects;
            if effects.is_empty() {
                break;
            }
            for e in effects {
                if let Effect::Write { operation, .. } = e {
                    write = Some(operation);
                }
            }
        }
        let revision = t.service.policy.revision;
        t.fact(Fact::Clock {}, due).unwrap();
        assert!(t.service.policy.revision > revision);
        t.fact(
            Fact::WriteProgress {
                generation,
                operation: write.unwrap(),
                progress: crate::ble::Progress::Acknowledged,
            },
            due,
        )
        .unwrap();
        assert_eq!(t.service.policy.ble.generation, 0);
        assert_eq!(
            t.service.policy.active.as_ref().unwrap().state,
            LinkState::Disconnected
        );
    }

    #[test]
    fn ble_failure_cleans_up_even_at_saturation_and_foreign_results_do_not_progress() {
        let mut t = Test::new();
        t.discover();
        t.service.connect("test-device", false).unwrap();
        let generation = t.service.policy.ble.generation;
        t.fact(
            Fact::Profile {
                generation,
                operation: generation,
                profile: crate::ble::Profile {
                    service: true,
                    notify: true,
                    with_response: 20,
                    without_response: 20,
                },
            },
            4,
        )
        .unwrap();
        let operation = t.service.policy.ble.setup;
        t.fact(
            Fact::Notifications {
                generation,
                operation: operation + 1,
                success: true,
            },
            5,
        )
        .unwrap();
        assert!(!t.service.policy.ble.ready);
        while t
            .service
            .policy
            .exchange
            .push(Effect::Scan { scan_id: 1 })
            .is_ok()
        {}
        t.fact(
            Fact::Notifications {
                generation,
                operation,
                success: false,
            },
            6,
        )
        .unwrap();
        assert_eq!(t.service.policy.ble.generation, 0);
        assert!(
            t.service
                .drain_os()
                .effects
                .iter()
                .any(|e| matches!(e, Effect::Disconnect { generation: g } if *g == generation))
        );
    }
    mod announcement_playback {
        include!("../tests/policy/announcements.rs");
    }
    #[test]
    fn announcements_combine_fresh_values_keep_cooldown_and_cancel_stale_speech() {
        #[allow(dead_code)]
        mod samples {
            use float_view_application_runtime::telemetry as float_view_refloat_telemetry_service;
            include!("../../session-sqlite/tests/support/mod.rs");
        }
        use crate::announcements::*;
        let mut t = Test::new();
        t.activate(false);
        t.drain();
        t.service.policy.announcements.audio = AudioState {
            status: Readiness::Ready,
            reason: None,
            lowering_control: Lowering::Adjustable,
            voice_settings_available: false,
        };
        let settings = &mut t.service.policy.settings.announcements;
        settings.speed_enabled = true;
        settings.load_enabled = true;
        let mut sample = samples::sample(1, 100);
        sample.duty_cycle = Some(0.8);
        sample.speed_kph = Some(-32.);
        t.service.policy.exchange.now = 100;
        t.service.observe_announcement(&sample);
        t.service.step_announcements().unwrap();
        let effects = t.service.drain_os().effects;
        let speech = effects
            .iter()
            .find_map(|e| {
                if let Effect::Speak { speech } = e {
                    Some(speech.clone())
                } else {
                    None
                }
            })
            .unwrap();
        assert_eq!(
            speech.load.as_ref().unwrap().source,
            float_view_application_runtime::load::Source::Duty
        );
        assert_eq!(speech.load.as_ref().unwrap().percent, 80);
        assert_eq!(speech.speed, Some(32));
        assert!(matches!(
            t.service.test_announcement(7, TestKind::Combined),
            Err(Failure::InvalidState)
        ));
        t.fact(Fact::Clock {}, 2100).unwrap();
        assert!(
            t.service
                .drain_os()
                .effects
                .iter()
                .any(|e| matches!(e,Effect::CancelSpeech{id} if *id==speech.id))
        );
        t.service.complete_speech(speech.id, Outcome::Finished);
        t.service.policy.exchange.now = 3000;
        t.service.observe_announcement(&sample);
        t.service.step_announcements().unwrap();
        assert!(
            !t.service
                .drain_os()
                .effects
                .iter()
                .any(|e| matches!(e, Effect::Speak { .. }))
        );
        t.service.policy.exchange.now = 5100;
        t.service.observe_announcement(&sample);
        t.service.step_announcements().unwrap();
        assert!(
            t.service
                .drain_os()
                .effects
                .iter()
                .any(|e| matches!(e, Effect::Speak { .. }))
        );
    }
    #[test]
    fn announcement_tests_repeat_after_completion_but_never_overlap() {
        use crate::announcements::*;
        let mut t = Test::new();
        t.service
            .policy
            .settings
            .announcements
            .repeat_interval_seconds = 60;
        t.service.policy.announcements.audio.status = Readiness::Ready;
        for (index, kind) in [
            TestKind::Speed,
            TestKind::Speed,
            TestKind::Combined,
            TestKind::Load,
        ]
        .into_iter()
        .enumerate()
        {
            let now = (index as u64 + 1) * 100;
            t.service.policy.exchange.now = now;
            let crate::Dispatch::Pending(mut receiver) =
                t.service.test_announcement(7, kind).unwrap()
            else {
                panic!("pending")
            };
            let speech_id = t
                .service
                .drain_os()
                .effects
                .into_iter()
                .find_map(|effect| {
                    if let Effect::Speak { speech } = effect {
                        Some(speech.id)
                    } else {
                        None
                    }
                })
                .unwrap();
            assert!(matches!(
                t.service.test_announcement(7, TestKind::Speed),
                Err(Failure::InvalidState)
            ));
            t.service.complete_speech(speech_id, Outcome::Finished);
            assert!(matches!(
                receiver.try_recv().unwrap().unwrap(),
                crate::facts::Completion::Announcement {
                    outcome: Outcome::Finished
                }
            ));
            assert!(t.service.pending.is_empty());
        }
    }
    #[test]
    fn announcement_tests_have_one_terminal_outcome_and_client_scoped_cancellation() {
        use crate::announcements::*;
        let mut t = Test::new();
        t.service.policy.announcements.audio = AudioState {
            status: Readiness::Ready,
            reason: None,
            lowering_control: Lowering::Adjustable,
            voice_settings_available: false,
        };
        let crate::Dispatch::Pending(mut receiver) =
            t.service.test_announcement(7, TestKind::Combined).unwrap()
        else {
            panic!("pending")
        };
        let speech = t
            .service
            .drain_os()
            .effects
            .into_iter()
            .find_map(|e| {
                if let Effect::Speak { speech } = e {
                    Some(speech)
                } else {
                    None
                }
            })
            .unwrap();
        assert_eq!(speech.load.unwrap().percent, 72);
        assert_eq!(speech.speed, Some(25));
        t.service.disconnect_client(8);
        assert!(receiver.try_recv().is_err());
        t.service.disconnect_client(7);
        assert!(matches!(
            receiver.try_recv().unwrap().unwrap(),
            crate::facts::Completion::Announcement {
                outcome: Outcome::Interrupted
            }
        ));
        t.service.complete_speech(speech.id, Outcome::Finished);
        assert!(t.service.pending.is_empty());
        t.service.policy.exchange.now = 5000;
        let crate::Dispatch::Pending(mut receiver) =
            t.service.test_announcement(9, TestKind::Load).unwrap()
        else {
            panic!("pending")
        };
        t.fact(Fact::Clock {}, 15000).unwrap();
        assert!(matches!(
            receiver.try_recv().unwrap().unwrap(),
            crate::facts::Completion::Announcement {
                outcome: Outcome::Unavailable
            }
        ));
        assert!(t.service.pending.is_empty());
    }
    #[test]
    fn announcement_settings_reject_unsupported_lowering_without_partial_writes() {
        let mut t = Test::new();
        let mut a = t.service.policy.settings.announcements.clone();
        a.lower_other_audio = false;
        a.speed_enabled = true;
        let request = crate::operations::Operation::UpdateSettings {
            revision: 0,
            patch_json: serde_json::json!({"announcements":a,"unitPreference":"imperial"})
                .to_string(),
        };
        assert!(matches!(
            t.service.dispatch(1, request),
            Err(Failure::Unavailable)
        ));
        assert_eq!(t.service.store.settings().unwrap().revision, 0);
        assert_eq!(t.service.policy.settings.unit_preference, "metric");
    }
    #[test]
    fn announcement_backpressure_drops_audio_without_failing_telemetry() {
        #[allow(dead_code)]
        mod samples {
            use float_view_application_runtime::telemetry as float_view_refloat_telemetry_service;
            include!("../../session-sqlite/tests/support/mod.rs");
        }
        let mut t = Test::new();
        t.activate(false);
        t.drain();
        t.service.policy.announcements.audio.status = crate::announcements::Readiness::Ready;
        t.service.policy.settings.announcements.load_enabled = true;
        let mut sample = samples::sample(1, 0);
        sample.duty_cycle = Some(0.8);
        t.service.observe_announcement(&sample);
        while t
            .service
            .policy
            .exchange
            .push(Effect::RefreshSpeech)
            .is_ok()
        {}
        assert!(t.service.step_announcements().is_ok());
        assert!(
            !t.service
                .policy
                .timers
                .values()
                .any(|t| t.kind == Timer::Speech)
        );
        assert!(t.service.policy.active.is_some());
        t.drain();
        t.service.policy.exchange.now += 5000;
        t.service.observe_announcement(&sample);
        t.service.step_announcements().unwrap();
        assert!(
            t.service
                .drain_os()
                .effects
                .iter()
                .any(|e| matches!(e, Effect::Speak { .. }))
        );
    }
    #[test]
    fn announcement_delayed_completion_expires_before_accepting_success() {
        use crate::announcements::*;
        let mut t = Test::new();
        t.service.policy.announcements.audio = AudioState {
            status: Readiness::Ready,
            reason: None,
            lowering_control: Lowering::Automatic,
            voice_settings_available: false,
        };
        let crate::Dispatch::Pending(mut receiver) =
            t.service.test_announcement(1, TestKind::Speed).unwrap()
        else {
            panic!("pending")
        };
        let id = t.service.pending.keys().next().copied().unwrap();
        t.fact(
            Fact::SpeechFinished {
                id,
                outcome: Outcome::Finished,
            },
            10_000,
        )
        .unwrap();
        assert!(matches!(
            receiver.try_recv().unwrap().unwrap(),
            crate::facts::Completion::Announcement {
                outcome: Outcome::Unavailable
            }
        ));
    }
    #[test]
    fn voice_settings_launch_is_foreground_bounded_and_ignores_stale_completion() {
        use crate::{dispatch::Dispatch, operations::Operation};
        let mut t = Test::new();
        assert!(matches!(
            t.service.dispatch(1, Operation::OpenVoiceSettings),
            Err(Failure::Unavailable)
        ));
        t.service
            .policy
            .announcements
            .audio
            .voice_settings_available = true;
        t.fact(Fact::Foreground { foreground: false }, 1).unwrap();
        assert!(matches!(
            t.service.dispatch(1, Operation::OpenVoiceSettings),
            Err(Failure::Unavailable)
        ));
        t.fact(Fact::Foreground { foreground: true }, 2).unwrap();
        t.drain();
        let settings = serde_json::to_value(&t.service.policy.settings).unwrap();
        let Dispatch::Pending(mut first) =
            t.service.dispatch(1, Operation::OpenVoiceSettings).unwrap()
        else {
            panic!()
        };
        let id = t
            .service
            .drain_os()
            .effects
            .into_iter()
            .find_map(|effect| match effect {
                Effect::OpenVoiceSettings { id, expires_at_ms } => {
                    assert_eq!(expires_at_ms, 5002);
                    Some(id)
                }
                _ => None,
            })
            .unwrap();
        assert!(matches!(
            t.service.dispatch(2, Operation::OpenVoiceSettings),
            Err(Failure::Conflict)
        ));
        t.fact(
            Fact::VoiceSettingsOpened {
                id: id + 1,
                success: true,
            },
            3,
        )
        .unwrap();
        assert!(first.try_recv().is_err());
        t.fact(Fact::VoiceSettingsOpened { id, success: false }, 4)
            .unwrap();
        assert!(matches!(
            first.try_recv().unwrap(),
            Err(Failure::Unavailable)
        ));
        let Dispatch::Pending(mut expired) =
            t.service.dispatch(1, Operation::OpenVoiceSettings).unwrap()
        else {
            panic!()
        };
        let expired_id = t
            .service
            .drain_os()
            .effects
            .into_iter()
            .find_map(|e| {
                if let Effect::OpenVoiceSettings { id, .. } = e {
                    Some(id)
                } else {
                    None
                }
            })
            .unwrap();
        t.fact(Fact::Clock {}, 6000).unwrap();
        assert!(matches!(
            expired.try_recv().unwrap(),
            Err(Failure::Unavailable)
        ));
        let Dispatch::Pending(mut current) =
            t.service.dispatch(1, Operation::OpenVoiceSettings).unwrap()
        else {
            panic!()
        };
        let current_id = t
            .service
            .drain_os()
            .effects
            .into_iter()
            .find_map(|e| {
                if let Effect::OpenVoiceSettings { id, .. } = e {
                    Some(id)
                } else {
                    None
                }
            })
            .unwrap();
        t.fact(
            Fact::VoiceSettingsOpened {
                id: expired_id,
                success: true,
            },
            6001,
        )
        .unwrap();
        assert!(current.try_recv().is_err());
        t.fact(
            Fact::VoiceSettingsOpened {
                id: current_id,
                success: true,
            },
            6002,
        )
        .unwrap();
        assert!(matches!(
            current.try_recv().unwrap(),
            Ok(crate::facts::Completion::Unit)
        ));
        assert_eq!(
            serde_json::to_value(&t.service.policy.settings).unwrap(),
            settings
        );
    }
    fn automatic_test() -> Test {
        let mut t = Test::new();
        let board = t
            .service
            .store
            .ensure_board("preferred", Some("Board"), Some(&[7; 12]), 1)
            .unwrap();
        t.service.policy.settings = t.service.store.update_settings(0,
            &serde_json::json!({"autoConnectSavedDeviceId":board.saved_device_id,"safetyDisclaimerAccepted":true}).to_string()).unwrap();
        t.service.refresh_boards().unwrap();
        t.fact(
            Fact::Bluetooth {
                radio: Radio::PoweredOn,
                scan: Permission::Granted,
                connect: Permission::Granted,
            },
            1,
        )
        .unwrap();
        t
    }
    fn advertise(t: &mut Test, id: &str, scan: u64, now: u64) {
        t.fact(
            Fact::Discovered {
                scan_id: scan,
                device_id: id.into(),
                name: Some("Board".into()),
                rssi: Some(-40),
                advertises_uart: false,
            },
            now,
        )
        .unwrap();
    }
    #[test]
    fn auto_connect_initial_foreground_is_required_and_duplicate_facts_do_not_extend_window() {
        let mut t = automatic_test();
        assert!(t.service.policy.scan.is_none());
        t.fact(Fact::Foreground { foreground: true }, 2).unwrap();
        let scan = t.service.policy.scan.unwrap();
        assert_eq!(scan.1, 15002);
        t.fact(Fact::Foreground { foreground: true }, 100).unwrap();
        assert_eq!(t.service.policy.scan.unwrap(), scan);
        advertise(&mut t, "other", scan.0, 101);
        assert!(t.service.policy.active.is_none());
        advertise(&mut t, "preferred", scan.0, 102);
        assert!(t.service.policy.active.as_ref().unwrap().saved);
        assert_eq!(
            t.service.policy.auto_connect,
            crate::auto_connect::Opportunity::Closed
        );
        assert!(t.service.policy.scan.is_none());
    }
    #[test]
    fn auto_connect_scans_share_transport_but_not_deadlines() {
        for home_first in [true, false] {
            let mut t = automatic_test();
            if home_first {
                t.service.start_scan(30000).unwrap();
            }
            t.fact(Fact::Foreground { foreground: true }, 2).unwrap();
            let scan = t.service.policy.scan.unwrap().0;
            if !home_first {
                assert_eq!(t.service.start_scan(30000).unwrap(), scan);
            }
            t.fact(Fact::Clock {}, 15002).unwrap();
            assert_eq!(t.service.policy.scan.unwrap().0, scan);
            advertise(&mut t, "preferred", scan, 15003);
            assert!(t.service.policy.active.is_none());
            t.fact(Fact::Clock {}, 30003).unwrap();
            assert!(t.service.policy.scan.is_none());
        }
    }
    #[test]
    fn auto_connect_expiry_background_and_stale_results_cannot_admit() {
        for end in ["expiry", "background"] {
            let mut t = automatic_test();
            t.fact(Fact::Foreground { foreground: true }, 2).unwrap();
            let old = t.service.policy.scan.unwrap().0;
            if end == "background" {
                t.fact(Fact::Foreground { foreground: false }, 3).unwrap();
            }
            t.fact(Fact::Clock {}, 15002).unwrap();
            advertise(&mut t, "preferred", old, 15003);
            assert!(t.service.policy.active.is_none());
            t.fact(Fact::Foreground { foreground: false }, 15004)
                .unwrap();
            t.fact(Fact::Foreground { foreground: true }, 15005)
                .unwrap();
            let new = t.service.policy.scan.unwrap().0;
            assert_ne!(old, new);
            advertise(&mut t, "preferred", old, 15006);
            assert!(t.service.policy.active.is_none());
            advertise(&mut t, "preferred", new, 15007);
            assert!(t.service.policy.active.is_some());
        }
    }
    #[test]
    fn auto_connect_manual_failure_suppresses_and_return_rearms() {
        let mut t = automatic_test();
        t.fact(Fact::Foreground { foreground: true }, 2).unwrap();
        assert!(matches!(
            t.service.dispatch(
                1,
                crate::operations::Operation::Connect {
                    device_id: "absent".into(),
                    saved: true
                }
            ),
            Err(Failure::NotFound)
        ));
        assert!(t.service.policy.scan.is_none());
        let scan = t.service.start_scan(10000).unwrap();
        advertise(&mut t, "preferred", scan, 3);
        assert!(t.service.policy.active.is_none());
        t.fact(Fact::Foreground { foreground: false }, 4).unwrap();
        t.fact(Fact::Foreground { foreground: true }, 5).unwrap();
        let resumed = t.service.policy.scan.unwrap().0;
        advertise(&mut t, "preferred", scan, 6);
        assert!(t.service.policy.active.is_none());
        advertise(&mut t, "preferred", resumed, 6);
        assert!(t.service.policy.active.is_some());
        t.service
            .dispatch(1, crate::operations::Operation::Disconnect)
            .unwrap();
        let scan = t.service.start_scan(10000).unwrap();
        advertise(&mut t, "preferred", scan, 7);
        assert!(t.service.policy.active.is_none());
    }
    #[test]
    fn auto_connect_permission_recovery_keeps_original_deadline() {
        let mut t = automatic_test();
        t.fact(Fact::Foreground { foreground: true }, 2).unwrap();
        t.fact(
            Fact::Bluetooth {
                radio: Radio::PoweredOff,
                scan: Permission::Granted,
                connect: Permission::Granted,
            },
            3,
        )
        .unwrap();
        assert!(t.service.policy.scan.is_none());
        t.fact(
            Fact::Bluetooth {
                radio: Radio::PoweredOn,
                scan: Permission::Granted,
                connect: Permission::Granted,
            },
            1000,
        )
        .unwrap();
        assert_eq!(t.service.policy.scan.unwrap().1, 15002);
        let scan = t.service.policy.scan.unwrap().0;
        advertise(&mut t, "preferred", scan, 15002);
        assert!(t.service.policy.active.is_none());
    }
    #[test]
    fn auto_connect_waits_for_readiness_and_requires_fresh_discovery() {
        let mut t = automatic_test();
        t.service.policy.settings.safety_disclaimer_accepted = false;
        let scan = t.service.start_scan(10000).unwrap();
        advertise(&mut t, "preferred", scan, 2);
        t.fact(Fact::Foreground { foreground: true }, 3).unwrap();
        assert!(t.service.policy.active.is_none());
        t.service
            .dispatch(
                1,
                crate::operations::Operation::UpdateSettings {
                    revision: t.service.policy.settings.revision,
                    patch_json: r#"{"safetyDisclaimerAccepted":true}"#.into(),
                },
            )
            .unwrap();
        assert!(t.service.policy.active.is_none());
        assert_eq!(t.service.policy.scan.unwrap().1, 15003);
        t.fact(Fact::Clock {}, 10004).unwrap();
        assert!(t.service.policy.scan.is_some());
        advertise(&mut t, "preferred", scan, 10005);
        assert!(t.service.policy.active.is_some());
    }
    #[test]
    fn auto_connect_malformed_commands_do_not_suppress_and_failed_setup_does_not_rearm() {
        let mut t = automatic_test();
        t.fact(Fact::Foreground { foreground: true }, 2).unwrap();
        let scan = t.service.policy.scan.unwrap().0;
        assert!(matches!(
            t.service.dispatch(
                1,
                crate::operations::Operation::Connect {
                    device_id: "".into(),
                    saved: true
                }
            ),
            Err(Failure::InvalidRequest)
        ));
        advertise(&mut t, "preferred", scan, 3);
        let generation = t.service.policy.active.as_ref().unwrap().generation;
        t.fact(
            Fact::Link {
                generation,
                state: LinkState::Failed,
            },
            4,
        )
        .unwrap();
        assert_eq!(
            t.service.policy.auto_connect,
            crate::auto_connect::Opportunity::Closed
        );
        t.service.disconnect("test_cleanup").unwrap();
        t.fact(Fact::Foreground { foreground: true }, 5).unwrap();
        let scan = t.service.start_scan(10000).unwrap();
        advertise(&mut t, "preferred", scan, 6);
        assert!(t.service.policy.active.is_none());
    }
    #[test]
    fn auto_connect_preference_edits_do_not_extend_or_rearm_the_window() {
        let mut t = automatic_test();
        let second = t
            .service
            .store
            .ensure_board("second", None, Some(&[8; 12]), 1)
            .unwrap();
        t.service.refresh_boards().unwrap();
        t.fact(Fact::Foreground { foreground: true }, 2).unwrap();
        let scan = t.service.policy.scan.unwrap();
        t.service
            .dispatch(
                1,
                crate::operations::Operation::UpdateSettings {
                    revision: t.service.policy.settings.revision,
                    patch_json:
                        serde_json::json!({"autoConnectSavedDeviceId":second.saved_device_id})
                            .to_string(),
                },
            )
            .unwrap();
        assert_eq!(t.service.policy.scan.unwrap(), scan);
        advertise(&mut t, "preferred", scan.0, 3);
        assert!(t.service.policy.active.is_none());
        t.service
            .dispatch(
                1,
                crate::operations::Operation::UpdateSettings {
                    revision: t.service.policy.settings.revision,
                    patch_json: r#"{"autoConnectSavedDeviceId":null}"#.into(),
                },
            )
            .unwrap();
        assert!(t.service.policy.scan.is_none());
        t.service
            .dispatch(
                1,
                crate::operations::Operation::UpdateSettings {
                    revision: t.service.policy.settings.revision,
                    patch_json:
                        serde_json::json!({"autoConnectSavedDeviceId":second.saved_device_id})
                            .to_string(),
                },
            )
            .unwrap();
        assert!(t.service.policy.scan.is_none());
        t.fact(Fact::Foreground { foreground: false }, 4).unwrap();
        t.fact(Fact::Foreground { foreground: true }, 5).unwrap();
        let scan = t.service.policy.scan.unwrap().0;
        advertise(&mut t, "second", scan, 6);
        assert!(t.service.policy.active.is_some());
        t.fact(Fact::Foreground { foreground: false }, 7).unwrap();
        t.fact(Fact::Foreground { foreground: true }, 8).unwrap();
        assert_eq!(
            t.service.policy.auto_connect,
            crate::auto_connect::Opportunity::Closed
        );
    }
}
