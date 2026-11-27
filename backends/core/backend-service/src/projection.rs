//! Typed domain records for the shared server; no native reconstruction.
use crate::{BackendService, facts as f, os};
use float_view_application_runtime::{coordinator as c, telemetry};
use float_view_product_store as store;
pub(crate) fn date(epoch_ms: i64) -> String {
    time::OffsetDateTime::from_unix_timestamp_nanos(i128::from(epoch_ms) * 1_000_000)
        .ok()
        .and_then(|d| {
            d.format(&time::format_description::well_known::Rfc3339)
                .ok()
        })
        .unwrap_or_default()
}
pub(crate) fn camel(value: impl std::fmt::Debug) -> String {
    let text = format!("{value:?}");
    let mut chars = text.chars();
    chars
        .next()
        .map(|c| c.to_ascii_lowercase().to_string() + chars.as_str())
        .unwrap_or_default()
}
fn permission(p: os::Permission) -> String {
    match p {
        os::Permission::NotDetermined => "not_determined".into(),
        os::Permission::NotRequired => "not_required".into(),
        _ => camel(p),
    }
}
pub(crate) fn route(route: c::discovery::Route) -> f::Route {
    match route {
        c::discovery::Route::Direct => f::Route::Direct,
        c::discovery::Route::Can(can_id) => f::Route::Can { can_id },
    }
}
pub(crate) fn configuration(
    s: &c::configuration::Snapshot,
    reason: Option<c::ConfigurationWriteBlockReason>,
) -> f::ConfigurationSummary {
    f::ConfigurationSummary {
        availability: camel(s.availability),
        writable: s.writable,
        write_block_reason: reason.map(camel),
        package_version: s.identity.as_ref().map(|i| i.package_version.to_string()),
        schema_fingerprint: s.identity.as_ref().map(|i| i.fingerprint.to_string()),
        wire_signature: s.identity.as_ref().map(|i| i.wire_signature),
        current_loaded: s.current.is_some(),
        default_loaded: s.defaults.is_some(),
        pending_operation: s.pending.map(camel),
    }
}
pub(crate) fn session(s: &store::Session) -> f::Session {
    f::Session {
        session_id: s.session_id.clone(),
        device_history_id: s.device_history_id.clone(),
        display_name: s
            .device_snapshot
            .get("displayName")
            .and_then(|v| v.as_str())
            .unwrap_or(&s.device_history_id)
            .into(),
        started_at: date(s.started_at_ms),
        ended_at: s.ended_at_ms.map(date),
        state: s.state.clone(),
        integrity: s.integrity.clone(),
        sample_count: s.stored_sample_count,
        event_count: s.event_count,
        riding_elapsed_ms: s.riding_elapsed_ms,
        total_elapsed_ms: s.total_elapsed_ms,
        distance_m: s.distance_m,
        max_speed_mps: s.max_speed_mps,
        max_duty_cycle: s.max_duty_cycle,
    }
}
pub(crate) fn boundary(s: &store::Session) -> f::Boundary {
    f::Boundary {
        history_revision: s.history_revision,
        committed_sample_sequence: s.committed_sequence,
        committed_event_sequence: s.committed_event_sequence,
        committed_elapsed_ms: s.committed_elapsed_ms,
        recorded_sample_count: s.recorded_sample_count,
        stored_sample_count: s.stored_sample_count,
        committed_location_sequence: s.committed_location_sequence,
        committed_location_elapsed_ms: s.committed_location_elapsed_ms,
        recorded_location_count: s.recorded_location_count,
        stored_location_count: s.stored_location_count,
        location_status: s.location_status.clone(),
    }
}
impl BackendService {
    pub(crate) fn refresh_boards(&mut self) -> store::Result<()> {
        if let Some(active) = self.policy.active.as_mut() {
            active.session_storage_bytes = active
                .session
                .as_ref()
                .and_then(|session| self.store.session_storage_bytes(&session.session_id).ok());
        }
        let boards = self.store.boards()?;
        self.policy.saved_device_ids = boards
            .iter()
            .filter_map(|b| b.local_identifier.clone())
            .collect();
        self.policy.boards = boards
            .iter()
            .map(|b| self.board_facts(b))
            .collect::<store::Result<_>>()?;
        Ok(())
    }
    pub(crate) fn board_facts(&self, b: &store::Board) -> store::Result<f::SavedBoard> {
        let profile = self.store.profile(&b.saved_device_id)?;
        let h = self.store.board_history(&b.device_history_id)?;
        let active = self.policy.active.as_ref().filter(|active| {
            active
                .session
                .as_ref()
                .is_some_and(|session| session.device_history_id == b.device_history_id)
        });
        let excluded_id = active
            .and_then(|active| active.session.as_ref())
            .map(|session| session.session_id.as_str());
        let active_bytes = active.map_or(Some(0), |active| active.session_storage_bytes);
        let storage_bytes = self
            .store
            .board_session_storage_bytes(&b.device_history_id, excluded_id)
            .ok()
            .zip(active_bytes)
            .and_then(|(rest, active)| rest.checked_add(active));
        Ok(f::SavedBoard {
            appearance: profile.appearance(),
            saved_device_id: b.saved_device_id.clone(),
            device_history_id: b.device_history_id.clone(),
            revision: b.revision,
            display_name: b.display_name().into(),
            custom_display_name: b.custom_display_name.clone(),
            advertised_name: b.advertised_name.clone(),
            bluetooth_identifier: b.local_identifier.clone(),
            last_seen_at: b.last_seen_at_ms.map(date),
            last_connected_at: b.last_connected_at_ms.map(date),
            profile_complete: profile.missing_fields().is_empty(),
            summary: f::BoardHistory {
                session_count: h.session_count,
                total_riding_elapsed_ms: h.total_riding_elapsed_ms,
                total_distance_m: h.total_distance_m,
                most_recent_session_at: h.most_recent_session_at_ms.map(date),
                total_storage_bytes: storage_bytes,
            },
        })
    }
    pub fn service_revision(&self) -> u64 {
        self.policy.revision
    }
    pub fn published_snapshot(&self) -> f::Snapshot {
        let p = &self.policy;
        let runtime = self.runtime.snapshot().application;
        let active = p.active.as_ref().map(|a| {
            let state = if runtime.phase == c::Phase::Failed {
                "failed"
            } else if a.reconnect_started.is_some() {
                "reconnecting"
            } else {
                match a.state {
                    os::LinkState::Connecting => "connecting",
                    os::LinkState::DiscoveringServices | os::LinkState::EnablingNotifications => {
                        "discovering_services"
                    }
                    os::LinkState::Disconnected => "disconnected",
                    os::LinkState::Failed => "failed",
                    os::LinkState::Ready => match runtime.phase {
                        c::Phase::Ready => "ready",
                        c::Phase::Failed => "failed",
                        c::Phase::SelectingController => "selecting_controller",
                        _ => "identifying",
                    },
                }
            };
            f::Connection {
                device_id: a.device.id.clone(),
                name: a.device.name.clone(),
                state: state.into(),
                device_kind: if runtime.standalone_bms {
                    Some("bms".into())
                } else if runtime.phase == c::Phase::Ready {
                    Some("board".into())
                } else {
                    None
                },
                tracking_mode: if a.saved { "saved" } else { "guest" }.into(),
                saved_device: a
                    .board
                    .as_ref()
                    .and_then(|b| {
                        p.boards
                            .iter()
                            .find(|f| f.saved_device_id == b.saved_device_id)
                    })
                    .cloned(),
                active_session: a.session.as_ref().map(session),
                latest_sample: a.latest.as_ref().map(|v| sample(v, a.latest_load)),
                battery_estimate: a.battery.estimate.clone(),
                battery_warning: self.battery_warning(),
                live_widget_slots: a.live_widget_slots.clone(),
                latest_location: p.latest_location.clone(),
                current_limits: runtime.current_limits.as_ref().map(|v| f::CurrentLimits {
                    motor_current_max_a: v.motor_current_max_a,
                    motor_current_min_a: v.motor_current_min_a,
                    battery_current_max_a: v.battery_current_max_a,
                    battery_current_min_a: v.battery_current_min_a,
                    battery_series_cells: v.battery_series_cells,
                }),
                controller_route: runtime.discovery.route.map(route),
                transport_firmware: runtime.discovery.transport.as_ref().map(|identity| {
                    f::TransportFirmware {
                        vesc_version: format!("{}.{:02}", identity.major, identity.minor),
                        hardware_name: Some(identity.hardware_name.clone()),
                        firmware_name: identity.firmware_name.clone(),
                        test_version: identity.test_version,
                    }
                }),
                controller_candidates: runtime
                    .discovery
                    .candidates
                    .iter()
                    .map(|v| f::ControllerCandidate {
                        can_id: v.can_id,
                        hardware_name: Some(v.hardware_name.clone()),
                        firmware_name: v.firmware_name.clone(),
                        vesc_version: v.vesc_version.clone(),
                        vesc_supported: v.vesc_supported,
                    })
                    .collect(),
                connection_warning: runtime
                    .possible_can_id_conflict
                    .then(|| f::ConnectionIssue {
                        refloat_compatibility: None,
                        code: "possible_can_id_conflict".into(),
                        message: c::CAN_REPLY_WARNING.into(),
                    }),
                connection_issue: runtime.discovery.issue.map(|i| f::ConnectionIssue {
                    code: i.code.as_str().into(),
                    message: i.message.into(),
                    refloat_compatibility: (i.code == c::discovery::IssueCode::UnsupportedRefloat)
                        .then_some(runtime.reported_refloat_version.as_ref())
                        .flatten()
                        .filter(|_| runtime.discovery.refloat_profile.is_none())
                        .map(|version| f::RefloatCompatibility {
                            reported_version: version.clone(),
                            supported_versions: c::compatibility::SUPPORTED_VERSIONS
                                .iter()
                                .map(|version| (*version).to_owned())
                                .collect(),
                        }),
                }),
                bms: f::Bms {
                    status: camel(runtime.bms.status),
                    connection: runtime.bms.route.map(route),
                    candidates: runtime
                        .bms
                        .candidates
                        .iter()
                        .map(|v| f::BmsCandidate {
                            connection: route(v.route),
                            hardware_name: Some(v.hardware_name.clone()),
                            vesc_version: v.vesc_version.clone(),
                        })
                        .collect(),
                    latest_snapshot: a.bms.as_ref().map(bms),
                },
                refloat_controls: runtime.mutations.controls.as_ref().map(controls),
                controller_actions: f::ControllerActions {
                    shutdown_available: runtime.mutations.controller_actions.shutdown_available,
                    pending_action: runtime
                        .mutations
                        .controller_actions
                        .shutdown_pending
                        .then(|| "shutdown".into()),
                },
            }
        });
        f::Snapshot {
            speed_calibration: self.calibration.snapshot(&runtime),
            paused_ride: p.ride.as_ref().and_then(|r| {
                r.resume_until_ms.map(|deadline| f::PausedRide {
                    session_id: r.session_id.clone(),
                    saved_device_id: r.saved_device_id.clone(),
                    display_name: p
                        .boards
                        .iter()
                        .find(|b| b.saved_device_id == r.saved_device_id)
                        .map_or_else(|| "Board".into(), |b| b.display_name.clone()),
                    resume_until: date(deadline),
                })
            }),
            hermes: self.hermes_state(),
            announcement_audio: self.policy.announcements.audio.clone(),
            battery_presets: store::battery_presets::PRESETS.clone(),
            battery_preset_catalog_version: store::battery_presets::CATALOG_VERSION.into(),
            battery_cell_profiles: store::battery_catalog::PROFILES
                .iter()
                .map(|p| f::BatteryCellProfile {
                    id: p.id.into(),
                    label: p.label.into(),
                })
                .collect(),
            discovery: f::Discovery {
                bluetooth_state: self.bluetooth_facts(),
                active_scan_id: p.scan.map(|s| s.0.to_string()),
                known_devices: p
                    .visible_devices
                    .values()
                    .map(|d| f::Device {
                        device_id: d.id.clone(),
                        name: d.name.clone(),
                        rssi: d.rssi,
                        last_seen_at: date(d.epoch),
                        saved_device_id: p
                            .boards
                            .iter()
                            .find(|b| b.bluetooth_identifier.as_deref() == Some(&d.id))
                            .map(|b| b.saved_device_id.clone()),
                    })
                    .collect(),
            },
            active,
            firmware: runtime.discovery.selected.as_ref().map(|i| f::Firmware {
                major: i.identity.major,
                minor: i.identity.minor,
                hardware_name: Some(i.identity.hardware_name.clone()),
                access_mode: runtime
                    .discovery
                    .selected_access
                    .map(camel)
                    .unwrap_or_else(|| "readOnly".into()),
            }),
            package_version: p.active.as_ref().and_then(|a| a.package_version.clone()),
            configuration: configuration(
                &runtime.configuration,
                runtime.configuration_write_block_reason,
            ),
            saved_boards: p.boards.clone(),
            settings: settings(&p.settings),
            permissions: self.permission_rows(),
            location: self.location_facts(),
            maintenance: self.maintenance().ok().flatten().as_ref().map(maintenance),
        }
    }
    pub(crate) fn bluetooth_facts(&self) -> f::Bluetooth {
        f::Bluetooth {
            radio: match self.policy.radio {
                os::Radio::PoweredOn => "powered_on".into(),
                os::Radio::PoweredOff => "powered_off".into(),
                os::Radio::Unauthorized => "unknown".into(),
                r => camel(r),
            },
            scan_permission: permission(self.policy.scan_permission),
            connect_permission: permission(self.policy.connect_permission),
        }
    }
    pub(crate) fn location_facts(&self) -> f::Location {
        let row = self.location_recovery_row();
        f::Location {
            permission_action: row.as_ref().and_then(|r| r.action),
            authorization: camel(self.policy.location_authorization),
            background_capture: if self.policy.location_background {
                "available"
            } else if matches!(
                self.policy.location_authorization,
                os::LocationAuthorization::Authorized | os::LocationAuthorization::ForegroundOnly
            ) {
                "foregroundOnly"
            } else {
                "unavailable"
            }
            .into(),
            reason: None,
        }
    }
}

