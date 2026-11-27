//! The sole native frontend state/result projection.
use crate::{facts::*, protocol::Failure};
use serde::Serialize;
use serde_json::{Value, json};

pub fn value(record: &impl Serialize) -> Value {
    serde_json::to_value(record).expect("finite typed facts")
}
pub fn location(facts: &Location, enabled: bool) -> Value {
    json!({"status":if enabled { facts.authorization.as_str() } else { "disabled" }, "permissionAction":facts.permission_action,"backgroundCapture":facts.background_capture,"reason":facts.reason})
}

pub fn bluetooth(facts: &Bluetooth, scanning: bool) -> Value {
    let mut result = value(facts);
    result["scanning"] = json!(scanning);
    result
}
pub fn maintenance(job: &Maintenance) -> Value {
    json!({"operationId":job.operation_id,"kind":if job.kind == "prune_preview" {"prunePreview"}else{"prune"},
        "status":match job.state.as_str() { "cancel_requested" => "cancelling", "pending" => "queued", state => state },"sessionId":job.session_id,
        "scope":job.scope,"targetResolutionSeconds":job.target_resolution_seconds,"completedSessions":job.completed_sessions,
        "eligibleSessions":job.upper_session_id.as_ref().map(|_| job.completed_sessions),
        "error":job.error.as_ref().map(|_|error(&Failure::Internal))})
}
fn firmware_info(firmware: &Firmware, version: &str) -> Value {
    json!({"vescVersion":format!("{}.{:02}",firmware.major,firmware.minor),
        "packageName":"refloat","packageVersion":version,"hardwareName":firmware.hardware_name,
        "accessMode":firmware.access_mode,"supported":true})
}

