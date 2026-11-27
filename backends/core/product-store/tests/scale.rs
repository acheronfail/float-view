//! Opt-in on-disk stress test; see backends/sql/README.md.
#[allow(dead_code)]
#[path = "../../session-sqlite/tests/support/mod.rs"]
mod support;
use float_view_product_store::ProductStore;
use rusqlite::{Connection, params};
use std::time::Instant;
use support::TestDirectory;

#[test]
#[ignore = "on-disk SQLite scale benchmark"]
fn catalog_scale() {
    let dir = TestDirectory::new();
    let mut store = ProductStore::open(dir.path()).unwrap();
    let mut db = Connection::open(dir.file("catalog.sqlite")).unwrap();
    let sizes = std::env::var("FLOAT_VIEW_CATALOG_SIZES").unwrap_or("1000,10000,100000".into());
    let mut previous = 0;
    for size in sizes.split(',').map(|n| n.parse::<usize>().unwrap()) {
        let begin = Instant::now();
        let tx = db.transaction().unwrap();
        {
            let mut insert = tx.prepare("INSERT INTO session_catalog(session_id,job_id,device_history_id,device_snapshot_json,profile_snapshot_json,profile_revision,file_name,started_at_ms,state,integrity,requested_idle_ms,effective_idle_ms,requested_riding_ms,effective_riding_ms,total_elapsed_ms,distance_m,pending_delete) VALUES (?1,?1,?2,?3,?4,0,?5,?6,?7,'complete',1000,1000,100,100,3600000,10000,?8)").unwrap();
            for i in previous..size {
                let id = format!("{i:032x}");
                // Sparse board, tied timestamps, realistic JSON, and hidden rows.
                insert
                    .execute(params![
                        id,
                        if i % 100 == 0 { "rare" } else { "common" },
                        r#"{"displayName":"Test board","deviceHistoryId":"synthetic"}"#,
                        r#"{"motor":"test","wheelDiameterMm":280}"#,
                        format!("session-{id}.sqlite"),
                        (i / 3) as i64,
                        if i % 997 == 0 { "active" } else { "completed" },
                        i % 97 == 0
                    ])
                    .unwrap();
            }
        }
        tx.commit().unwrap();
        println!(
            "catalog rows={size} seed_ms={:.2}",
            begin.elapsed().as_secs_f64() * 1000.
        );
        for history in [None, Some("rare")] {
            for completed in [false, true] {
                let begin = Instant::now();
                let mut cursor = None;
                let mut count = 0;
                let mut last = None;
                loop {
                    let page = store
                        .sessions(history, 100, cursor.as_deref(), completed)
                        .unwrap();
                    for item in &page.items {
                        let key = (item.started_at_ms, item.session_id.clone());
                        assert!(last.as_ref().is_none_or(|old| old > &key));
                        last = Some(key);
                        if let Some(h) = history {
                            assert_eq!(item.device_history_id, h);
                        }
                        if completed {
                            assert_ne!(item.state, "active");
                        }
                    }
                    count += page.items.len();
                    cursor = page.next_cursor;
                    if cursor.is_none() {
                        break;
                    }
                }
                let expected: usize = db.query_row("SELECT COUNT(*) FROM session_catalog WHERE pending_delete=0 AND (?1 IS NULL OR device_history_id=?1) AND (?2=0 OR state<>'active')", params![history, completed], |r|r.get(0)).unwrap();
                assert_eq!(count, expected);
                println!(
                    "catalog rows={size} history={history:?} completed={completed} traverse_ms={:.2} returned={count}",
                    begin.elapsed().as_secs_f64() * 1000.
                );
            }
        }
        db.execute(
            "UPDATE session_catalog SET sample_count=1000,riding_elapsed_ms=3600000",
            [],
        )
        .unwrap();
        for history in ["rare", "common", "absent"] {
            let start = Instant::now();
            let result = store.board_history(history).unwrap();
            let elapsed_ms = start.elapsed().as_secs_f64() * 1000.;
            let expected:u64=db.query_row("SELECT COUNT(*) FROM session_catalog WHERE device_history_id=? AND pending_delete=0",[history],|r|r.get(0)).unwrap();
            assert_eq!(result.session_count, expected);
            assert_eq!(result.total_riding_elapsed_ms, expected * 3600000);
            assert_eq!(
                result.total_distance_m,
                if expected == 0 {
                    None
                } else {
                    Some(expected as f64 * 10000.)
                }
            );
            println!(
                "catalog rows={size} board_history={history} ms={:.2}",
                elapsed_ms
            );
        }
        for scope in [Some("00000000000000000000000000000001"), None] {
            db.execute("DELETE FROM session_maintenance_job", [])
                .unwrap();
            store.begin_maintenance(scope, 10, true, 1).unwrap();
            let start = Instant::now();
            let mut result = 0;
            for _ in 0..20 {
                result = store.maintenance_recorded_samples().unwrap();
            }
            let mean_ms = start.elapsed().as_secs_f64() * 1000. / 20.;
            let expected:u64=db.query_row("SELECT COALESCE(SUM(sample_count),0) FROM session_catalog WHERE pending_delete=0 AND state<>'active' AND (?1 IS NULL OR session_id=?1)",[scope],|r|r.get(0)).unwrap();
            assert_eq!(result, expected);
            println!(
                "catalog rows={size} maintenance_scope={scope:?} mean_ms={:.2}",
                mean_ms
            );
            let job = store.maintenance().unwrap().unwrap();
            let start = Instant::now();
            for _ in 0..20 {
                let old:u64=db.query_row("SELECT COALESCE(SUM(sample_count),0) FROM session_catalog WHERE pending_delete=0 AND state<>'active' AND ((?1='one' AND session_id=?2) OR (?1='all' AND session_id<=?3))",params![job.scope,job.session_id,job.upper_session_id],|r|r.get(0)).unwrap();
                assert_eq!(old, expected);
            }
            println!(
                "catalog rows={size} previous_maintenance_scope={scope:?} mean_ms={:.2}",
                start.elapsed().as_secs_f64() * 1000. / 20.
            );
        }
        previous = size;
    }
}