pub(crate) fn settings(v: &store::Settings) -> f::Settings {
    f::Settings {
        auto_connect_saved_device_id: v.auto_connect_saved_device_id.clone(),
        safety_disclaimer_accepted: v.safety_disclaimer_accepted,
        announcements: v.announcements.clone(),
        revision: v.revision,
        idle_probe_interval_ms: v.idle_probe_interval_ms,
        idle_persist_interval_ms: v.idle_persist_interval_ms,
        riding_persist_interval_ms: v.riding_persist_interval_ms,
        post_ride_tail_ms: v.post_ride_tail_ms,
        reconnect_duration_ms: v.reconnect_duration_ms,
        minimum_session_distance: v.minimum_session_distance,
        ride_resume_window_minutes: v.ride_resume_window_minutes,
        theme_preference: v.theme_preference.clone(),
        accent_preference: v.accent_preference.clone(),
        unit_preference: v.unit_preference.clone(),
        live_widget_slots: v.live_widget_slots.clone(),
        session_display_options: v.session_display_options.clone(),
        history_gap_threshold_seconds: v.history_gap_threshold_seconds,
        location_recording_enabled: v.location_recording_enabled,
        include_gps_location_when_exporting: v.include_gps_location_when_exporting,
    }
}

pub(crate) fn maintenance(v: &store::Maintenance) -> f::Maintenance {
    f::Maintenance {
        operation_id: v.operation_id.clone(),
        kind: v.kind.clone(),
        scope: v.scope.clone(),
        state: v.state.clone(),
        session_id: v.session_id.clone(),
        target_resolution_seconds: v.target_resolution_seconds,
        upper_session_id: v.upper_session_id.clone(),
        last_session_id: v.last_session_id.clone(),
        completed_sessions: v.completed_sessions,
        skipped_sessions: v.skipped_sessions,
        retained_samples: v.retained_samples,
        reclaimable_bytes: v.reclaimable_bytes,
        error: v.error.clone(),
    }
}

