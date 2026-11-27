use crate::{Error, ProductStore, Result, json, limits, next_revision, object};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub auto_connect_saved_device_id: Option<String>,
    pub safety_disclaimer_accepted: bool,
    pub announcements: AnnouncementSettings,
    pub session_display_options: SessionDisplayOptions,
    pub revision: u64,
    pub idle_probe_interval_ms: u64,
    pub idle_persist_interval_ms: u64,
    pub riding_persist_interval_ms: u64,
    pub post_ride_tail_ms: u64,
    pub reconnect_duration_ms: u64,
    #[serde(default = "default_resume_window")]
    pub ride_resume_window_minutes: u64,
    pub minimum_session_distance: f64,
    pub theme_preference: String,
    pub accent_preference: String,
    pub unit_preference: String,
    pub live_widget_slots: [String; 5],
    pub history_gap_threshold_seconds: Option<f64>,
    pub location_recording_enabled: bool,
    pub include_gps_location_when_exporting: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnouncementSettings {
    pub speed_enabled: bool,
    pub load_enabled: bool,
    #[serde(default)]
    pub footpad_enabled: bool,
    #[serde(default = "default_battery_charge_enabled")]
    pub battery_charge_enabled: bool,
    #[serde(default = "default_footpad_delay")]
    pub footpad_delay_seconds: u64,
    pub speed_threshold_kph: f64,
    pub load_threshold_percent: f64,
    pub repeat_interval_seconds: u64,
    pub volume_percent: u64,
    pub lower_other_audio: bool,
}
impl Default for AnnouncementSettings {
    fn default() -> Self {
        Self {
            speed_enabled: false,
            load_enabled: false,
            footpad_enabled: false,
            battery_charge_enabled: true,
            footpad_delay_seconds: 1,
            speed_threshold_kph: 25.,
            load_threshold_percent: 65.,
            repeat_interval_seconds: 5,
            volume_percent: 100,
            lower_other_audio: true,
        }
    }
}
impl AnnouncementSettings {
    pub fn valid(&self) -> bool {
        self.speed_threshold_kph.is_finite()
            && self.speed_threshold_kph > 0.
            && self.speed_threshold_kph <= 200.
            && self.load_threshold_percent.is_finite()
            && self.load_threshold_percent > 0.
            && self.load_threshold_percent <= 100.
            && (1..=60).contains(&self.repeat_interval_seconds)
            && self.volume_percent <= 100
            && (1..=5).contains(&self.footpad_delay_seconds)
    }
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionDisplayOptions {
    pub both_footpads_off: bool,
    pub one_footpad_off: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_connect_saved_device_id: None,
            safety_disclaimer_accepted: false,
            announcements: AnnouncementSettings::default(),
            revision: 0,
            session_display_options: SessionDisplayOptions::default(),
            idle_probe_interval_ms: 500,
            idle_persist_interval_ms: 1_000,
            riding_persist_interval_ms: 100,
            post_ride_tail_ms: 5_000,
            reconnect_duration_ms: 300_000,
            ride_resume_window_minutes: default_resume_window(),
            minimum_session_distance: 100.,
            theme_preference: "system".into(),
            accent_preference: "teal".into(),
            unit_preference: "metric".into(),
            live_widget_slots: ["empty", "powerW", "elapsedMs", "odometerM", "distanceM"]
                .map(str::to_owned),
            history_gap_threshold_seconds: None,
            location_recording_enabled: false,
            include_gps_location_when_exporting: false,
        }
    }
}
impl ProductStore {
    pub(crate) fn initialize_settings(&mut self) -> Result<()> {
        self.catalog.execute(
            "INSERT OR IGNORE INTO settings(singleton,revision,json) VALUES (1,0,?)",
            [json(&Settings::default(), limits::MAX_SETTINGS_BYTES)?],
        )?;
        self.settings()?;
        Ok(())
    }
    pub fn settings(&self) -> Result<Settings> {
        read(&self.catalog)
    }
    pub fn update_settings(&mut self, expected_revision: u64, patch: &str) -> Result<Settings> {
        let patch = object(patch, limits::MAX_SETTINGS_BYTES)?;
        let tx = self
            .catalog
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = read(&tx)?;
        if current.revision != expected_revision {
            return Err(Error::Conflict {
                revision: current.revision,
            });
        }
        let mut values = serde_json::to_value(&current).map_err(|_| Error::Database)?;
        let target = values.as_object_mut().ok_or(Error::Database)?;
        for (key, mut value) in patch {
            match key.as_str() {
                "autoConnectSavedDeviceId" => {
                    if !value.is_null() {
                        let id = value.as_str().ok_or(Error::InvalidInput)?;
                        crate::boards::validate_id(id)?;
                        let local: Option<String> = tx.query_row(
                            "SELECT opaque_platform_id FROM saved_device WHERE saved_device_id=?",
                            [id], |r| r.get(0),
                        ).optional()?.ok_or(Error::NotFound)?;
                        if local.is_none() {
                            return Err(Error::UnassociatedBoard);
                        }
                    }
                }
                "announcements"
                    if value.get("batteryChargeEnabled").is_some()
                        && value.get("footpadEnabled").is_some()
                        && value.get("footpadDelaySeconds").is_some()
                        && serde_json::from_value::<AnnouncementSettings>(value.clone())
                            .is_ok_and(|v| v.valid()) => {}
                "idleProbeIntervalMs" => clamp_integer(&mut value, 100, 10_000)?,
                "idlePersistIntervalMs" => clamp_integer(&mut value, 100, 60_000)?,
                "ridingPersistIntervalMs" => clamp_integer(&mut value, 50, 10_000)?,
                "postRideTailMs" => clamp_integer(&mut value, 0, 300_000)?,
                "reconnectDurationMs" => clamp_integer(&mut value, 0, 3_600_000)?,
                "rideResumeWindowMinutes"
                    if value.as_u64().is_some_and(|v| (1..=1440).contains(&v)) => {}
                "minimumSessionDistance" => clamp_float(&mut value, 0., 1_000_000.)?,
                "historyGapThresholdSeconds" if value.is_null() => {}
                "historyGapThresholdSeconds" => clamp_float(&mut value, 0.1, 3_600.)?,
                "accentPreference"
                    if matches!(
                        value.as_str(),
                        Some("purple" | "blue" | "teal" | "amber" | "rose")
                    ) => {}
                "themePreference"
                    if matches!(value.as_str(), Some("system" | "light" | "dark")) => {}
                "sessionDisplayOptions"
                    if serde_json::from_value::<SessionDisplayOptions>(value.clone()).is_ok() => {}
                "liveWidgetSlots" if valid_live_widget_slots(&value) => {}
                "unitPreference" if matches!(value.as_str(), Some("metric" | "imperial")) => {}
                "safetyDisclaimerAccepted"
                | "locationRecordingEnabled"
                | "includeGpsLocationWhenExporting"
                    if value.is_boolean() => {}
                _ => return Err(Error::InvalidInput),
            }
            target.insert(key, value);
        }
        let mut updated: Settings =
            serde_json::from_value(values).map_err(|_| Error::InvalidInput)?;
        updated.revision = next_revision(current.revision)?;
        tx.execute(
            "UPDATE settings SET revision=?,json=? WHERE singleton=1 AND revision=?",
            params![
                updated.revision,
                json(&updated, limits::MAX_SETTINGS_BYTES)?,
                expected_revision
            ],
        )?;
        tx.commit()?;
        Ok(updated)
    }
}
pub(crate) fn read(db: &rusqlite::Connection) -> Result<Settings> {
    let (revision, text): (u64, String) = db
        .query_row(
            "SELECT revision,json FROM settings WHERE singleton=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .ok_or(Error::Corrupt)?;
    if text.len() > limits::MAX_SETTINGS_BYTES || revision > limits::MAX_REVISION {
        return Err(Error::Corrupt);
    }
    let mut value: Settings = serde_json::from_str(&text).map_err(|_| Error::Corrupt)?;
    value.revision = revision;
    if !value.announcements.valid()
        || !(100..=10_000).contains(&value.idle_probe_interval_ms)
        || !(100..=60_000).contains(&value.idle_persist_interval_ms)
        || !(50..=10_000).contains(&value.riding_persist_interval_ms)
        || value.post_ride_tail_ms > 300_000
        || value.reconnect_duration_ms > 3_600_000
        || !(1..=1440).contains(&value.ride_resume_window_minutes)
        || !value.minimum_session_distance.is_finite()
        || !(0.0..=1_000_000.0).contains(&value.minimum_session_distance)
        || !matches!(
            value.accent_preference.as_str(),
            "purple" | "blue" | "teal" | "amber" | "rose"
        )
        || !matches!(value.theme_preference.as_str(), "system" | "light" | "dark")
        || !value
            .live_widget_slots
            .iter()
            .all(|v| LIVE_WIDGET_FIELDS.contains(&v.as_str()))
        || !matches!(value.unit_preference.as_str(), "metric" | "imperial")
        || value
            .history_gap_threshold_seconds
            .is_some_and(|v| !v.is_finite() || !(0.1..=3_600.).contains(&v))
    {
        return Err(Error::Corrupt);
    }
    Ok(value)
}
fn clamp_integer(value: &mut Value, min: u64, max: u64) -> Result<()> {
    let n = value
        .as_f64()
        .filter(|n| n.is_finite() && n.fract() == 0.)
        .ok_or(Error::InvalidInput)?;
    *value = Value::from(n.clamp(min as f64, max as f64) as u64);
    Ok(())
}
fn clamp_float(value: &mut Value, min: f64, max: f64) -> Result<()> {
    let n = value
        .as_f64()
        .filter(|n| n.is_finite())
        .ok_or(Error::InvalidInput)?;
    *value = Value::from(n.clamp(min, max));
    Ok(())
}

pub(crate) const LIVE_WIDGET_FIELDS: &[&str] = &[
    "empty",
    "themeToggle",
    "headlights",
    "leds",
    "fieldWeakeningCurrentA",
    "motorCurrentA",
    "batteryCurrentA",
    "powerW",
    "packVoltageV",
    "dutyCycle",
    "driveLoad",
    "estimatedBatteryLevel",
    "batteryLevel",
    "speedKph",
    "maxSpeedKph",
    "distanceM",
    "odometerM",
    "altitudeM",
    "elapsedMs",
    "erpm",
    "controllerTempC",
    "motorTempC",
    "highestTempC",
    "bmsStateOfCharge",
    "bmsStateOfHealth",
    "bmsTotalVoltageV",
    "bmsInputCurrentA",
    "bmsChargeVoltageV",
    "bmsMinCellVoltageV",
    "bmsMaxCellVoltageV",
    "bmsCellVoltageSpreadV",
    "bmsHighestCellTempC",
    "bmsIcTempC",
    "bmsHumidityPercent",
    "directionalMotorCurrentA",
    "filteredMotorCurrentA",
    "requestedBalanceCurrentA",
    "boosterCurrentA",
    "pitchDeg",
    "balancePitchDeg",
    "rollDeg",
    "footpadAdc1V",
    "footpadAdc2V",
    "remoteInput",
    "setpointDeg",
    "atrSetpointDeg",
    "brakeTiltSetpointDeg",
    "torqueTiltSetpointDeg",
    "turnTiltSetpointDeg",
    "remoteSetpointDeg",
    "atrAccelerationDifferenceErpmPerSecond",
    "atrSpeedBoost",
    "ampHoursDrawnAh",
    "ampHoursChargedAh",
    "ampHoursNetAh",
    "wattHoursDrawnWh",
    "wattHoursChargedWh",
    "wattHoursNetWh",
    "chargingCurrentA",
    "chargingVoltageV",
];
pub(crate) fn valid_live_widget_slots(value: &Value) -> bool {
    value.as_array().is_some_and(|slots| {
        slots.len() == 5
            && slots
                .iter()
                .all(|v| v.as_str().is_some_and(|v| LIVE_WIDGET_FIELDS.contains(&v)))
    })
}

fn default_resume_window() -> u64 {
    60
}

fn default_battery_charge_enabled() -> bool {
    true
}

fn default_footpad_delay() -> u64 {
    1
}

pub(crate) fn validate_imported(value: &Settings) -> Result<()> {
    let db = rusqlite::Connection::open_in_memory()?;
    db.execute_batch("CREATE TABLE settings(singleton INTEGER,revision INTEGER,json TEXT)")?;
    db.execute(
        "INSERT INTO settings VALUES(1,0,?)",
        [json(value, limits::MAX_SETTINGS_BYTES)?],
    )?;
    read(&db).map(|_| ()).map_err(|_| Error::InvalidInput)
}
