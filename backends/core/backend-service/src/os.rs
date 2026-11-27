//! Closed native capability boundary. No product operation is an OS request.
use crate::operations::Failure;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};

pub const MAX_ENVELOPE_BYTES: usize = 1_048_576;
pub const MAX_EFFECTS_PER_DRAIN: usize = 8;
pub(crate) const MAX_EFFECTS: usize = 2_048;
pub(crate) const RUNTIME_RESERVE: usize = 1_024;
static LIFETIME: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Radio {
    Unknown,
    PoweredOn,
    PoweredOff,
    Unsupported,
    Unauthorized,
    Resetting,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Permission {
    Unknown,
    NotDetermined,
    Granted,
    Denied,
    Restricted,
    NotRequired,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LocationAuthorization {
    NotDetermined,
    Authorized,
    ForegroundOnly,
    Denied,
    Restricted,
    Unavailable,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LinkState {
    Connecting,
    DiscoveringServices,
    EnablingNotifications,
    Ready,
    Disconnected,
    Failed,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "fact", rename_all = "snake_case", deny_unknown_fields)]
pub enum Fact {
    SpeechReady {
        state: crate::announcements::AudioState,
    },
    VoiceSettingsOpened {
        id: u64,
        success: bool,
    },
    SpeechFinished {
        id: u64,
        outcome: crate::announcements::Outcome,
    },
    Permissions {
        observation: crate::permissions::Observation,
    },
    NativeDiagnostics {
        platform: String,
        os_version: String,
        callbacks: u64,
        max_queue_delay_ms: u64,
        max_queue_depth: u64,
        overflows: u64,
        exchange_failures: u64,
    },
    Clock {},
    StopRequested {},
    Bluetooth {
        radio: Radio,
        scan: Permission,
        connect: Permission,
    },
    Discovered {
        scan_id: u64,
        device_id: String,
        name: Option<String>,
        rssi: Option<i32>,
        advertises_uart: bool,
    },
    Link {
        generation: u64,
        state: LinkState,
    },
    Profile {
        generation: u64,
        operation: u64,
        profile: crate::ble::Profile,
    },
    Notifications {
        generation: u64,
        operation: u64,
        success: bool,
    },
    WriteProgress {
        generation: u64,
        operation: u64,
        progress: crate::ble::Progress,
    },
    Bytes {
        generation: u64,
        bytes: Vec<u8>,
    },
    Timer {
        id: u64,
    },
    LocationSpeed {
        capture_id: u64,
        speed_mps: Option<f64>,
        accuracy_mps: Option<f64>,
        age_ms: u64,
    },
    Location {
        capture_id: u64,
        latitude: f64,
        longitude: f64,
        accuracy_m: Option<f64>,
        altitude_m: Option<f64>,
        observed_at_ms: i64,
    },
    Foreground {
        foreground: bool,
    },
    Storage {
        available_bytes: u64,
    },
    PresentationStarted {
        id: u64,
        accepted: bool,
    },
    PresentationFinished {
        id: u64,
    },
    UiCompleted {
        id: u64,
        success: bool,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub lifetime: u64,
    pub sequence: u64,
    pub monotonic_ms: u64,
    pub epoch_ms: i64,
    pub fact: Fact,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "effect", rename_all = "snake_case", deny_unknown_fields)]
pub enum Effect {
    Speak {
        speech: crate::announcements::Speech,
    },
    CancelSpeech {
        id: u64,
    },
    RefreshSpeech,
    OpenVoiceSettings {
        id: u64,
        expires_at_ms: u64,
    },
    Scan {
        scan_id: u64,
    },
    StopScan,
    Connect {
        generation: u64,
        device_id: String,
    },
    Disconnect {
        generation: u64,
    },
    EnableNotifications {
        generation: u64,
        operation: u64,
        mode: crate::ble::WriteMode,
    },
    Write {
        generation: u64,
        operation: u64,
        mode: crate::ble::WriteMode,
        bytes: Vec<u8>,
    },
    ArmTimer {
        id: u64,
        delay_ms: u64,
        connection: bool,
    },
    CancelTimer {
        id: u64,
    },
    CancelConnectionTimers,
    StartLocation {
        capture_id: u64,
        high_accuracy: bool,
    },
    StopLocation,
    RecoverPermission {
        id: u64,
        permission: crate::permissions::Id,
        action: crate::permissions::Action,
    },
    PresentFile {
        id: u64,
        path: String,
        file_name: String,
    },
    LiveActivity {
        state: Option<crate::live_activity::LiveActivity>,
    },
    HostState {
        speech_enabled: bool,
        connected: bool,
        recording: bool,
        theme_preference: String,
        display_name: Option<String>,
        saved_device_ids: Vec<String>,
    },
}
#[derive(Clone, Debug, Serialize)]
pub struct Drain {
    pub lifetime: u64,
    pub effects: Vec<Effect>,
}

pub(crate) struct Exchange {
    pub lifetime: u64,
    pub sequence: u64,
    pub now: u64,
    pub epoch: i64,
    next_id: u64,
    queue: VecDeque<Effect>,
    // Fixed cleanup reserve, usable even if ordinary admission is exhausted.
    pub stop_scan: bool,
    pub stop_location: bool,
    pub cancel_timers: bool,
    pub disconnect: Option<u64>,
    pub status: Option<Effect>,
    pub live_activity: Option<Effect>,
    speech_cancel: Option<u64>,
}
impl Default for Exchange {
    fn default() -> Self {
        Self {
            lifetime: LIFETIME.fetch_add(1, Ordering::Relaxed),
            sequence: 0,
            now: 0,
            epoch: 0,
            next_id: 0,
            queue: VecDeque::new(),
            stop_scan: false,
            stop_location: false,
            cancel_timers: false,
            disconnect: None,
            status: None,
            live_activity: None,
            speech_cancel: None,
        }
    }
}
impl Exchange {
    pub fn cancel_speech(&mut self, id: u64) {
        self.queue
            .retain(|e| !matches!(e,Effect::Speak{speech} if speech.id==id));
        self.speech_cancel = Some(id);
    }
    pub fn admit(&self) -> Result<(), Failure> {
        if self.queue.len() > MAX_EFFECTS - RUNTIME_RESERVE {
            Err(Failure::Unavailable)
        } else {
            Ok(())
        }
    }
    pub fn id(&mut self) -> Result<u64, Failure> {
        self.next_id = self
            .next_id
            .checked_add(1)
            .filter(|n| *n <= 9_007_199_254_740_991)
            .ok_or(Failure::Unavailable)?;
        Ok(self.next_id)
    }
    pub fn push(&mut self, effect: Effect) -> Result<(), Failure> {
        if self.queue.len() >= MAX_EFFECTS {
            return Err(Failure::Unavailable);
        }
        self.queue.push_back(effect);
        Ok(())
    }
    pub fn clear_connection(&mut self, generation: u64) {
        self.queue.retain(|e| {
            !matches!(
                e,
                Effect::Connect { .. }
                    | Effect::Write { .. }
                    | Effect::EnableNotifications { .. }
                    | Effect::ArmTimer {
                        connection: true,
                        ..
                    }
                    | Effect::CancelTimer { .. }
                    | Effect::StartLocation { .. }
            )
        });
        self.cancel_timers = true;
        self.stop_location = true;
        self.disconnect = Some(generation);
    }
    pub fn request_stop_scan(&mut self) {
        self.queue.retain(|e| !matches!(e, Effect::Scan { .. }));
        self.stop_scan = true;
    }
    pub fn request_stop_location(&mut self) {
        self.queue
            .retain(|e| !matches!(e, Effect::StartLocation { .. }));
        self.stop_location = true;
    }
    pub fn drain(&mut self) -> Drain {
        let mut effects = Vec::with_capacity(MAX_EFFECTS_PER_DRAIN);
        if std::mem::take(&mut self.stop_scan) {
            effects.push(Effect::StopScan);
        }
        if std::mem::take(&mut self.stop_location) {
            effects.push(Effect::StopLocation);
        }
        if std::mem::take(&mut self.cancel_timers) {
            effects.push(Effect::CancelConnectionTimers);
        }
        if let Some(generation) = self.disconnect.take() {
            effects.push(Effect::Disconnect { generation });
        }
        if let Some(status) = self.status.take() {
            effects.push(status);
        }
        if let Some(activity) = self.live_activity.take() {
            effects.push(activity);
        }
        if let Some(id) = self.speech_cancel.take() {
            effects.push(Effect::CancelSpeech { id });
        }
        let mut bytes = 4096usize;
        while effects.len() < MAX_EFFECTS_PER_DRAIN {
            let size = self
                .queue
                .front()
                .map(|e| match e {
                    Effect::Write { bytes, .. } => bytes.len() * 4 + 512,
                    Effect::PresentFile {
                        path, file_name, ..
                    } => path.len() * 6 + file_name.len() * 6 + 512,
                    _ => 2048,
                })
                .unwrap_or(0);
            if bytes + size > MAX_ENVELOPE_BYTES {
                break;
            }
            bytes += size;
            let Some(effect) = self.queue.pop_front() else {
                break;
            };
            effects.push(effect);
        }
        Drain {
            lifetime: self.lifetime,
            effects,
        }
    }
}