pub fn state(facts: &Snapshot, revision: u64, catalog_revision: u64) -> Value {
    let discovered: Vec<_> = facts.discovery.known_devices.iter().map(|device| json!({
        "deviceId":device.device_id,"name":device.name.as_deref().unwrap_or(&device.device_id),"state":"discovered",
        "lastSeenAt":device.last_seen_at,"rssi":device.rssi,"savedDeviceId":device.saved_device_id,
    })).collect();
    let active = facts.active.as_ref().map(|active| {
        let mut result = value(active);
        let object = result.as_object_mut().expect("record");
        object.remove("savedDevice");
        object.remove("controllerRoute");
        object.insert(
            "controllerConnection".into(),
            value(&active.controller_route),
        );
        object.insert(
            "savedDeviceId".into(),
            json!(active.saved_device.as_ref().map(|b| &b.saved_device_id)),
        );
        object.insert(
            "displayName".into(),
            json!(
                active
                    .saved_device
                    .as_ref()
                    .map(|b| b.display_name.as_str())
                    .or(active.name.as_deref())
                    .unwrap_or(&active.device_id)
            ),
        );
        object.insert(
            "name".into(),
            json!(active.name.as_deref().unwrap_or(&active.device_id)),
        );
        if active.state == "enabling_notifications" {
            object.insert("state".into(), json!("discovering_services"));
        }
        if let Some(sample) = object
            .get_mut("latestSample")
            .and_then(Value::as_object_mut)
            && let Some(extensions) = sample.remove("extensionFields")
        {
            sample.insert("extensions".into(), extensions);
        }
        object.insert(
            "firmware".into(),
            match (&facts.firmware, &facts.package_version) {
                (Some(firmware), Some(version)) => firmware_info(firmware, version),
                _ => Value::Null,
            },
        );
        object.insert(
            "refloatConfiguration".into(),
            if facts.package_version.is_some() {
                value(&facts.configuration)
            } else {
                Value::Null
            },
        );
        result
    });
    json!({"batteryPresets":facts.battery_presets,"batteryPresetCatalogVersion":facts.battery_preset_catalog_version,"batteryCellProfiles":facts.battery_cell_profiles,"revision":revision,"bluetooth":bluetooth(&facts.discovery.bluetooth_state,facts.discovery.active_scan_id.is_some()),
        "discoveredDevices":discovered,"savedDevices":facts.saved_boards,"activeConnection":active,"sessionCatalogRevision":catalog_revision,"speedCalibration": value(&facts.speed_calibration),
        "pausedRide":facts.paused_ride,
        "hermes":facts.hermes,"announcementAudio":facts.announcement_audio,"permissions":facts.permissions,"settings":facts.settings,"location":location(&facts.location,facts.settings.location_recording_enabled),
        "sessionOperation":facts.maintenance.as_ref().map(maintenance)})
}
pub fn error(failure: &Failure) -> Value {
    let message = match failure {
        Failure::InvalidRequest => "Request is invalid",
        Failure::InvalidState => "Backend state does not permit the operation",
        Failure::PermissionRequired => "Permission is required",
        Failure::NotFound => "Resource was not found",
        Failure::Conflict => "Resource revision changed",
        Failure::Unavailable => "Backend service is unavailable",
        Failure::Internal => "Backend operation failed",
    };
    json!({"code":failure,"message":message})
}
pub fn identity(summary: &ConfigurationSummary) -> Option<Value> {
    Some(
        json!({"packageName":"refloat","packageVersion":summary.package_version.as_ref()?,
        "schemaFingerprint":summary.schema_fingerprint.as_ref()?,"wireSignature":summary.wire_signature?}),
    )
}
pub const NUMERIC_FIELDS: &[&str] = &[
    "packVoltageV",
    "dutyCycle",
    "controllerTempC",
    "motorTempC",
    "bmsCircuitryTempC",
    "bmsHighestCellTempC",
    "motorCurrentA",
    "batteryCurrentA",
    "erpm",
    "speedKph",
    "pitchDeg",
    "balancePitchDeg",
    "rollDeg",
    "directionalMotorCurrentA",
    "filteredMotorCurrentA",
    "requestedBalanceCurrentA",
    "boosterCurrentA",
    "fieldWeakeningCurrentA",
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
    "distanceM",
    "odometerM",
    "ampHoursDrawnAh",
    "ampHoursChargedAh",
    "wattHoursDrawnWh",
    "wattHoursChargedWh",
    "batteryLevel",
    "chargingCurrentA",
    "chargingVoltageV",
];
pub fn descriptors(fields: &[String], extensions: &[String]) -> Value {
    json!(fields.iter().map(|field|json!({"name":field,"source":if extensions.contains(field){"extension"}else{"stable"}})).collect::<Vec<_>>())
}
pub fn boundary(facts: &Boundary) -> Value {
    json!({"historyRevision":facts.history_revision,"committedSampleSequence":facts.committed_sample_sequence,
        "committedEventSequence":facts.committed_event_sequence,"committedElapsedMs":facts.committed_elapsed_ms,
        "committedLocationSequence":facts.committed_location_sequence,"committedLocationElapsedMs":facts.committed_location_elapsed_ms})
}
pub fn metadata(facts: &SessionMetadata) -> Value {
    json!({"recordingBreaks":facts.recording_breaks.iter().map(|b|(b.start_elapsed_ms,b.end_elapsed_ms,b.reason)).collect::<Vec<_>>(),"summary":facts.summary,"fields":descriptors(&facts.recorded_fields,&facts.extension_fields),"eventCount":facts.summary.event_count,
        "recordedSampleCount":facts.boundary.recorded_sample_count,"storedSampleCount":facts.boundary.stored_sample_count,
        "connectionContextCount":facts.connection_context_count,"markerCount":facts.marker_count,"prune":facts.prune,"snapshot":boundary(&facts.boundary),"location":{"available":facts.boundary.recorded_location_count > 0,
        "count":facts.boundary.recorded_location_count,"lastSequence":facts.boundary.committed_location_sequence,
        "lastElapsedMs":facts.boundary.committed_location_elapsed_ms,"status":facts.boundary.location_status}})
}
pub fn tune(facts: &Tune, include_values: bool) -> Result<Value, Failure> {
    let mut result = value(facts);
    let object = result.as_object_mut().ok_or(Failure::Internal)?;
    object.remove("configurationId");
    object.remove("valuesJson");
    object.insert("tuneId".into(), json!(facts.configuration_id));
    if include_values {
        let values: std::collections::BTreeMap<String, ConfigurationValue> =
            serde_json::from_str(&facts.values_json).map_err(|_| Failure::Internal)?;
        object.insert("values".into(), value(&values));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn firmware_access_uses_the_selected_identity_not_configuration_writability() {
        for mode in ["readWrite", "readOnly"] {
            let firmware = Firmware {
                major: 6,
                minor: 6,
                hardware_name: Some("Thor300".into()),
                access_mode: mode.into(),
            };
            let projected = firmware_info(&firmware, "1.3.0");
            assert_eq!(projected["accessMode"], mode);
            assert_eq!(projected["vescVersion"], "6.06");
        }
    }
}
