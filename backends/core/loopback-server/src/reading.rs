//! Read-only session leases use the existing runtime reader without its mutable owner.
use crate::{
    facts::*,
    projection,
    protocol::{Failure, HistoryQuery},
};
use float_view_application_runtime::session::{self, SessionReader};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
struct Cancel(Arc<AtomicBool>);
impl Drop for Cancel {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}
async fn run<T: Send + 'static>(
    source: SessionSource,
    lease: Option<float_view_backend_service::SessionLease>,
    permit: Arc<tokio::sync::OwnedSemaphorePermit>,
    operation: impl FnOnce(&mut SessionReader, SessionMetadata) -> Result<T, Failure> + Send + 'static,
) -> Result<T, Failure> {
    if source.path.len() > 4096 || !std::path::Path::new(&source.path).is_absolute() {
        return Err(Failure::Internal);
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let _guard = Cancel(cancelled.clone());
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let _lease = lease;
        let mut reader = SessionReader::open_cancellable(&source.path, cancelled)
            .map_err(|_| Failure::Unavailable)?;
        let metadata = reader.metadata().map_err(|_| Failure::Unavailable)?;
        let recorded_fields: Vec<_> = reader
            .fields()
            .map_err(|_| Failure::Unavailable)?
            .into_iter()
            .filter(|field| field.first_sequence <= source.boundary.committed_sample_sequence)
            .collect();
        let extension_fields = recorded_fields
            .iter()
            .filter(|field| field.source == session::FieldSource::Extension)
            .map(|field| field.name.clone())
            .collect();
        let recorded_fields = recorded_fields
            .into_iter()
            .map(|field| field.name)
            .collect();
        let prune = PruneMetadata {
            target_resolution_seconds: (metadata.retained_resolution_seconds > 0)
                .then_some(metadata.retained_resolution_seconds),
            recorded_sample_count: source.boundary.recorded_sample_count,
            stored_sample_count: source.boundary.stored_sample_count,
            policy: metadata.prune_policy,
        };
        let marker_count = reader
            .ride_markers(session::PublishedBoundary {
                history_revision: source.boundary.history_revision,
                sample_sequence: source.boundary.committed_sample_sequence,
                event_sequence: source.boundary.committed_event_sequence,
                location_sequence: source.boundary.committed_location_sequence,
            })
            .map_err(|_| Failure::Unavailable)?
            .len();
        let connection_context_count = reader
            .connection_contexts(session::PublishedBoundary {
                history_revision: source.boundary.history_revision,
                sample_sequence: source.boundary.committed_sample_sequence,
                event_sequence: source.boundary.committed_event_sequence,
                location_sequence: source.boundary.committed_location_sequence,
            })
            .map_err(|_| Failure::Unavailable)?
            .len();
        let metadata = SessionMetadata {
            recording_breaks: reader
                .recording_breaks(session::PublishedBoundary {
                    history_revision: source.boundary.history_revision,
                    sample_sequence: source.boundary.committed_sample_sequence,
                    event_sequence: source.boundary.committed_event_sequence,
                    location_sequence: source.boundary.committed_location_sequence,
                })
                .map_err(|_| Failure::Unavailable)?,
            connection_context_count,
            marker_count,
            summary: source.summary,
            recorded_fields,
            extension_fields,
            boundary: source.boundary,
            prune,
        };
        operation(&mut reader, metadata)
    })
    .await
    .map_err(|_| Failure::Internal)?
}
pub async fn metadata(
    source: SessionSource,
    lease: Option<float_view_backend_service::SessionLease>,
    permit: Arc<tokio::sync::OwnedSemaphorePermit>,
) -> Result<SessionMetadata, Failure> {
    run(source, lease, permit, |_, metadata| Ok(metadata)).await
}
pub async fn read(
    source: SessionSource,
    lease: Option<float_view_backend_service::SessionLease>,
    query: HistoryQuery,
    permit: Arc<tokio::sync::OwnedSemaphorePermit>,
) -> Result<(SessionMetadata, HistoryResult, bool), Failure> {
    run(source, lease, permit, move |reader, metadata| {
        if query.fields.iter().any(|field| {
            !projection::NUMERIC_FIELDS.contains(&field.as_str())
                && !metadata.extension_fields.contains(field)
        }) {
            return Err(Failure::InvalidRequest);
        }
        let boundary = session::PublishedBoundary {
            history_revision: query.snapshot.history_revision,
            sample_sequence: query.snapshot.committed_sample_sequence,
            event_sequence: query.snapshot.committed_event_sequence,
            location_sequence: query.snapshot.committed_location_sequence,
        };
        let start = query.range.start_elapsed_ms;
        let end = query.range.end_elapsed_ms;
        let after =
            query
                .after_elapsed_ms
                .zip(query.after_sequence)
                .map(|(elapsed_ms, sequence)| session::SampleKey {
                    elapsed_ms,
                    sequence,
                });
        let mut more = false;
        let value = match query.kind.as_str() {
            "samples" => {
                let page = reader
                    .sample_page(&query.fields, start, end, query.limit, after, boundary)
                    .map_err(|_| Failure::InvalidRequest)?;
                more = page.next.is_some();
                HistoryResult::HistoryPoints(
                    page.rows
                        .into_iter()
                        .map(|row| HistoryPoint {
                            elapsed_ms: row.key.elapsed_ms,
                            sequence: row.key.sequence,
                            values: query.fields.iter().cloned().zip(row.values).collect(),
                        })
                        .collect(),
                )
            }
            "connectionContexts" => {
                let mut rows: Vec<_> = reader
                    .connection_contexts(boundary)
                    .map_err(|_| Failure::Unavailable)?
                    .into_iter()
                    .filter(|e| {
                        e.elapsed_ms >= start
                            && e.elapsed_ms <= end
                            && after.is_none_or(|a| {
                                (e.elapsed_ms, e.sequence) > (a.elapsed_ms, a.sequence)
                            })
                    })
                    .collect();
                more = rows.len() > query.limit;
                rows.truncate(query.limit);
                HistoryResult::ConnectionContexts(rows)
            }
            "markers" => {
                let mut rows: Vec<_> = reader
                    .ride_markers(boundary)
                    .map_err(|_| Failure::InvalidRequest)?
                    .into_iter()
                    .filter(|m| {
                        m.elapsed_ms >= start
                            && m.elapsed_ms <= end
                            && after.is_none_or(|a| {
                                (m.elapsed_ms, m.sequence) > (a.elapsed_ms, a.sequence)
                            })
                    })
                    .collect();
                more = rows.len() > query.limit;
                rows.truncate(query.limit);
                HistoryResult::RideMarkers(rows)
            }
            "events" => {
                let page = reader
                    .event_page(start, end, query.limit, after, boundary)
                    .map_err(|_| Failure::InvalidRequest)?;
                more = page.next.is_some();
                HistoryResult::HistoryEvents(
                    page.rows
                        .into_iter()
                        .map(|row| HistoryEvent {
                            event_id: row.key.sequence.to_string(),
                            elapsed_ms: row.key.elapsed_ms,
                            source_sample_sequence: row.source_sample_sequence,
                            kind: row.kind,
                            details_json: row.details_json,
                        })
                        .collect(),
                )
            }
            "series" => {
                let policy = match query.gap_seconds {
                    Some(seconds) => {
                        float_view_application_runtime::history::GapPolicy::explicit_seconds(
                            seconds,
                        )
                        .map_err(|_| Failure::InvalidRequest)?
                    }
                    None => float_view_application_runtime::history::GapPolicy::Automatic,
                };
                let result = reader
                    .reduce_series(&query.fields, start, end, query.buckets, policy, boundary)
                    .map_err(|_| Failure::InvalidRequest)?;
                HistoryResult::SeriesColumns(
                    result
                        .columns
                        .into_iter()
                        .map(|column| {
                            (
                                column.field,
                                SeriesColumn {
                                    elapsed_ms: column.elapsed_ms,
                                    sequence: column.sequences,
                                    values: column.values.into_iter().map(Some).collect(),
                                    generations: column.generations,
                                },
                            )
                        })
                        .collect(),
                )
            }
            "locations" => {
                let after = query
                    .location_cursor
                    .as_deref()
                    .map(|raw| crate::dispatch::decode_cursor(raw, 512))
                    .transpose()?
                    .map(|value| {
                        value["locationSequence"]
                            .as_u64()
                            .ok_or(Failure::InvalidRequest)
                    })
                    .transpose()?;
                let page = reader
                    .location_page(start, end, query.limit, after, boundary)
                    .map_err(|_| Failure::InvalidRequest)?;
                let next_cursor = page
                    .next_location_sequence
                    .map(|sequence| {
                        crate::dispatch::cursor(&serde_json::json!({
                         "sessionId": metadata.summary.session_id,
                         "startElapsedMs": start,
                         "endElapsedMs": end,
                         "historyRevision": boundary.history_revision,
                         "locationSequence": sequence
                        }))
                    })
                    .transpose()?;
                let points = page
                    .rows
                    .into_iter()
                    .map(|row| {
                        Ok(LocationPoint {
                            location_sequence: row.location_sequence,
                            elapsed_ms: row.elapsed_ms,
                            latitude: row.latitude,
                            longitude: row.longitude,
                            accuracy_m: row.accuracy_m,
                            altitude_m: row.altitude_m,
                            observed_at: time::OffsetDateTime::from_unix_timestamp_nanos(
                                i128::from(row.observed_at_epoch_ms) * 1_000_000,
                            )
                            .map_err(|_| Failure::InvalidRequest)?
                            .format(&time::format_description::well_known::Rfc3339)
                            .map_err(|_| Failure::Internal)?,
                        })
                    })
                    .collect::<Result<Vec<_>, Failure>>()?;
                HistoryResult::Locations(LocationPage {
                    points,
                    gaps: page
                        .gaps
                        .into_iter()
                        .map(|gap| LocationGap {
                            start_elapsed_ms: gap.start_elapsed_ms,
                            end_elapsed_ms: gap.end_elapsed_ms,
                            reason: "noFix".into(),
                        })
                        .collect(),
                    next_cursor,
                    snapshot: metadata.boundary.clone(),
                })
            }
            _ => return Err(Failure::InvalidRequest),
        };
        Ok((metadata, value, more))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use float_view_application_runtime::{
        session::{SessionMetadata as WriterMetadata, SessionWriter},
        telemetry::{NormalizedSample, RideState},
    };

    fn sample(sequence: u64, elapsed_ms: u64) -> NormalizedSample {
        NormalizedSample {
            sequence,
            observed_at_epoch_ms: 1_000_000 + elapsed_ms as i64,
            slow_observed_at_epoch_ms: None,
            elapsed_ms,
            riding_elapsed_ms: 0,
            ride_distance_m: 0.0,
            max_speed_kph: None,
            ride_state: RideState::Idle,
            package_state: None,
            package_mode: None,
            footpad_state: None,
            stop_condition: None,
            setpoint_adjustment: None,
            wheelslip: None,
            darkride: None,
            charging: None,
            alert_reason: None,
            firmware_fault: None,
            fatal_error_latched: None,
            last_firmware_fault: None,
            fault_history: Vec::new(),
            imu_timeout_active: None,
            imu_timeout_history: Vec::new(),
            pack_voltage_v: None,
            duty_cycle: None,
            controller_temp_c: None,
            motor_temp_c: None,
            bms_circuitry_temp_c: None,
            bms_highest_cell_temp_c: None,
            motor_current_a: None,
            battery_current_a: None,
            erpm: None,
            speed_kph: None,
            pitch_deg: None,
            balance_pitch_deg: None,
            roll_deg: None,
            directional_motor_current_a: None,
            filtered_motor_current_a: None,
            requested_balance_current_a: None,
            booster_current_a: None,
            field_weakening_current_a: None,
            footpad_adc1_v: None,
            footpad_adc2_v: None,
            remote_input: None,
            setpoint_deg: None,
            atr_setpoint_deg: None,
            brake_tilt_setpoint_deg: None,
            torque_tilt_setpoint_deg: None,
            turn_tilt_setpoint_deg: None,
            remote_setpoint_deg: None,
            atr_acceleration_difference_erpm_per_second: None,
            atr_speed_boost: None,
            distance_m: None,
            odometer_m: None,
            amp_hours_drawn_ah: None,
            amp_hours_charged_ah: None,
            watt_hours_drawn_wh: None,
            watt_hours_charged_wh: None,
            battery_level: None,
            charging_current_a: None,
            charging_voltage_v: None,
            extensions: Vec::new(),
        }
    }

    #[test]
    fn recorded_bms_temperatures_work_in_grouped_charts_and_sample_inspection() {
        let root = std::env::temp_dir().join(format!(
            "float-view-bms-chart-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("session.sqlite");
        let mut writer = SessionWriter::create(
            &path,
            WriterMetadata {
                expected_riding_persistence_ms: 100,
                expected_idle_persistence_ms: 1000,
                committed_at_epoch_ms: 1_000_000,
            },
        )
        .unwrap();
        let mut row = sample(1, 0);
        row.pack_voltage_v = Some(80.0);
        row.bms_circuitry_temp_c = Some(31.0);
        row.bms_highest_cell_temp_c = Some(32.0);
        writer.append_samples(&[row]).unwrap();
        let marker = writer.marker().unwrap();
        writer.close().unwrap();
        let source: SessionSource = serde_json::from_value(serde_json::json!({
            "path": path.to_str().unwrap(),
            "summary": {
                "sessionId": "recorded", "deviceHistoryId": "board", "displayName": "Board",
                "startedAt": "2026-10-25T00:00:00Z", "endedAt": null, "state": "active",
                "integrity": "complete", "sampleCount": 1, "eventCount": marker.committed_event_sequence,
                "ridingElapsedMs": 0, "totalElapsedMs": 0, "distanceM": null,
                "maxSpeedMps": null, "maxDutyCycle": null
            },
            "boundary": {
                "historyRevision": marker.history_revision, "committedSampleSequence": 1,
                "committedEventSequence": marker.committed_event_sequence, "committedElapsedMs": 0,
                "recordedSampleCount": 1, "storedSampleCount": 1,
                "committedLocationSequence": 0, "committedLocationElapsedMs": 0,
                "recordedLocationCount": 0, "storedLocationCount": 0, "locationStatus": "disabled"
            }
        })).unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        runtime.block_on(async {
            let semaphore = Arc::new(tokio::sync::Semaphore::new(1));
            for kind in ["series", "samples"] {
                let permit = Arc::new(semaphore.clone().acquire_owned().await.unwrap());
                let (metadata, result, _) = read(source.clone(), None, query(kind), permit)
                    .await
                    .unwrap();
                for field in ["bmsCircuitryTempC", "bmsHighestCellTempC"] {
                    assert!(metadata.recorded_fields.iter().any(|name| name == field));
                    assert!(!metadata.extension_fields.iter().any(|name| name == field));
                }
                match result {
                    HistoryResult::SeriesColumns(columns) => {
                        assert_eq!(columns["packVoltageV"].values, vec![Some(80.0)]);
                        assert_eq!(columns["bmsCircuitryTempC"].values, vec![Some(31.0)]);
                        assert_eq!(columns["bmsHighestCellTempC"].values, vec![Some(32.0)]);
                    }
                    HistoryResult::HistoryPoints(points) => {
                        assert_eq!(points.len(), 1);
                        assert_eq!(points[0].values["bmsCircuitryTempC"], Some(31.0));
                        assert_eq!(points[0].values["bmsHighestCellTempC"], Some(32.0));
                    }
                    _ => panic!("unexpected history result"),
                }
            }
            let mut unknown = query("series");
            unknown.fields.push("unrecordedExtension".into());
            let permit = Arc::new(semaphore.acquire_owned().await.unwrap());
            assert!(matches!(
                read(source, None, unknown, permit).await,
                Err(Failure::InvalidRequest)
            ));
        });
        std::fs::remove_dir_all(root).unwrap();
    }

    fn query(kind: &str) -> HistoryQuery {
        HistoryQuery {
            kind: kind.into(),
            snapshot: crate::protocol::PublishedBoundary {
                history_revision: 0,
                committed_sample_sequence: 1,
                committed_event_sequence: 0,
                committed_elapsed_ms: 0,
                committed_location_sequence: 0,
                committed_location_elapsed_ms: 0,
            },
            range: crate::protocol::Range {
                start_elapsed_ms: 0,
                end_elapsed_ms: 0,
            },
            fields: ["packVoltageV", "bmsCircuitryTempC", "bmsHighestCellTempC"]
                .map(String::from)
                .to_vec(),
            limit: 10,
            buckets: 10,
            gap_seconds: None,
            after_elapsed_ms: None,
            after_sequence: None,
            location_cursor: None,
        }
    }
}