pub(crate) fn controls(v: &c::mutation::Controls) -> f::Controls {
    f::Controls {
        status: camel(v.status),
        writable: v.writable,
        package_enabled: v.package_enabled,
        flywheel_enabled: v.flywheel_enabled,
        lighting_available: v.lighting_available,
        leds_enabled: v.leds_enabled,
        headlights_enabled: v.headlights_enabled,
        fatal_error_clear_available: v.fatal_error_clear_available,
        imu_timeout_available: v.imu_timeout_available,
        fatal_error_latched: v.fatal_error_latched,
        fatal_error_active: v.fatal_error_active,
        fatal_error_clearable: v.fatal_error_clearable,
        pending_action: v.pending_action.map(camel),
    }
}

pub(crate) fn sample(
    v: &telemetry::NormalizedSample,
    load: float_view_application_runtime::load::Load,
) -> f::LiveSample {
    f::LiveSample {
        load,
        sequence: v.sequence,
        observed_at: date(v.observed_at_epoch_ms),
        slow_observed_at: v.slow_observed_at_epoch_ms.map(date),
        elapsed_ms: v.elapsed_ms,
        riding_elapsed_ms: v.riding_elapsed_ms,
        ride_state: camel(v.ride_state),
        package_state: v.package_state.map(camel),
        package_mode: v.package_mode.map(camel),
        footpad_state: v.footpad_state.map(camel),
        stop_condition: v.stop_condition.map(camel),
        setpoint_adjustment: v.setpoint_adjustment.map(camel),
        wheelslip: v.wheelslip,
        darkride: v.darkride,
        charging: v.charging,
        alert_reason: v.alert_reason.map(camel),
        firmware_fault: v.firmware_fault.map(camel),
        imu_timeout_active: v.imu_timeout_active,
        fatal_error_latched: v.fatal_error_latched,
        last_firmware_fault: v.last_firmware_fault.map(|fault| f::ReportedFirmwareFault {
            code: fault.code,
            reason: camel(fault.reason),
        }),
        imu_timeout_history: v
            .imu_timeout_history
            .iter()
            .map(|entry| f::RecoveredImuTimeout {
                active: entry.active,
                elapsed_ms: entry.elapsed_ms,
                observed_elapsed_ms: entry.observed_elapsed_ms,
            })
            .collect(),
        fault_history: v
            .fault_history
            .iter()
            .map(|fault| f::RecoveredFirmwareFault {
                code: fault.code,
                reason: camel(fault.reason),
                elapsed_ms: fault.elapsed_ms,
                observed_elapsed_ms: fault.observed_elapsed_ms,
            })
            .collect(),
        pack_voltage_v: v.pack_voltage_v,
        duty_cycle: v.duty_cycle,
        controller_temp_c: v.controller_temp_c,
        motor_temp_c: v.motor_temp_c,
        motor_current_a: v.motor_current_a,
        battery_current_a: v.battery_current_a,
        erpm: v.erpm,
        speed_kph: v.speed_kph,
        max_speed_kph: v.max_speed_kph,
        pitch_deg: v.pitch_deg,
        balance_pitch_deg: v.balance_pitch_deg,
        roll_deg: v.roll_deg,
        directional_motor_current_a: v.directional_motor_current_a,
        filtered_motor_current_a: v.filtered_motor_current_a,
        requested_balance_current_a: v.requested_balance_current_a,
        booster_current_a: v.booster_current_a,
        field_weakening_current_a: v.field_weakening_current_a,
        footpad_adc1_v: v.footpad_adc1_v,
        footpad_adc2_v: v.footpad_adc2_v,
        remote_input: v.remote_input,
        setpoint_deg: v.setpoint_deg,
        atr_setpoint_deg: v.atr_setpoint_deg,
        brake_tilt_setpoint_deg: v.brake_tilt_setpoint_deg,
        torque_tilt_setpoint_deg: v.torque_tilt_setpoint_deg,
        turn_tilt_setpoint_deg: v.turn_tilt_setpoint_deg,
        remote_setpoint_deg: v.remote_setpoint_deg,
        atr_acceleration_difference_erpm_per_second: v.atr_acceleration_difference_erpm_per_second,
        atr_speed_boost: v.atr_speed_boost,
        distance_m: Some(v.ride_distance_m),
        odometer_m: v.odometer_m,
        amp_hours_drawn_ah: v.amp_hours_drawn_ah,
        amp_hours_charged_ah: v.amp_hours_charged_ah,
        watt_hours_drawn_wh: v.watt_hours_drawn_wh,
        watt_hours_charged_wh: v.watt_hours_charged_wh,
        battery_level: v.battery_level,
        charging_current_a: v.charging_current_a,
        charging_voltage_v: v.charging_voltage_v,
        extension_fields: v
            .extensions
            .iter()
            .map(|e| (e.name.clone(), e.value))
            .collect(),
    }
}