#[test]
#[ignore = "on-disk SQLite scale benchmark"]
fn tune_scale() {
    use float_view_product_store::TuneIdentity;
    let dir = TestDirectory::new();
    let store = ProductStore::open(dir.path()).unwrap();
    let mut db = Connection::open(dir.file("catalog.sqlite")).unwrap();
    let identity = TuneIdentity {
        package_name: "refloat".into(),
        package_version: "1.0".into(),
        schema_fingerprint: "a".repeat(64),
        wire_signature: 1,
    };
    let tx = db.transaction().unwrap();
    {
        let mut insert = tx.prepare("INSERT INTO refloat_configuration(configuration_id,name,package_name,package_version,schema_fingerprint,wire_signature,values_json,created_at_ms,updated_at_ms) VALUES (?1,'Test tune','refloat',?2,?3,1,?4,0,?5)").unwrap();
        for i in 0..10000 {
            insert
                .execute(params![
                    format!("{i:032x}"),
                    if i % 10 == 0 { "other" } else { "1.0" },
                    identity.schema_fingerprint,
                    r#"{"gain":{"type":"double","value":1.0}}"#,
                    i / 3
                ])
                .unwrap();
        }
    }
    tx.commit().unwrap();
    let start = Instant::now();
    let mut cursor = None;
    let mut last = None;
    let mut count = 0;
    loop {
        let page = store.tunes(&identity, 50, cursor.as_deref()).unwrap();
        for tune in page.items {
            assert_eq!(tune.identity, identity);
            let key = (tune.updated_at_ms, tune.configuration_id);
            assert!(last.as_ref().is_none_or(|old| old > &key));
            last = Some(key);
            count += 1;
        }
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(count, 9000);
    println!(
        "tunes=10000 traverse_ms={:.2} returned={count}",
        start.elapsed().as_secs_f64() * 1000.
    );
}

fn real_session(store: &mut ProductStore, count: u64) -> String {
    use float_view_refloat_telemetry_service::RideState;
    use float_view_session_sqlite::{LocationObservation, SessionWriter};
    store.update_settings(store.settings().unwrap().revision,r#"{"minimumSessionDistance":0,"locationRecordingEnabled":true,"includeGpsLocationWhenExporting":true}"#).unwrap();
    let board = store
        .ensure_board("scale-local", Some("Scale board"), Some(&[1; 12]), 1)
        .unwrap();
    let session = store
        .create_session(&board.saved_device_id, 1, u64::MAX)
        .unwrap();
    let mut writer = SessionWriter::open(store.session_path(&session.session_id).unwrap()).unwrap();
    for first in (1..=count).step_by(1000) {
        let samples = (first..=(first + 999).min(count))
            .map(|n| {
                let mut s = support::sample(n, n * 100);
                s.ride_state = RideState::Riding;
                s.speed_kph = Some(36.);
                s.pack_voltage_v = Some(80.);
                s.duty_cycle = Some(0.5);
                s
            })
            .collect::<Vec<_>>();
        writer.append_samples(&samples).unwrap();
    }
    let gps_every = std::env::var("FLOAT_VIEW_GPS_EVERY")
        .unwrap_or("10".into())
        .parse::<u64>()
        .unwrap();
    assert!(gps_every > 0);
    let locations = (1..=count / gps_every)
        .map(|n| LocationObservation {
            observed_at_epoch_ms: (n * gps_every * 100) as i64,
            elapsed_ms: n * gps_every * 100,
            latitude: -34.9,
            longitude: 138.6,
            accuracy_m: Some(3.),
            altitude_m: None,
        })
        .collect::<Vec<_>>();
    for batch in locations.chunks(1000) {
        writer.append_locations(batch).unwrap();
    }
    writer.close().unwrap();
    store
        .close_session(&session.session_id, (count * 100 + 1) as i64, "disconnect")
        .unwrap();
    session.session_id
}

#[test]
#[ignore = "on-disk SQLite scale benchmark"]
fn recovery_file_scale() {
    let dir = TestDirectory::new();
    let mut store = ProductStore::open(dir.path()).unwrap();
    let template = real_session(&mut store, 100);
    let template_path = store.session_path(&template).unwrap();
    let large_count = std::env::var("FLOAT_VIEW_RECOVERY_LARGE_SAMPLES")
        .unwrap_or("100000".into())
        .parse::<u64>()
        .unwrap();
    assert!(large_count >= 100);
    let large_template = real_session(&mut store, large_count);
    let large_path = store.session_path(&large_template).unwrap();
    drop(store);
    let mut db = Connection::open(dir.file("catalog.sqlite")).unwrap();
    let sizes = std::env::var("FLOAT_VIEW_RECOVERY_SIZES").unwrap_or("100,1000,3000".into());
    let mut previous = 0;
    for size in sizes.split(',').map(|s| s.parse::<u64>().unwrap()) {
        assert!(size >= 100 && size > previous);
        let start = Instant::now();
        let tx = db.transaction().unwrap();
        for n in previous..size {
            let id = format!("{n:032x}");
            let name = format!("session-{id}.sqlite");
            std::fs::copy(
                if n % 100 == 0 {
                    &large_path
                } else {
                    &template_path
                },
                dir.file(&name),
            )
            .unwrap();
            tx.execute("INSERT INTO session_catalog(session_id,job_id,file_name,device_history_id,device_snapshot_json,profile_snapshot_json,profile_revision,started_at_ms,ended_at_ms,state,integrity,requested_idle_ms,effective_idle_ms,requested_riding_ms,effective_riding_ms) SELECT ?1,?1,?2,device_history_id,device_snapshot_json,profile_snapshot_json,profile_revision,?3,100000,'completed','dirty',requested_idle_ms,effective_idle_ms,requested_riding_ms,effective_riding_ms FROM session_catalog WHERE session_id=?4",params![id,name,n+2,template]).unwrap();
        }
        let interrupted = format!("{:032x}", size - 1);
        tx.execute(
            "UPDATE session_catalog SET state='active',ended_at_ms=NULL WHERE session_id=?",
            [&interrupted],
        )
        .unwrap();
        tx.commit().unwrap();
        println!(
            "recovery files={} seed_ms={:.2}",
            size + 2,
            start.elapsed().as_secs_f64() * 1000.
        );
        let start = Instant::now();
        let store = ProductStore::open(dir.path()).unwrap();
        let recovered = store.session(&interrupted).unwrap();
        assert_eq!(recovered.state, "interrupted");
        assert_eq!(
            recovered.stored_sample_count,
            if (size - 1) % 100 == 0 {
                large_count
            } else {
                100
            }
        );
        let mismatches:u64=db.query_row("SELECT COUNT(*) FROM session_catalog WHERE stored_sample_count NOT IN (100,?1) OR committed_sequence<>stored_sample_count OR integrity='dirty' OR state='active'",[large_count],|r|r.get(0)).unwrap();
        let total: u64 = db
            .query_row(
                "SELECT SUM(stored_sample_count) FROM session_catalog",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let large_copies = size.div_ceil(100);
        assert_eq!(
            total,
            (size - large_copies + 1) * 100 + (large_copies + 1) * large_count
        );
        assert_eq!(mismatches, 0);
        println!(
            "recovery files={} open_ms={:.2}",
            size + 2,
            start.elapsed().as_secs_f64() * 1000.
        );
        drop(store);
        previous = size;
    }
}

#[test]
#[ignore = "on-disk SQLite scale benchmark"]
fn archive_csv_scale() {
    use float_view_product_store::{ExportFormat, FileCancellation};
    use std::io::{BufRead, Read};
    let dir = TestDirectory::new();
    let mut store = ProductStore::open(dir.path()).unwrap();
    let size = std::env::var("FLOAT_VIEW_EXPORT_SAMPLES")
        .unwrap_or("100000".into())
        .parse::<u64>()
        .unwrap();
    let id = real_session(&mut store, size);
    let cancel = FileCancellation::default();
    for format in [ExportFormat::Csv, ExportFormat::Archive] {
        let start = Instant::now();
        let file = store
            .prepare_export(&id, format)
            .unwrap()
            .run(&cancel)
            .unwrap();
        println!(
            "export samples={size} format={} bytes={} ms={:.2}",
            if format == ExportFormat::Csv {
                "csv"
            } else {
                "archive"
            },
            file.len().unwrap(),
            start.elapsed().as_secs_f64() * 1000.
        );
        if format == ExportFormat::Csv {
            let mut zip = zip::ZipArchive::new(std::fs::File::open(file.path()).unwrap()).unwrap();
            let csv = zip.by_index(0).unwrap();
            println!(
                "csv uncompressed_bytes={} compressed_bytes={}",
                csv.size(),
                csv.compressed_size()
            );
            assert!(csv.compressed_size() < csv.size());
            let count = std::io::BufReader::new(csv)
                .lines()
                .try_fold(0_usize, |count, line| line.map(|_| count + 1))
                .unwrap();
            assert_eq!(count as u64, size + 1);
        } else {
            let start = Instant::now();
            let mut sink = store.begin_import(file.len().unwrap()).unwrap();
            let mut source = std::fs::File::open(file.path()).unwrap();
            let mut buffer = [0; 65536];
            let mut offset = 0;
            loop {
                let n = source.read(&mut buffer).unwrap();
                if n == 0 {
                    break;
                }
                sink.write(offset, &buffer[..n]).unwrap();
                offset += n as u64;
            }
            let import = sink.validate(&cancel).unwrap();
            let imported = store.attach_import(import).unwrap();
            assert_eq!(imported.stored_sample_count, size);
            assert_eq!(
                imported.stored_location_count,
                store.session(&id).unwrap().stored_location_count
            );
            assert_eq!(imported.distance_m, store.session(&id).unwrap().distance_m);
            println!(
                "import samples={size} ms={:.2}",
                start.elapsed().as_secs_f64() * 1000.
            );
        }
    }
}

#[test]
#[ignore = "on-disk SQLite scale benchmark"]
fn live_catalog_scale() {
    use float_view_refloat_telemetry_service::RideState;
    use float_view_session_sqlite::{PublishedBoundary, SessionReader, SessionWriter};
    use std::sync::{
        Arc, Barrier,
        atomic::{AtomicBool, Ordering},
    };
    let dir = TestDirectory::new();
    let mut store = ProductStore::open(dir.path()).unwrap();
    let board = store.ensure_board("live", None, Some(&[2; 12]), 1).unwrap();
    let active = store
        .create_session(&board.saved_device_id, 1, u64::MAX)
        .unwrap();
    let path = store.session_path(&active.session_id).unwrap();
    let mut db = Connection::open(dir.file("catalog.sqlite")).unwrap();
    let tx = db.transaction().unwrap();
    for n in 0..100000 {
        let id = format!("{n:032x}");
        tx.execute("INSERT INTO session_catalog(session_id,job_id,file_name,device_history_id,device_snapshot_json,profile_snapshot_json,profile_revision,started_at_ms,state,integrity,requested_idle_ms,effective_idle_ms,requested_riding_ms,effective_riding_ms) VALUES (?1,?1,?2,'history','{}','{}',0,0,'completed','complete',1000,1000,100,100)",params![id,format!("session-{id}.sqlite")]).unwrap();
    }
    tx.commit().unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    let ready = Arc::new(Barrier::new(2));
    let worker_ready = ready.clone();
    let reader = std::thread::spawn(move || {
        let mut reader = SessionReader::open(path).unwrap();
        worker_ready.wait();
        let mut reads = 0;
        while !stopped.load(Ordering::Acquire) {
            let marker = reader.marker().unwrap();
            let boundary = PublishedBoundary::from(&marker);
            let page = reader
                .sample_page(
                    &["speedKph".into()],
                    marker.committed_elapsed_ms.saturating_sub(10000),
                    marker.committed_elapsed_ms,
                    100,
                    None,
                    boundary,
                )
                .unwrap();
            assert!(
                page.rows
                    .iter()
                    .all(|row| row.key.sequence <= boundary.sample_sequence)
            );
            reads += 1;
        }
        reads
    });
    let mut writer = SessionWriter::open(store.session_path(&active.session_id).unwrap()).unwrap();
    ready.wait();
    let mut latencies = Vec::new();
    let start = Instant::now();
    for first in (1..=100000).step_by(100) {
        let samples = (first..first + 100)
            .map(|n| {
                let mut s = support::sample(n, n * 100);
                s.ride_state = RideState::Riding;
                s.speed_kph = Some(36.);
                s
            })
            .collect::<Vec<_>>();
        let begin = Instant::now();
        let marker = writer.append_samples(&samples).unwrap();
        store
            .apply_session_marker(&active.session_id, &marker)
            .unwrap();
        let page = store.sessions(None, 100, None, false).unwrap();
        assert_eq!(page.items[0].session_id, active.session_id);
        assert_eq!(page.items[0].committed_sequence, first + 99);
        latencies.push(begin.elapsed().as_secs_f64() * 1000.);
    }
    stop.store(true, Ordering::Release);
    let reads = reader.join().unwrap();
    assert!(reads > 0);
    latencies.sort_by(f64::total_cmp);
    println!(
        "live samples=100000 catalog=100001 concurrent_reads={reads} total_ms={:.2} combined_batch_p95_ms={:.2} max_ms={:.2}",
        start.elapsed().as_secs_f64() * 1000.,
        latencies[950],
        latencies.last().unwrap()
    );
    writer.close().unwrap();
}
