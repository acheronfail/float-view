#[path = "../../session-sqlite/tests/support/mod.rs"]
mod support;
use float_view_product_store::{
    Error, ExportFormat, FileCancellation, ImportSink, ProductStore, limits,
};
use float_view_refloat_telemetry_service::RideState;
use float_view_session_sqlite::{LocationObservation, SessionReader, SessionWriter};
use rusqlite::Connection;
use std::{fs, io::Read};
use support::{TestDirectory, sample};
fn setup() -> (TestDirectory, ProductStore, String) {
    let dir = TestDirectory::new();
    let mut store = ProductStore::open(dir.path()).unwrap();
    store
        .update_settings(0, r#"{"minimumSessionDistance":0}"#)
        .unwrap();
    let b = store
        .ensure_board("PRIVATE-LOCAL-ID", Some("Board"), Some(&[1; 12]), 1)
        .unwrap();
    store
        .update_profile(
            &b.saved_device_id,
            0,
            r#"{"batteryPresetId":"indy-speed-control-20s2p-gt-pack-molicel-p45b"}"#,
            1,
        )
        .unwrap();
    store
        .update_profile(
            &b.saved_device_id,
            1,
            r#"{"batteryMinimumCellVoltageV":3.23,"batteryCapacityAh":8.7}"#,
            1,
        )
        .unwrap();
    let appearance = float_view_product_store::BoardAppearance {
        rail: 4,
        hooks: 3,
        ..Default::default()
    };
    store
        .update_profile(
            &b.saved_device_id,
            2,
            &serde_json::json!({"appearance":appearance,"customDashboard":{"version":1,"widgets":[{"id":"volts","kind":"reading","field":"packVoltageV","presentation":"number","size":"medium"},{"id":"strip","kind":"visual","visual":"battery","size":{"columns":4,"rows":1}}]}}).to_string(),
            1,
        )
        .unwrap();
    let s = store
        .create_session(&b.saved_device_id, 1, u64::MAX)
        .unwrap();
    let mut w = SessionWriter::open(store.session_path(&s.session_id).unwrap()).unwrap();
    let mut samples = [sample(1, 1000), sample(2, 12000), sample(3, 30000)];
    for s in &mut samples {
        s.ride_state = RideState::Riding;
        s.speed_kph = Some(36.);
        s.extensions = vec![
            float_view_refloat_telemetry_service::ExtensionValue {
                name: "extensionA".into(),
                value: 1.,
            },
            float_view_refloat_telemetry_service::ExtensionValue {
                name: "extensionB".into(),
                value: 2.,
            },
        ];
    }
    w.append_samples(&samples).unwrap();
    w.append_fault_history(
        &float_view_refloat_telemetry_service::FaultHistoryObservation {
            source_clock: Some(float_view_refloat_telemetry_service::FaultClock {
                ticks: 300000,
                elapsed_ms: 30000,
            }),
            elapsed_ms: 30_000,
            observed_at_epoch_ms: 1_030_000,
            records: vec![
                float_view_refloat_telemetry_service::FaultRecord {
                    kind: float_view_refloat_telemetry_service::AlertKind::FirmwareFault,
                    source_ticks: 298123,
                    active: true,
                    raw_code: 4,
                },
                float_view_refloat_telemetry_service::FaultRecord {
                    kind: float_view_refloat_telemetry_service::AlertKind::FirmwareFault,
                    source_ticks: 298124,
                    active: false,
                    raw_code: 0,
                },
                float_view_refloat_telemetry_service::FaultRecord {
                    kind: float_view_refloat_telemetry_service::AlertKind::ImuTimeout,
                    source_ticks: 298125,
                    active: true,
                    raw_code: 0,
                },
            ],
        },
    )
    .unwrap();
    w.append_locations(&[
        LocationObservation {
            observed_at_epoch_ms: 1_000_000,
            elapsed_ms: 0,
            latitude: 1.,
            longitude: 2.,
            accuracy_m: Some(3.),
            altitude_m: Some(-8.),
        },
        LocationObservation {
            observed_at_epoch_ms: 1_002_000,
            elapsed_ms: 2000,
            latitude: 4.,
            longitude: 5.,
            accuracy_m: Some(6.),
            altitude_m: Some(f64::INFINITY),
        },
    ])
    .unwrap();
    w.close().unwrap();
    store
        .close_session(&s.session_id, 100_000, "disconnect")
        .unwrap();
    (dir, store, s.session_id)
}
fn sink(store: &ProductStore, path: &std::path::Path) -> ImportSink {
    let mut input = fs::File::open(path).unwrap();
    let mut sink = store.begin_import(input.metadata().unwrap().len()).unwrap();
    let mut buffer = [0; 65536];
    let mut offset = 0;
    loop {
        let n = input.read(&mut buffer).unwrap();
        if n == 0 {
            break;
        }
        sink.write(offset, &buffer[..n]).unwrap();
        offset += n as u64;
    }
    sink
}

fn location_altitudes(store: &ProductStore, id: &str) -> Vec<Option<f64>> {
    let mut reader = SessionReader::open(store.session_path(id).unwrap()).unwrap();
    let boundary = reader.marker().unwrap();
    reader
        .location_page(0, 30_000, 100, None, (&boundary).into())
        .unwrap()
        .rows
        .into_iter()
        .map(|row| row.altitude_m)
        .collect()
}

#[test]
fn frozen_public_baseline_archive_imports_without_changing_settings() {
    let root = TestDirectory::new();
    let mut store = ProductStore::open(root.path()).unwrap();
    let bytes = include_bytes!("../../../fixtures/public-baseline/100/recording.floatview");
    let mut input = store.begin_import(bytes.len() as u64).unwrap();
    for (index, chunk) in bytes.chunks(65_536).enumerate() {
        input.write((index * 65_536) as u64, chunk).unwrap();
    }
    let settings = store.settings().unwrap();
    let imported = store
        .attach_import(input.validate(&FileCancellation::default()).unwrap())
        .unwrap();
    assert_eq!(store.settings().unwrap(), settings);
    let mut reader =
        SessionReader::open(store.session_path(&imported.session_id).unwrap()).unwrap();
    let boundary = reader.marker().unwrap();
    assert_eq!(boundary.recorded_location_count, 1);
    assert_eq!(location_altitudes(&store, &imported.session_id), [None]);
    assert_eq!(reader.ride_markers((&boundary).into()).unwrap().len(), 1);
    assert!(
        reader
            .connection_contexts((&boundary).into())
            .unwrap()
            .is_empty()
    );
    assert!(store.boards().unwrap()[0].local_identifier.is_none());
}
#[test]
fn archive_roundtrip_preserves_portable_recording_identity() {
    let (_dir, mut store, id) = setup();
    let preferred = store.boards().unwrap()[0].saved_device_id.clone();
    store
        .update_settings(
            store.settings().unwrap().revision,
            &serde_json::json!({"autoConnectSavedDeviceId":preferred}).to_string(),
        )
        .unwrap();
    let record = r#"{"v":1,"event":"summary","data":{"append_us":[10,100,200,300]}}"#;
    let mut diagnostics =
        float_view_session_sqlite::DiagnosticWriter::open(&store.session_path(&id).unwrap())
            .unwrap();
    diagnostics.append(&[record.into()]).unwrap();
    drop(diagnostics);
    let cancel = FileCancellation::default();
    let export = store
        .prepare_export(&id, ExportFormat::Archive)
        .unwrap()
        .run(&cancel)
        .unwrap();
    let db = Connection::open(export.path()).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT value FROM float_view_archive_metadata WHERE key='format_version'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "5"
    );
    let manifest: String = db
        .query_row(
            "SELECT value FROM float_view_archive_metadata WHERE key='session'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!manifest.contains("PRIVATE-LOCAL-ID"));
    assert!(!manifest.contains("autoConnectSavedDeviceId"));
    drop(db);
    let target = TestDirectory::new();
    let mut imported = ProductStore::open(target.path()).unwrap();
    let value = sink(&imported, export.path()).validate(&cancel).unwrap();
    let settings_before = imported.settings().unwrap();
    let session = imported.attach_import(value).unwrap();
    assert_eq!(imported.settings().unwrap(), settings_before);
    assert_eq!(session.session_id, id);
    assert_eq!(location_altitudes(&imported, &id), [Some(-8.), None]);
    let db = Connection::open(imported.session_path(&session.session_id).unwrap()).unwrap();
    assert_eq!(
        db.query_row("SELECT record_json FROM session_diagnostic", [], |r| r
            .get::<_, String>(
            0
        ))
        .unwrap(),
        record
    );
    drop(db);
    let board = imported.boards().unwrap().remove(0);
    let profile = imported.profile(&board.saved_device_id).unwrap();
    assert_eq!(
        profile.values["customDashboard"]["widgets"][0]["field"],
        "packVoltageV"
    );
    assert_eq!(
        profile.values["customDashboard"]["widgets"][0]["size"],
        "medium"
    );
    assert_eq!(
        profile.values["customDashboard"]["widgets"][1]["size"],
        serde_json::json!({"columns":4,"rows":1})
    );
    assert_eq!(profile.values["batteryCellProfileId"], "molicel-p45b");
    assert_eq!(profile.values["batteryMinimumCellVoltageV"], 3.23);
    assert_eq!(profile.values["batteryCapacityAh"], 8.7);
    assert_eq!(profile.appearance().rail, 4);
    assert_eq!(profile.appearance().hooks, 3);
    assert_eq!(
        profile.values["batteryPresetId"],
        "indy-speed-control-20s2p-gt-pack-molicel-p45b"
    );
    assert_eq!(
        session.device_history_id,
        store.session(&id).unwrap().device_history_id
    );
    assert_eq!(session.recorded_sample_count, 3);
    assert_eq!(session.recorded_location_count, 2);
    assert!(imported.boards().unwrap()[0].local_identifier.is_none());
    assert_eq!(imported.boards().unwrap().len(), 1);
    let mut reader =
        SessionReader::open(imported.session_path(&session.session_id).unwrap()).unwrap();
    assert_eq!(reader.marker().unwrap().recorded_sample_count, 3);
    let boundary = reader.marker().unwrap();
    let events = reader
        .event_page(0, 30_000, 100, None, (&boundary).into())
        .unwrap();
    let faults: Vec<_> = events
        .rows
        .iter()
        .filter(|row| row.kind == "firmwareFaultHistory")
        .collect();
    let timeout = events
        .rows
        .iter()
        .find(|r| r.kind == "imuTimeoutHistory")
        .expect("timeout survives archive import");
    let timeout: serde_json::Value = serde_json::from_str(&timeout.details_json).unwrap();
    assert_eq!(timeout["active"], true);
    assert_eq!(timeout["sourceTicks"], 298125);
    assert_eq!(faults.len(), 2);
    let fault: serde_json::Value = serde_json::from_str(&faults[0].details_json).unwrap();
    assert_eq!(fault["rawCode"], 4);
    assert_eq!(fault["sourceTicks"], 298123);
    assert_eq!(fault["occurredElapsedMs"], 29813);
    assert_eq!(fault["value"], "absoluteOverCurrent");
    drop(reader);
    let current = imported.profile(&board.saved_device_id).unwrap();
    imported
        .update_profile(
            &board.saved_device_id,
            current.revision,
            r#"{"customDashboard":{"version":1,"widgets":[]}}"#,
            100_001,
        )
        .unwrap();
    let second = imported
        .attach_import(sink(&imported, export.path()).validate(&cancel).unwrap())
        .unwrap();
    assert_eq!(second.session_id, session.session_id);
    assert_eq!(imported.boards().unwrap().len(), 1);
    assert_eq!(
        imported.profile(&board.saved_device_id).unwrap().values["customDashboard"]["widgets"],
        serde_json::json!([])
    );
}
fn read_csv_zip(path: &std::path::Path) -> String {
    use std::io::Read;
    assert!(path.to_str().unwrap().ends_with(".csv.zip"));
    let mut zip = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    assert_eq!(zip.len(), 1);
    let mut csv = zip.by_index(0).unwrap();
    assert_eq!(csv.name(), path.file_stem().unwrap().to_str().unwrap());
    assert_eq!(csv.compression(), zip::CompressionMethod::Deflated);
    let mut text = String::new();
    csv.read_to_string(&mut text).unwrap();
    assert!(csv.compressed_size() < csv.size());
    text
}

#[test]
fn export_names_include_ride_start_with_isolated_staging_and_cleanup() {
    let (dir, mut store, id) = setup();
    let board = store.boards().unwrap().remove(0);
    store
        .update_board(
            &board.saved_device_id,
            board.revision,
            Some("  My / Street Board?!  "),
        )
        .unwrap();
    let cancel = FileCancellation::default();
    let mut exports = Vec::new();
    for format in [
        ExportFormat::Archive,
        ExportFormat::Archive,
        ExportFormat::Csv,
        ExportFormat::Csv,
    ] {
        // The staging byte budget admits two concurrent maximum-sized exports.
        if exports.len() == 2 {
            assert!(
                exports
                    .iter()
                    .all(|file: &float_view_product_store::StagedFile| file.len().unwrap() > 0)
            );
            exports.clear();
        }
        let export = store
            .prepare_export(&id, format)
            .unwrap()
            .run(&cancel)
            .unwrap();
        let name = export.path().file_name().unwrap().to_str().unwrap();
        assert_eq!(
            name,
            if format == ExportFormat::Archive {
                "my_street_board-1970-01-01_00-00-00Z.floatview"
            } else {
                "my_street_board-1970-01-01_00-00-00Z.csv.zip"
            }
        );
        assert!(
            exports
                .iter()
                .all(|file: &float_view_product_store::StagedFile| file.path() != export.path())
        );
        if format == ExportFormat::Csv {
            read_csv_zip(export.path());
        }
        exports.push(export);
    }
    assert!(exports.iter().all(|file| file.len().unwrap() > 0));
    drop(exports);
    assert_eq!(fs::read_dir(dir.path().join("Exports")).unwrap().count(), 0);

    // Simulate an interrupted process, including old flat staging files.
    drop(store);
    let stale = dir.path().join("Exports/interrupted-transfer");
    fs::create_dir(&stale).unwrap();
    fs::write(stale.join("float-view.tmp"), b"partial").unwrap();
    fs::write(dir.path().join("Exports/float-view-old.tmp"), b"partial").unwrap();
    let _reopened = ProductStore::open(dir.path()).unwrap();
    assert_eq!(fs::read_dir(dir.path().join("Exports")).unwrap().count(), 0);
}

#[test]
fn csv_columns_gps_privacy_ties_and_tolerance_match_native_encoding() {
    let (_dir, mut store, id) = setup();
    let cancel = FileCancellation::default();
    let export = store
        .prepare_export(&id, ExportFormat::Csv)
        .unwrap()
        .run(&cancel)
        .unwrap();
    let plain = read_csv_zip(export.path());
    assert_eq!(plain.lines().next().unwrap().split(',').count(), 54);
    assert!(!plain.contains("gpsLatitude"));
    assert_eq!(
        plain.lines().next().unwrap(),
        include_str!("../../../../conformance/fixtures/session-csv-header.txt").trim_end()
    );
    assert!(
        plain
            .lines()
            .nth(1)
            .unwrap()
            .contains(r#""{""extensionA"":1.0,""extensionB"":2.0}""#)
    );
    drop(export);
    let revision = store.settings().unwrap().revision;
    store
        .update_settings(revision, r#"{"includeGpsLocationWhenExporting":true}"#)
        .unwrap();
    let export = store
        .prepare_export(&id, ExportFormat::Csv)
        .unwrap()
        .run(&cancel)
        .unwrap();
    let text = read_csv_zip(export.path());
    let lines: Vec<_> = text.lines().collect();
    assert!(lines[0].ends_with(",gpsAccuracy,gpsLongitude,gpsLatitude"));
    assert!(lines[1].ends_with(",3.0,2.0,1.0"));
    assert!(lines[2].ends_with(",6.0,5.0,4.0"));
    assert!(lines[3].ends_with(",,,"));
}
#[test]
fn transfer_bounds_offsets_and_cancellation_cleanup() {
    let (dir, store, id) = setup();
    assert!(matches!(
        store.begin_import(limits::MAX_IMPORT_BYTES + 1),
        Err(Error::InvalidInput)
    ));
    let mut a = store.begin_import(limits::MAX_IMPORT_BYTES).unwrap();
    let b = store.begin_import(1).unwrap();
    assert!(matches!(store.begin_import(1), Err(Error::Capacity)));
    assert_eq!(a.write(1, &[0]), Err(Error::InvalidInput));
    assert_eq!(a.write(0, &vec![0; 65537]), Err(Error::InvalidInput));
    a.write(0, &[0; 65536]).unwrap();
    drop(a);
    drop(b);
    let cancel = FileCancellation::default();
    cancel.cancel();
    for format in [ExportFormat::Archive, ExportFormat::Csv] {
        let work = store.prepare_export(&id, format).unwrap();
        assert!(matches!(work.run(&cancel), Err(Error::Cancelled)));
    }
    assert_eq!(fs::read_dir(dir.file("Exports")).unwrap().count(), 0);
    assert!(fs::read_dir(dir.path()).unwrap().all(|e| {
        !e.unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("import-")
    }));
}
#[test]
fn malformed_schema_metadata_and_attachment_failure_leave_no_catalog_changes() {
    let (_dir, store, id) = setup();
    let cancel = FileCancellation::default();
    for sql in [
        "CREATE TRIGGER hostile AFTER INSERT ON sample BEGIN DELETE FROM sample; END",
        "UPDATE float_view_archive_metadata SET value='{}' WHERE key='session'",
        "UPDATE float_view_archive_metadata SET value='99' WHERE key='format_version'",
        "UPDATE float_view_archive_metadata SET value='4' WHERE key='format_version'",
        "UPDATE float_view_archive_metadata SET value=json_set(value,'$.boardProfileSnapshot.batteryCellProfileId','unknown') WHERE key='session'",
        "UPDATE float_view_archive_metadata SET value=json_set(value,'$.boardProfileSnapshot.batteryMinimumCellVoltageV',4.2) WHERE key='session'",
    ] {
        let export = store
            .prepare_export(&id, ExportFormat::Archive)
            .unwrap()
            .run(&cancel)
            .unwrap();
        let db = Connection::open(export.path()).unwrap();
        db.execute_batch(sql).unwrap();
        db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
        drop(db);
        let target = TestDirectory::new();
        let imported = ProductStore::open(target.path()).unwrap();
        assert!(sink(&imported, export.path()).validate(&cancel).is_err());
        assert!(imported.boards().unwrap().is_empty());
    }
    let export = store
        .prepare_export(&id, ExportFormat::Archive)
        .unwrap()
        .run(&cancel)
        .unwrap();
    let target = TestDirectory::new();
    let mut imported = ProductStore::open(target.path()).unwrap();
    let value = sink(&imported, export.path()).validate(&cancel).unwrap();
    let db = Connection::open(target.file("catalog.sqlite")).unwrap();
    db.execute_batch("CREATE TRIGGER fail BEFORE INSERT ON session_catalog BEGIN SELECT RAISE(ABORT,'injected'); END").unwrap();
    assert!(imported.attach_import(value).is_err());
    assert!(imported.boards().unwrap().is_empty());
    assert!(
        imported
            .sessions(None, 100, None, false)
            .unwrap()
            .items
            .is_empty()
    );
    assert!(fs::read_dir(target.path()).unwrap().all(|e| {
        !e.unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("session-")
    }));
}
#[test]
fn startup_reclaims_staging_and_unattached_owned_session_only() {
    let dir = TestDirectory::new();
    drop(ProductStore::open(dir.path()).unwrap());
    fs::write(dir.file("import-abandoned.floatview.tmp"), b"partial").unwrap();
    fs::write(dir.file("session-abandoned.sqlite"), b"unattached").unwrap();
    fs::write(dir.file("notes.txt"), b"keep").unwrap();
    let store = ProductStore::open(dir.path()).unwrap();
    assert!(!dir.file("session-abandoned.sqlite").exists());
    assert!(!dir.file("import-abandoned.floatview.tmp").exists());
    assert_eq!(fs::read(dir.file("notes.txt")).unwrap(), b"keep");
    drop(store);
}

#[test]
fn exact_import_byte_limit_is_streamed_and_foreign_handle_is_rejected() {
    let (_source_dir, source, id) = setup();
    let cancel = FileCancellation::default();
    let export = source
        .prepare_export(&id, ExportFormat::Archive)
        .unwrap()
        .run(&cancel)
        .unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(export.path())
        .unwrap()
        .set_len(limits::MAX_IMPORT_BYTES)
        .unwrap();
    let target_dir = TestDirectory::new();
    let target = ProductStore::open(target_dir.path()).unwrap();
    let validated = sink(&target, export.path()).validate(&cancel).unwrap();
    let foreign_dir = TestDirectory::new();
    let mut foreign = ProductStore::open(foreign_dir.path()).unwrap();
    assert!(matches!(
        foreign.attach_import(validated),
        Err(Error::InvalidInput)
    ));
    assert!(foreign.boards().unwrap().is_empty());
    assert!(
        target
            .sessions(None, 100, None, false)
            .unwrap()
            .items
            .is_empty()
    );
}
#[test]
fn source_delete_waits_for_export_while_another_session_keeps_recording() {
    let (_dir, mut store, id) = setup();
    let cancel = FileCancellation::default();
    let work = store.prepare_export(&id, ExportFormat::Archive).unwrap();
    let path = store.session_path(&id).unwrap();
    store.delete_session(&id).unwrap();
    assert!(path.exists());
    let board = store.boards().unwrap().remove(0);
    let active = store
        .create_session(&board.saved_device_id, 2, u64::MAX)
        .unwrap();
    let mut writer = SessionWriter::open(store.session_path(&active.session_id).unwrap()).unwrap();
    let thread = std::thread::spawn(move || work.run(&cancel).unwrap());
    writer.append_samples(&[sample(1, 0)]).unwrap();
    assert_eq!(writer.marker().unwrap().recorded_sample_count, 1);
    writer.close().unwrap();
    let export = thread.join().unwrap();
    assert!(export.path().exists());
    store.cleanup_deletes().unwrap();
    assert!(!path.exists());
    drop(export);
}

#[test]
fn pruned_archives_preserve_recorded_location_boundary_after_rows_are_removed() {
    let (_dir, mut store, id) = setup();
    let path = store.session_path(&id).unwrap();
    let mut writer = SessionWriter::open(&path).unwrap();
    let more: Vec<_> = (4..=53)
        .map(|i| {
            let mut v = sample(i, 30_000 + (i - 3) * 100);
            v.ride_state = RideState::Riding;
            v
        })
        .collect();
    writer.append_samples(&more).unwrap();
    writer
        .append_locations(&[LocationObservation {
            observed_at_epoch_ms: 1_050_000,
            elapsed_ms: 50_000,
            latitude: 7.,
            longitude: 8.,
            accuracy_m: None,
            altitude_m: None,
        }])
        .unwrap();
    writer.close().unwrap();
    store.reconcile_session(&id).unwrap();
    store.begin_maintenance(Some(&id), 10, false, 1).unwrap();
    let work = store.next_maintenance_work(2).unwrap().unwrap();
    store.complete_maintenance_work(work.run(3), 4).unwrap();
    let marker = SessionReader::open(&path).unwrap().marker().unwrap();
    assert!(marker.stored_location_count < marker.recorded_location_count);
    let cancel = FileCancellation::default();
    let export = store
        .prepare_export(&id, ExportFormat::Archive)
        .unwrap()
        .run(&cancel)
        .unwrap();
    let target = TestDirectory::new();
    let mut dest = ProductStore::open(target.path()).unwrap();
    let value = sink(&dest, export.path()).validate(&cancel).unwrap();
    let imported = dest.attach_import(value).unwrap();
    assert_eq!(imported.history_revision, 1);
    assert_eq!(imported.recorded_location_count, 3);
    assert_eq!(imported.stored_location_count, 2);
}

#[test]
fn a_live_worker_lease_prevents_a_second_owner_from_running_startup_cleanup() {
    let (dir, source, id) = setup();
    let export = source.prepare_export(&id, ExportFormat::Archive).unwrap();
    drop(source);
    assert!(matches!(ProductStore::open(dir.path()), Err(Error::Busy)));
    let file = export.run(&FileCancellation::default()).unwrap();
    assert!(matches!(ProductStore::open(dir.path()), Err(Error::Busy)));
    drop(file);
    assert!(ProductStore::open(dir.path()).is_ok());
}

#[test]
fn idle_marker_only_session_survives_recovery_and_archive_roundtrip() {
    let dir = TestDirectory::new();
    let mut store = ProductStore::open(dir.path()).unwrap();
    let board = store
        .ensure_board("marker-board", None, Some(&[8; 12]), 1)
        .unwrap();
    let session = store
        .create_session(&board.saved_device_id, 1, u64::MAX)
        .unwrap();
    let path = store.session_path(&session.session_id).unwrap();
    let mut writer = SessionWriter::open(&path).unwrap();
    writer
        .append_locations(&[LocationObservation {
            elapsed_ms: 0,
            observed_at_epoch_ms: 1,
            latitude: 2.,
            longitude: 3.,
            accuracy_m: Some(4.),
            altitude_m: None,
        }])
        .unwrap();
    let (marker, _) = writer
        .append_ride_marker("00000000-0000-4000-8000-000000000001", 500, 501, true)
        .unwrap();
    writer.close().unwrap();
    drop(store);
    let store = ProductStore::open(dir.path()).unwrap();
    assert_eq!(
        store.session(&session.session_id).unwrap().state,
        "interrupted"
    );
    let cancel = FileCancellation::default();
    let export = store
        .prepare_export(&session.session_id, ExportFormat::Archive)
        .unwrap()
        .run(&cancel)
        .unwrap();
    let target = TestDirectory::new();
    let mut target_store = ProductStore::open(target.path()).unwrap();
    let imported = target_store
        .attach_import(
            sink(&target_store, export.path())
                .validate(&cancel)
                .unwrap(),
        )
        .unwrap();
    let mut reader =
        SessionReader::open(target_store.session_path(&imported.session_id).unwrap()).unwrap();
    let boundary = reader.marker().unwrap();
    assert_eq!(
        reader.ride_markers((&boundary).into()).unwrap(),
        vec![marker]
    );
    drop(reader);
    let archive = Connection::open(export.path()).unwrap();
    archive
        .execute(
            "UPDATE session_event SET details_json='{}' WHERE kind='session_marker'",
            [],
        )
        .unwrap();
    drop(archive);
    assert!(
        sink(&target_store, export.path())
            .validate(&cancel)
            .is_err()
    );
    assert!(target_store.session(&imported.session_id).is_ok());
    target_store.delete_session(&imported.session_id).unwrap();
    assert!(target_store.session(&imported.session_id).is_err());
}

#[test]
fn archive_roundtrip_preserves_recording_boundaries_and_gap_safe_summary() {
    use float_view_session_sqlite::InterruptionReason::{ConnectionLoss, Pause, Unknown};
    for reason in [None, Some(Pause), Some(ConnectionLoss), Some(Unknown)] {
        let (_dir, mut store, _) = setup();
        let board = store.boards().unwrap().remove(0);
        let ride = store
            .create_session(&board.saved_device_id, 1, u64::MAX)
            .unwrap();
        let mut writer =
            SessionWriter::open(store.session_path(&ride.session_id).unwrap()).unwrap();
        let moving = |seq, time| {
            let mut s = sample(seq, time);
            s.ride_state = RideState::Riding;
            s.speed_kph = Some(36.);
            s
        };
        writer
            .append_samples(&[moving(1, 0), moving(2, 1000)])
            .unwrap();
        if let Some(reason) = reason {
            writer.interrupt_recording(reason, 1_001_001).unwrap();
        } else {
            writer.mark_recording_gap();
        }
        writer
            .append_samples(&[moving(3, 3_601_000), moving(4, 3_602_000)])
            .unwrap();
        writer.close().unwrap();
        if reason.is_none() {
            let db = Connection::open(store.session_path(&ride.session_id).unwrap()).unwrap();
            db.execute("UPDATE session_event SET details_json=json_remove(details_json,'$.reason') WHERE kind='recordingBoundary'", []).unwrap();
        }
        store
            .close_session(&ride.session_id, 4_602_000, "end_ride")
            .unwrap();
        let cancel = FileCancellation::default();
        let export = store
            .prepare_export(&ride.session_id, ExportFormat::Archive)
            .unwrap()
            .run(&cancel)
            .unwrap();
        let target = TestDirectory::new();
        let mut imported = ProductStore::open(target.path()).unwrap();
        let checked = sink(&imported, export.path()).validate(&cancel).unwrap();
        let session = imported.attach_import(checked).unwrap();
        assert_eq!(session.riding_elapsed_ms, 2000);
        assert_eq!(session.distance_m, Some(20.));
        let db = Connection::open(imported.session_path(&session.session_id).unwrap()).unwrap();
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM session_event WHERE kind='recordingBoundary'",
                [],
                |r| r.get::<_, u64>(0)
            )
            .unwrap(),
            1
        );
        drop(db);
        let assert_reason = |store: &ProductStore, id: &str| {
            let mut reader = SessionReader::open(store.session_path(id).unwrap()).unwrap();
            let marker = reader.marker().unwrap();
            let breaks = reader.recording_breaks((&marker).into()).unwrap();
            assert_eq!(breaks.len(), 1);
            assert_eq!(breaks[0].reason, reason.unwrap_or(Unknown));
        };
        assert_reason(&imported, &session.session_id);
        let reexport = imported
            .prepare_export(&session.session_id, ExportFormat::Archive)
            .unwrap()
            .run(&cancel)
            .unwrap();
        let again_dir = TestDirectory::new();
        let mut again = ProductStore::open(again_dir.path()).unwrap();
        let checked = sink(&again, reexport.path()).validate(&cancel).unwrap();
        let session = again.attach_import(checked).unwrap();
        assert_reason(&again, &session.session_id);
    }
}

#[test]
fn connection_contexts_survive_archive_and_corrupt_context_does_not_publish() {
    use float_view_session_sqlite::{ConnectionContext, ContextFirmware, ContextRoute};
    let (_dir, store, id) = setup();
    let mut writer = SessionWriter::open(store.session_path(&id).unwrap()).unwrap();
    let firmware = ContextFirmware {
        major: 6,
        minor: 6,
        test_version: 1,
        hardware_name: Some("Thor300".into()),
        firmware_name: None,
    };
    let context = ConnectionContext {
        version: 1,
        refloat_version: "1.3.0".into(),
        controller: firmware.clone(),
        transport: ContextFirmware {
            firmware_name: Some("VESC Express".into()),
            ..firmware
        },
        connection: ContextRoute::Can { can_id: 42 },
    };
    writer
        .append_connection_context(
            "00000000-0000-4000-8000-000000000001",
            30_000,
            1_030_000,
            context,
        )
        .unwrap();
    writer.close().unwrap();
    let mut pruner =
        float_view_session_sqlite::SessionPruner::open(store.session_path(&id).unwrap()).unwrap();
    let plan = pruner.preview(5).unwrap();
    pruner.commit(plan, 1_040_000).unwrap();
    pruner.close().unwrap();

    // Reconcile after a writer commits, as the service normally does.
    let mut store = store;
    store.reconcile_session(&id).unwrap();
    let mut source = SessionReader::open(store.session_path(&id).unwrap()).unwrap();
    let boundary = source.marker().unwrap();
    let expected = source.connection_contexts((&boundary).into()).unwrap();
    drop(source);
    let cancel = FileCancellation::default();
    let file = store
        .prepare_export(&id, ExportFormat::Archive)
        .unwrap()
        .run(&cancel)
        .unwrap();
    let target = TestDirectory::new();
    let mut target_store = ProductStore::open(target.path()).unwrap();
    let imported = target_store
        .attach_import(sink(&target_store, file.path()).validate(&cancel).unwrap())
        .unwrap();
    let mut reader =
        SessionReader::open(target_store.session_path(&imported.session_id).unwrap()).unwrap();
    let boundary = reader.marker().unwrap();
    assert_eq!(
        reader.connection_contexts((&boundary).into()).unwrap(),
        expected
    );
    drop(reader);
    let db = Connection::open(file.path()).unwrap();
    db.execute("UPDATE session_event SET details_json=json_set(details_json,'$.context.connection.canId',254) WHERE kind='connectionContext'",[]).unwrap();
    drop(db);
    assert!(sink(&target_store, file.path()).validate(&cancel).is_err());
    assert!(target_store.session(&imported.session_id).is_ok());
}

#[test]
fn connection_context_alone_does_not_keep_an_unridden_session() {
    use float_view_session_sqlite::{ConnectionContext, ContextFirmware, ContextRoute};
    let dir = TestDirectory::new();
    let mut store = ProductStore::open(dir.path()).unwrap();
    let board = store
        .ensure_board("context-only", None, Some(&[7; 12]), 1)
        .unwrap();
    let session = store
        .create_session(&board.saved_device_id, 1, u64::MAX)
        .unwrap();
    let path = store.session_path(&session.session_id).unwrap();
    let mut writer = SessionWriter::open(&path).unwrap();
    let firmware = ContextFirmware {
        major: 6,
        minor: 6,
        test_version: 0,
        hardware_name: None,
        firmware_name: None,
    };
    writer
        .append_connection_context(
            "00000000-0000-4000-8000-000000000001",
            0,
            1,
            ConnectionContext {
                version: 1,
                refloat_version: "1.0".into(),
                controller: firmware.clone(),
                transport: firmware,
                connection: ContextRoute::Direct,
            },
        )
        .unwrap();
    writer.close().unwrap();
    store
        .close_session(&session.session_id, 100, "ended")
        .unwrap();
    assert!(matches!(
        store.session(&session.session_id),
        Err(Error::NotFound)
    ));
    assert!(!path.exists());
}

#[test]
fn board_bundles_include_all_pages_skip_active_and_keep_collision_free_individual_exports() {
    let (_dir, mut store, first) = setup();
    let board = store.boards().unwrap().remove(0);
    // Same timestamp deliberately gives every artifact the same original basename.
    for _ in 0..51 {
        let session = store
            .create_session(&board.saved_device_id, 1, u64::MAX)
            .unwrap();
        let mut writer =
            SessionWriter::open(store.session_path(&session.session_id).unwrap()).unwrap();
        let mut point = sample(1, 1000);
        point.ride_state = RideState::Riding;
        writer.append_samples(&[point]).unwrap();
        writer.close().unwrap();
        store
            .close_session(&session.session_id, 100_000, "disconnect")
            .unwrap();
    }
    let other = store
        .ensure_board("other", Some("Other"), Some(&[2; 12]), 1)
        .unwrap();
    let unrelated = store
        .create_session(&other.saved_device_id, 1, u64::MAX)
        .unwrap();
    let mut writer =
        SessionWriter::open(store.session_path(&unrelated.session_id).unwrap()).unwrap();
    let mut point = sample(1, 1000);
    point.ride_state = RideState::Riding;
    writer.append_samples(&[point]).unwrap();
    writer.close().unwrap();
    store
        .close_session(&unrelated.session_id, 100_000, "disconnect")
        .unwrap();
    let active = store
        .create_session(&board.saved_device_id, 1, u64::MAX)
        .unwrap();
    for format in [ExportFormat::Archive, ExportFormat::Csv] {
        let ordinary = (0..6)
            .map(|_| store.lease_session(&first).unwrap())
            .collect::<Vec<_>>();
        assert!(matches!(store.lease_session(&first), Err(Error::Capacity)));
        let output = store
            .prepare_board_export(&board.saved_device_id, format)
            .unwrap()
            .run(&FileCancellation::default())
            .unwrap();
        let mut zip = zip::ZipArchive::new(fs::File::open(output.path()).unwrap()).unwrap();
        assert_eq!(zip.len(), 52);
        let mut names = std::collections::BTreeSet::new();
        for index in 0..zip.len() {
            let mut entry = zip.by_index(index).unwrap();
            assert!(names.insert(entry.name().to_owned()));
            assert!(!entry.name().contains('/'));
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).unwrap();
            if format == ExportFormat::Archive {
                assert!(entry.name().ends_with(".floatview"));
                assert!(bytes.starts_with(b"SQLite format 3"));
                // Each inner archive still goes through the established importer.
                let mut sink = store.begin_import(bytes.len() as u64).unwrap();
                for (index, chunk) in bytes.chunks(65_536).enumerate() {
                    sink.write((index * 65_536) as u64, chunk).unwrap();
                }
                drop(sink.validate(&FileCancellation::default()).unwrap());
            } else {
                assert!(entry.name().ends_with(".csv.zip"));
                let inner = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
                assert_eq!(inner.len(), 1);
            }
        }
        drop(zip);
        drop(output);
        drop(ordinary);
        assert!(store.session(&first).is_ok());
        assert_eq!(store.session(&active.session_id).unwrap().state, "active");
    }
}