pub(crate) fn bms(v: &c::bms::BmsObservation) -> f::BmsSnapshot {
    f::BmsSnapshot {
        observed_at: date(v.observed_at_epoch_ms),
        total_voltage_v: v.total_voltage_v,
        charge_voltage_v: v.charge_voltage_v,
        input_current_a: v.input_current_a,
        input_ic_current_a: v.input_ic_current_a,
        session_amp_hours_ah: v.session_amp_hours_ah,
        session_watt_hours_wh: v.session_watt_hours_wh,
        cell_voltages_v: v.cell_voltages_v.clone(),
        balancing: v.balancing.clone(),
        temperatures_c: v.temperatures_c.clone(),
        ic_temperature_c: v.ic_temperature_c,
        humidity_sensor_temperature_c: v.humidity_sensor_temperature_c,
        humidity_percent: v.humidity_percent,
        highest_cell_temperature_c: v.highest_cell_temperature_c,
        highest_circuitry_temperature_c: v.highest_circuitry_temperature_c(),
        state_of_charge: v.state_of_charge,
        state_of_health: v.state_of_health,
        reported_can_id: v.reported_can_id,
        lifetime_charge_amp_hours_ah: v.lifetime_charge_amp_hours_ah,
        lifetime_charge_watt_hours_wh: v.lifetime_charge_watt_hours_wh,
        lifetime_discharge_amp_hours_ah: v.lifetime_discharge_amp_hours_ah,
        lifetime_discharge_watt_hours_wh: v.lifetime_discharge_watt_hours_wh,
        pressure_pa: v.pressure_pa,
        data_version: v.data_version,
        status: v.status.clone(),
    }
}