#[test]
fn board_export_empty_unknown_cancelled_and_failed_work_release_staging_and_leases() {
    let (_dir, mut store, id) = setup();
    let board = store.boards().unwrap().remove(0);
    let empty = store
        .ensure_board("empty", Some("Empty"), Some(&[3; 12]), 1)
        .unwrap();
    assert!(matches!(
        store.prepare_board_export(&empty.saved_device_id, ExportFormat::Archive),
        Err(Error::NotFound)
    ));
    assert!(matches!(
        store.prepare_board_export("missing", ExportFormat::Archive),
        Err(Error::NotFound)
    ));
    let work = store
        .prepare_board_export(&board.saved_device_id, ExportFormat::Archive)
        .unwrap();
    let cancel = FileCancellation::default();
    cancel.cancel();
    assert!(matches!(work.run(&cancel), Err(Error::Cancelled)));
    let work = store
        .prepare_board_export(&board.saved_device_id, ExportFormat::Archive)
        .unwrap();
    // Operational failure never publishes a bundle or deletes the source.
    let source = store.session_path(&id).unwrap();
    let backup = fs::read(&source).unwrap();
    fs::write(&source, b"corrupt").unwrap();
    assert!(work.run(&FileCancellation::default()).is_err());
    fs::write(&source, backup).unwrap();
    let output = store
        .prepare_board_export(&board.saved_device_id, ExportFormat::Archive)
        .unwrap()
        .run(&FileCancellation::default())
        .unwrap();
    drop(output);
    assert_eq!(
        fs::read_dir(store.root().join("Exports")).unwrap().count(),
        0
    );
}

#[test]
fn board_export_admission_rejects_oversized_sources_and_too_many_sessions_without_staging() {
    let (_dir, store, id) = setup();
    let board = store.boards().unwrap().remove(0);
    let source = store.session_path(&id).unwrap();
    let original = fs::metadata(&source).unwrap().len();
    let file = fs::OpenOptions::new().write(true).open(&source).unwrap();
    file.set_len(limits::MAX_EXPORT_BYTES + 1).unwrap();
    assert!(matches!(
        store.prepare_board_export(&board.saved_device_id, ExportFormat::Archive),
        Err(Error::Capacity)
    ));
    file.set_len(original).unwrap();
    drop(file);
    // Construct catalog-only entries to establish count rejection before file work.
    let db = Connection::open(store.root().join("catalog.sqlite")).unwrap();
    let columns = db
        .prepare("PRAGMA table_info(session_catalog)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    let values = columns
        .iter()
        .map(|column| match column.as_str() {
            "session_id" | "job_id" | "file_name" => format!("printf('bounded-{column}-%d',n)"),
            _ => column.clone(),
        })
        .collect::<Vec<_>>()
        .join(",");
    db.execute(&format!("WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<?1) INSERT INTO session_catalog SELECT {values} FROM session_catalog CROSS JOIN numbers WHERE session_id=?2"),
        rusqlite::params![limits::MAX_BOARD_EXPORT_SESSIONS, id]).unwrap();
    assert!(matches!(
        store.prepare_board_export(&board.saved_device_id, ExportFormat::Archive),
        Err(Error::Capacity)
    ));
    assert_eq!(
        fs::read_dir(store.root().join("Exports"))
            .map(|entries| entries.count())
            .unwrap_or(0),
        0
    );
}

#[test]
fn board_zip_can_exceed_the_individual_128_mib_limit() {
    let (_dir, mut store, first) = setup();
    let board = store.boards().unwrap().remove(0);
    let second = store
        .create_session(&board.saved_device_id, 2, u64::MAX)
        .unwrap();
    let mut writer = SessionWriter::open(store.session_path(&second.session_id).unwrap()).unwrap();
    let mut point = sample(1, 1000);
    point.ride_state = RideState::Riding;
    writer.append_samples(&[point]).unwrap();
    writer.close().unwrap();
    store
        .close_session(&second.session_id, 100_000, "disconnect")
        .unwrap();
    // SQLite backups retain free pages; grow valid source databases without
    // allocating a large in-memory telemetry fixture or changing their schemas.
    for id in [&first, &second.session_id] {
        let db = Connection::open(store.session_path(id).unwrap()).unwrap();
        db.execute_batch("CREATE TABLE export_padding(data BLOB); INSERT INTO export_padding VALUES(zeroblob(71303168)); DROP TABLE export_padding; PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
    }
    let export = store
        .prepare_board_export(&board.saved_device_id, ExportFormat::Archive)
        .unwrap();
    let completed = std::cell::RefCell::new(Vec::new());
    let file = export
        .run_with_progress(&FileCancellation::default(), |count| {
            completed.borrow_mut().push(count)
        })
        .unwrap();
    assert_eq!(*completed.borrow(), vec![1, 2]);
    let zip = zip::ZipArchive::new(fs::File::open(file.path()).unwrap()).unwrap();
    assert_eq!(zip.len(), 2);
    assert!(file.len().unwrap() > limits::MAX_EXPORT_BYTES);
    assert!(file.len().unwrap() < limits::MAX_BOARD_EXPORT_BYTES);
    drop(zip);
    drop(file);
    let cancel = FileCancellation::default();
    let work = store
        .prepare_board_export(&board.saved_device_id, ExportFormat::Archive)
        .unwrap();
    assert!(matches!(
        work.run_with_progress(&cancel, |completed| {
            if completed == 1 {
                cancel.cancel();
            }
        }),
        Err(Error::Cancelled)
    ));
    assert!(store.session(&first).is_ok());
    assert!(store.session(&second.session_id).is_ok());
}

fn app_sink(store: &ProductStore, path: &std::path::Path) -> ImportSink {
    let bytes = fs::read(path).unwrap();
    let mut sink = store.begin_app_import_stream().unwrap();
    for (i, chunk) in bytes.chunks(65536).enumerate() {
        sink.write((i * 65536) as u64, chunk).unwrap();
    }
    sink
}
fn import_app(
    store: &mut ProductStore,
    path: &std::path::Path,
    settings: bool,
) -> float_view_product_store::AppImportSummary {
    let import = app_sink(store, path)
        .validate_app(&FileCancellation::default(), settings)
        .unwrap();
    store.attach_app_import(import).unwrap()
}
fn app_entries(path: &std::path::Path) -> Vec<(String, Vec<u8>)> {
    let mut zip = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    (0..zip.len())
        .map(|i| {
            let mut entry = zip.by_index(i).unwrap();
            let name = entry.name().to_owned();
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).unwrap();
            (name, bytes)
        })
        .collect()
}
fn write_app(path: &std::path::Path, entries: &[(String, Vec<u8>)]) {
    use std::io::Write;
    let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
    for (name, bytes) in entries {
        zip.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap();
}
#[test]
fn app_transfer_merges_empty_boards_current_profiles_settings_and_stable_sessions() {
    let (source_dir, mut source, id) = setup();
    let first = source.boards().unwrap().remove(0);
    let empty = source
        .ensure_board("OTHER-PRIVATE-ID", Some("Empty"), Some(&[2; 12]), 2)
        .unwrap();
    source
        .update_profile(
            &empty.saved_device_id,
            0,
            r#"{"batteryCapacityAh":12.3}"#,
            2,
        )
        .unwrap();
    // The current profile has changed since the session was recorded.
    let profile = source.profile(&first.saved_device_id).unwrap();
    source
        .update_profile(
            &first.saved_device_id,
            profile.revision,
            r#"{"batteryCapacityAh":9.9}"#,
            3,
        )
        .unwrap();
    source.update_settings(source.settings().unwrap().revision,
        &serde_json::json!({"unitPreference":"imperial","autoConnectSavedDeviceId":first.saved_device_id,"safetyDisclaimerAccepted":true}).to_string()).unwrap();
    let db = Connection::open(source_dir.file("catalog.sqlite")).unwrap();
    db.execute("INSERT INTO refloat_configuration VALUES ('portable-tune',1,'My tune',NULL,'refloat','1.3.1-beta2',?,42,?,1,2)", rusqlite::params!["a".repeat(64),r#"{"kp":{"type":"double","value":3.0}}"#]).unwrap();
    drop(db);
    let exported = source
        .prepare_app_export()
        .unwrap()
        .run(&FileCancellation::default())
        .unwrap();
    let entries = app_entries(exported.path());
    let manifest: serde_json::Value = serde_json::from_slice(&entries[0].1).unwrap();
    let text = serde_json::to_string(&manifest).unwrap();
    assert!(!text.contains("PRIVATE-ID"));
    assert!(!text.contains("PRIVATE-LOCAL-ID"));
    assert!(!text.contains(&first.saved_device_id));
    assert_eq!(manifest["settings"]["safetyDisclaimerAccepted"], false);
    assert_eq!(manifest["tunes"][0]["identity"]["packageVersion"], "1.3.1");
    // Existing supported archives can still carry the old beta identity.
    let mut legacy_entries = entries.clone();
    let mut legacy_manifest = manifest.clone();
    legacy_manifest["tunes"][0]["identity"]["packageVersion"] = "1.3.1-beta3".into();
    legacy_entries[0].1 = serde_json::to_vec(&legacy_manifest).unwrap();
    let legacy_path = source_dir.file("beta-tunes.zip");
    write_app(&legacy_path, &legacy_entries);
    let legacy_target = TestDirectory::new();
    let mut legacy_store = ProductStore::open(legacy_target.path()).unwrap();
    assert_eq!(
        import_app(&mut legacy_store, &legacy_path, false).tunes_added,
        1
    );
    assert_eq!(
        legacy_store
            .tune("portable-tune")
            .unwrap()
            .identity
            .package_version,
        "1.3.1"
    );
    let target = TestDirectory::new();
    let mut destination = ProductStore::open(target.path()).unwrap();
    destination
        .update_settings(0, r#"{"safetyDisclaimerAccepted":true}"#)
        .unwrap();
    let first_import = import_app(&mut destination, exported.path(), true);
    assert_eq!(
        (
            first_import.boards_added,
            first_import.sessions_added,
            first_import.tunes_added
        ),
        (2, 1, 1)
    );
    assert_eq!(
        destination
            .tune("portable-tune")
            .unwrap()
            .identity
            .package_version,
        "1.3.1"
    );
    assert!(first_import.settings_imported);
    let boards = destination.boards().unwrap();
    assert!(boards.iter().all(|b| b.local_identifier.is_none()));
    let target_first = boards
        .iter()
        .find(|b| b.device_history_id == first.device_history_id)
        .unwrap();
    assert_ne!(target_first.saved_device_id, first.saved_device_id);
    assert_eq!(
        destination
            .profile(&target_first.saved_device_id)
            .unwrap()
            .values["batteryCapacityAh"],
        9.9
    );
    assert_eq!(destination.session(&id).unwrap().session_id, id);
    assert_eq!(location_altitudes(&destination, &id), [Some(-8.), None]);
    let settings = destination.settings().unwrap();
    assert_eq!(settings.unit_preference, "imperial");
    assert!(settings.safety_disclaimer_accepted);
    assert_eq!(
        settings.auto_connect_saved_device_id.as_deref(),
        Some(target_first.saved_device_id.as_str())
    );
    destination
        .update_profile(
            &target_first.saved_device_id,
            destination
                .profile(&target_first.saved_device_id)
                .unwrap()
                .revision,
            r#"{"batteryCapacityAh":7.7}"#,
            4,
        )
        .unwrap();
    let db = Connection::open(target.file("catalog.sqlite")).unwrap();
    db.execute("UPDATE refloat_configuration SET name='Local tune'", [])
        .unwrap();
    drop(db);
    destination
        .update_settings(settings.revision, r#"{"unitPreference":"metric"}"#)
        .unwrap();
    let repeated = import_app(&mut destination, exported.path(), false);
    assert_eq!(
        (
            repeated.boards_skipped,
            repeated.sessions_skipped,
            repeated.tunes_skipped
        ),
        (2, 1, 1)
    );
    assert_eq!(
        (
            repeated.boards_added,
            repeated.sessions_added,
            repeated.tunes_added
        ),
        (0, 0, 0)
    );
    assert_eq!(
        destination
            .profile(&target_first.saved_device_id)
            .unwrap()
            .values["batteryCapacityAh"],
        7.7
    );
    assert_eq!(
        destination.tune("portable-tune").unwrap().name,
        "Local tune"
    );
    assert_eq!(destination.settings().unwrap().unit_preference, "metric");
    let back = destination
        .prepare_app_export()
        .unwrap()
        .run(&FileCancellation::default())
        .unwrap();
    let back_path = target.file("back.zip");
    fs::copy(back.path(), &back_path).unwrap();
    drop(back);
    // A transfer in one store is admitted after its previous issued export is released.
    let export_copy = source_dir.file("transfer.zip");
    fs::copy(exported.path(), &export_copy).unwrap();
    drop(exported);
    assert_eq!(
        import_app(&mut source, &back_path, false).sessions_skipped,
        1
    );
    let user_file = target.file("user-export.zip");
    fs::copy(&export_copy, &user_file).unwrap();
    destination.clear_app_data().unwrap();
    assert!(destination.boards().unwrap().is_empty());
    assert!(matches!(destination.session(&id), Err(Error::NotFound)));
    assert!(matches!(
        destination.tune("portable-tune"),
        Err(Error::NotFound)
    ));
    assert!(destination.settings().unwrap().safety_disclaimer_accepted);
    assert!(user_file.exists());
    drop(destination);
    let mut destination = ProductStore::open(target.path()).unwrap();
    assert_eq!(
        import_app(&mut destination, &user_file, true).sessions_added,
        1
    );
}
#[test]
fn app_import_rejects_bad_packages_and_rolls_back_all_catalog_changes() {
    let (_source, source, _) = setup();
    let export = source
        .prepare_app_export()
        .unwrap()
        .run(&FileCancellation::default())
        .unwrap();
    let good = app_entries(export.path());
    let target = TestDirectory::new();
    let mut destination = ProductStore::open(target.path()).unwrap();
    for case in 0..5 {
        let mut entries = good.clone();
        match case {
            0 => {
                let mut manifest: serde_json::Value =
                    serde_json::from_slice(&entries[0].1).unwrap();
                manifest["version"] = 2.into();
                entries[0].1 = serde_json::to_vec(&manifest).unwrap();
            }
            1 => entries[1].1 = b"invalid session".to_vec(),
            2 => {
                let mut duplicate = entries[1].clone();
                duplicate.0 = "sessions/00002.floatview".into();
                entries.push(duplicate);
            }
            3 => entries[1].0 = "../session.floatview".into(),
            _ => {
                let mut manifest: serde_json::Value =
                    serde_json::from_slice(&entries[0].1).unwrap();
                manifest["sessions"][0]["sessionId"] =
                    "00000000-0000-0000-0000-000000000001".into();
                entries[0].1 = serde_json::to_vec(&manifest).unwrap();
            }
        }
        let path = target.file("bad.zip");
        write_app(&path, &entries);
        if case == 2 {
            let bytes = fs::read(&path).unwrap();
            let text = b"sessions/00002.floatview";
            let mut bytes = bytes;
            for i in 0..bytes.len() - text.len() {
                if &bytes[i..i + text.len()] == text {
                    bytes[i + 13] = b'1';
                }
            }
            fs::write(&path, bytes).unwrap();
        }
        assert!(
            app_sink(&destination, &path)
                .validate_app(&FileCancellation::default(), true)
                .is_err()
        );
        assert!(destination.boards().unwrap().is_empty());
    }
    let before = destination.settings().unwrap();
    let db = Connection::open(target.file("catalog.sqlite")).unwrap();
    db.execute_batch("CREATE TRIGGER fail BEFORE INSERT ON session_catalog BEGIN SELECT RAISE(ABORT,'injected'); END").unwrap();
    let validated = app_sink(&destination, export.path())
        .validate_app(&FileCancellation::default(), true)
        .unwrap();
    assert!(destination.attach_app_import(validated).is_err());
    assert!(destination.boards().unwrap().is_empty());
    assert_eq!(destination.settings().unwrap(), before);
    db.execute_batch("DROP TRIGGER fail").unwrap();
    drop(db);
    drop(destination);
    let mut destination = ProductStore::open(target.path()).unwrap();
    assert_eq!(
        import_app(&mut destination, export.path(), false).sessions_added,
        1
    );
}
#[test]
fn empty_app_transfer_and_clear_admission() {
    let target = TestDirectory::new();
    let mut store = ProductStore::open(target.path()).unwrap();
    let export = store
        .prepare_app_export()
        .unwrap()
        .run(&FileCancellation::default())
        .unwrap();
    assert_eq!(app_entries(export.path()).len(), 1);
    let path = target.file("empty.zip");
    fs::copy(export.path(), &path).unwrap();
    drop(export);
    assert_eq!(import_app(&mut store, &path, false).sessions_added, 0);
    let board = store
        .ensure_board("local", Some("B"), Some(&[4; 12]), 1)
        .unwrap();
    let active = store
        .create_session(&board.saved_device_id, 1, u64::MAX)
        .unwrap();
    assert!(matches!(
        store.prepare_app_export(),
        Err(Error::ActiveSession)
    ));
    assert!(matches!(store.clear_app_data(), Err(Error::ActiveSession)));
    store
        .update_settings(
            store.settings().unwrap().revision,
            r#"{"minimumSessionDistance":0}"#,
        )
        .unwrap();
    let mut writer = SessionWriter::open(store.session_path(&active.session_id).unwrap()).unwrap();
    let mut point = sample(1, 1000);
    point.ride_state = RideState::Riding;
    point.speed_kph = Some(36.);
    writer.append_samples(&[point]).unwrap();
    writer.close().unwrap();
    store
        .close_session(&active.session_id, 2, "disconnect")
        .unwrap();
    let lease = store
        .prepare_export(&active.session_id, ExportFormat::Archive)
        .unwrap();
    assert!(matches!(store.clear_app_data(), Err(Error::Busy)));
    drop(lease);
    store.clear_app_data().unwrap();
}

#[test]
fn duplicate_archives_keep_local_pruning_and_reject_board_identity_collisions() {
    let (_dir, source, id) = setup();
    let cancel = FileCancellation::default();
    let export = source
        .prepare_export(&id, ExportFormat::Archive)
        .unwrap()
        .run(&cancel)
        .unwrap();
    let target = TestDirectory::new();
    let mut destination = ProductStore::open(target.path()).unwrap();
    destination
        .attach_import(sink(&destination, export.path()).validate(&cancel).unwrap())
        .unwrap();
    destination
        .begin_maintenance(Some(&id), 60, false, 1)
        .unwrap();
    let work = destination.next_maintenance_work(2).unwrap().unwrap();
    destination
        .complete_maintenance_work(work.run(3), 4)
        .unwrap();
    let pruned = destination.session(&id).unwrap();
    assert!(pruned.history_revision > 0);
    let reimported = destination
        .attach_import(sink(&destination, export.path()).validate(&cancel).unwrap())
        .unwrap();
    assert_eq!(reimported.history_revision, pruned.history_revision);
    assert_eq!(reimported.stored_sample_count, pruned.stored_sample_count);
    let collision = target.file("collision.floatview");
    fs::copy(export.path(), &collision).unwrap();
    let db = Connection::open(&collision).unwrap();
    let text: String = db
        .query_row(
            "SELECT value FROM float_view_archive_metadata WHERE key='session'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let mut manifest: serde_json::Value = serde_json::from_str(&text).unwrap();
    manifest["deviceHistoryId"] = "other-board".into();
    manifest["deviceSnapshot"]["deviceHistoryId"] = "other-board".into();
    db.execute(
        "UPDATE float_view_archive_metadata SET value=? WHERE key='session'",
        [manifest.to_string()],
    )
    .unwrap();
    drop(db);
    let import = sink(&destination, &collision).validate(&cancel).unwrap();
    assert!(matches!(
        destination.attach_import(import),
        Err(Error::InvalidInput)
    ));
    assert_eq!(destination.boards().unwrap().len(), 1);
    assert_eq!(
        destination.session(&id).unwrap().history_revision,
        pruned.history_revision
    );
}
#[test]
fn clear_failure_rolls_back_and_manifest_bounds_fail_before_catalog_changes() {
    let (dir, mut store, id) = setup();
    let db = Connection::open(dir.file("catalog.sqlite")).unwrap();
    db.execute_batch("CREATE TRIGGER fail_settings BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT,'injected'); END").unwrap();
    let settings = store.settings().unwrap();
    assert!(store.clear_app_data().is_err());
    assert_eq!(store.boards().unwrap().len(), 1);
    assert!(store.session_path(&id).unwrap().exists());
    assert_eq!(store.settings().unwrap(), settings);
    db.execute_batch("DROP TRIGGER fail_settings").unwrap();
    drop(db);
    let export = store
        .prepare_app_export()
        .unwrap()
        .run(&FileCancellation::default())
        .unwrap();
    let original = app_entries(export.path());
    let target = TestDirectory::new();
    let destination = ProductStore::open(target.path()).unwrap();
    for case in 0..3 {
        let mut entries = original.clone();
        let mut manifest: serde_json::Value = serde_json::from_slice(&entries[0].1).unwrap();
        match case {
            0 => {
                let board = manifest["boards"][0].clone();
                manifest["boards"] = serde_json::json!(vec![board; 51]);
            }
            1 => manifest["settings"]["ridingPersistIntervalMs"] = 0.into(),
            _ => manifest["sessions"][0]["sessionId"] = "../owned-file".into(),
        }
        entries[0].1 = serde_json::to_vec(&manifest).unwrap();
        let path = target.file("bad.zip");
        write_app(&path, &entries);
        assert!(
            app_sink(&destination, &path)
                .validate_app(&FileCancellation::default(), true)
                .is_err()
        );
        assert!(destination.boards().unwrap().is_empty());
    }
    let path = target.file("truncated.zip");
    fs::write(&path, b"PK\x05\x06").unwrap();
    assert!(
        app_sink(&destination, &path)
            .validate_app(&FileCancellation::default(), false)
            .is_err()
    );
}
