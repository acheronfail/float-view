mod support;

use std::thread;
use std::time::Duration;

use float_view_refloat_telemetry_service::RideState;
use float_view_session_sqlite::{
    LocationObservation, PruneError, SessionMetadata, SessionPruner, SessionWriter,
};
use rusqlite::Connection;
use support::{TestDirectory, sample};

const VECTORS: &str = include_str!("../../../fixtures/session-sqlite/prune-vectors.tsv");
const EXPECTED: &str = include_str!("../../../fixtures/session-sqlite/prune-expected.tsv");

fn metadata() -> SessionMetadata {
    SessionMetadata {
        expected_riding_persistence_ms: 100,
        expected_idle_persistence_ms: 1_000,
        committed_at_epoch_ms: 1,
    }
}

fn dense_database(directory: &TestDirectory, name: &str) -> std::path::PathBuf {
    let path = directory.file(name);
    let mut writer = SessionWriter::create(&path, metadata()).expect("create database");
    let rows = VECTORS
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| {
            let columns = line.split('\t').collect::<Vec<_>>();
            let sequence = columns[0].parse().expect("sequence");
            let elapsed_ms = columns[1].parse().expect("elapsed");
            let mut value = sample(sequence, elapsed_ms);
            value.ride_state = match columns[2] {
                "idle" => RideState::Idle,
                "riding" => RideState::Riding,
                _ => panic!("unknown fixture ride state"),
            };
            value.speed_kph = Some(columns[3].parse().expect("speed"));
            value.pack_voltage_v = Some(columns[4].parse().expect("voltage"));
            value
        })
        .collect::<Vec<_>>();
    writer
        .append_samples(&rows)
        .expect("append fixture samples");
    writer
        .append_locations(&[
            LocationObservation {
                observed_at_epoch_ms: 100,
                elapsed_ms: 100,
                latitude: 1.0,
                longitude: 2.0,
                accuracy_m: Some(3.0),
                altitude_m: None,
            },
            LocationObservation {
                observed_at_epoch_ms: 30_000,
                elapsed_ms: 30_000,
                latitude: 2.0,
                longitude: 3.0,
                accuracy_m: None,
                altitude_m: None,
            },
        ])
        .expect("append fixture locations");
    writer.close().expect("close fixture writer");
    path
}

#[test]
fn exact_fixture_previews_commits_and_reopens_at_coarser_resolution() {
    let directory = TestDirectory::new();
    let path = dense_database(&directory, "exact.sqlite3");
    let expected = EXPECTED
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect::<Vec<_>>();
    let first = expected[0].split('\t').collect::<Vec<_>>();
    let mut pruner = SessionPruner::open(&path).expect("open pruner");
    let plan = pruner.preview(10).expect("preview initial prune");
    let preview = plan.preview();
    assert_eq!(
        preview.target_resolution_seconds,
        first[0].parse::<u64>().unwrap()
    );
    assert_eq!(
        preview.recorded_sample_count,
        first[1].parse::<u64>().unwrap()
    );
    assert_eq!(
        preview.stored_sample_count,
        first[2].parse::<u64>().unwrap()
    );
    assert_eq!(
        preview.retained_sample_count,
        first[3].parse::<u64>().unwrap()
    );
    assert_eq!(
        preview.estimated_reclaimable_bytes,
        first[4].parse::<u64>().unwrap()
    );
    assert!(!preview.skipped);
    let result = pruner.commit(plan, 2_000).expect("commit initial prune");
    assert_eq!(
        result.stored_location_count,
        first[6].parse::<u64>().unwrap()
    );
    assert_eq!(result.history_revision, first[7].parse::<u64>().unwrap());
    assert!(!result.skipped);
    pruner.close().expect("close pruner");

    let database = Connection::open(&path).expect("inspect pruned database");
    let kept = database
        .prepare("SELECT sequence FROM sample ORDER BY sequence")
        .unwrap()
        .query_map([], |row| row.get::<_, u64>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(
        kept.iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join(","),
        first[5]
    );
    assert_eq!(
        scalar(&database, "SELECT recorded_sample_count FROM commit_marker"),
        12
    );
    assert_eq!(
        scalar(&database, "SELECT stored_sample_count FROM commit_marker"),
        4
    );
    assert_eq!(
        scalar(&database, "SELECT stored_location_count FROM commit_marker"),
        1
    );
    assert_eq!(
        scalar(&database, "SELECT history_revision FROM commit_marker"),
        1
    );
    assert_eq!(
        scalar(
            &database,
            "SELECT retained_resolution_seconds FROM session_metadata"
        ),
        10
    );
    let policy: String = database
        .query_row("SELECT prune_policy FROM session_metadata", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(policy, "m4-source-v1");
    drop(database);

    let second = expected[1].split('\t').collect::<Vec<_>>();
    let mut pruner = SessionPruner::open(&path).expect("reopen pruner");
    let plan = pruner.preview(20).expect("preview coarser prune");
    let before = bytes_and_marker(&path);
    assert!(plan.preview().skipped);
    let result = pruner.commit(plan, 3_000).expect("commit no-op");
    assert!(result.skipped);
    assert_eq!(bytes_and_marker(&path).1, before.1);
    assert_eq!(
        result.preview.retained_sample_count,
        second[3].parse::<u64>().unwrap()
    );
    assert_eq!(result.preview.estimated_reclaimable_bytes, 0);
}

#[test]
fn empty_no_op_and_resolution_rules_preserve_the_database() {
    let directory = TestDirectory::new();
    let path = directory.file("empty.sqlite3");
    SessionWriter::create(&path, metadata())
        .unwrap()
        .close()
        .unwrap();
    let mut pruner = SessionPruner::open(&path).unwrap();
    let plan = pruner.preview(1).unwrap();
    assert!(plan.preview().skipped);
    let marker_before = bytes_and_marker(&path).1;
    assert!(pruner.commit(plan, 2).unwrap().skipped);
    assert_eq!(bytes_and_marker(&path).1, marker_before);
    assert_eq!(pruner.preview(0).unwrap_err(), PruneError::InvalidInput);
    assert_eq!(pruner.preview(301).unwrap_err(), PruneError::InvalidInput);
}

#[test]
fn stale_and_foreign_plans_fail_before_mutation() {
    let directory = TestDirectory::new();
    let path = dense_database(&directory, "stale.sqlite3");
    let mut first = SessionPruner::open(&path).unwrap();
    let stale = first.preview(10).unwrap();
    Connection::open(&path)
        .unwrap()
        .execute(
            "UPDATE commit_marker SET committed_at_ms = committed_at_ms + 1",
            [],
        )
        .unwrap();
    let before = bytes_and_marker(&path).1;
    assert_eq!(first.commit(stale, 10).unwrap_err(), PruneError::Stale);
    assert_eq!(bytes_and_marker(&path).1, before);

    let plan = first.preview(10).unwrap();
    let mut second = SessionPruner::open(&path).unwrap();
    assert_eq!(
        second.commit(plan, 10).unwrap_err(),
        PruneError::InvalidInput
    );
    assert_eq!(bytes_and_marker(&path).1, before);
}

#[test]
fn lock_and_injected_delete_failure_roll_back_and_allow_reuse() {
    let directory = TestDirectory::new();
    let path = dense_database(&directory, "rollback.sqlite3");
    let mut pruner = SessionPruner::open(&path).unwrap();
    let plan = pruner.preview(10).unwrap();
    let locker = Connection::open(&path).unwrap();
    locker.execute_batch("BEGIN IMMEDIATE;").unwrap();
    assert_eq!(pruner.commit(plan, 10).unwrap_err(), PruneError::Busy);
    locker.execute_batch("ROLLBACK;").unwrap();

    let plan = pruner.preview(10).unwrap();
    Connection::open(&path)
        .unwrap()
        .execute_batch("CREATE TRIGGER reject_prune BEFORE DELETE ON sample BEGIN SELECT RAISE(ABORT, 'injected'); END;")
        .unwrap();
    let before = bytes_and_marker(&path).1;
    assert_eq!(pruner.commit(plan, 10).unwrap_err(), PruneError::Database);
    assert_eq!(bytes_and_marker(&path).1, before);
    Connection::open(&path)
        .unwrap()
        .execute_batch("DROP TRIGGER reject_prune;")
        .unwrap();
    let plan = pruner.preview(10).expect("pruner reusable after rollback");
    assert!(!pruner.commit(plan, 11).unwrap().skipped);
}

#[test]
fn every_logical_mutation_stage_rolls_back_as_one_unit() {
    let cases = [
        (
            "sample",
            "CREATE TRIGGER reject_stage BEFORE DELETE ON sample BEGIN SELECT RAISE(ABORT, 'injected'); END;",
        ),
        (
            "location",
            "CREATE TRIGGER reject_stage BEFORE DELETE ON location BEGIN SELECT RAISE(ABORT, 'injected'); END;",
        ),
        (
            "metadata",
            "CREATE TRIGGER reject_stage BEFORE UPDATE ON session_metadata BEGIN SELECT RAISE(ABORT, 'injected'); END;",
        ),
        (
            "marker",
            "CREATE TRIGGER reject_stage BEFORE UPDATE ON commit_marker BEGIN SELECT RAISE(ABORT, 'injected'); END;",
        ),
    ];
    for (name, trigger) in cases {
        let directory = TestDirectory::new();
        let path = dense_database(&directory, &format!("stage-{name}.sqlite3"));
        let mut pruner = SessionPruner::open(&path).unwrap();
        let plan = pruner.preview(10).unwrap();
        Connection::open(&path)
            .unwrap()
            .execute_batch(trigger)
            .unwrap();
        let before = durable_projection(&path);
        assert_eq!(pruner.commit(plan, 50).unwrap_err(), PruneError::Database);
        assert_eq!(durable_projection(&path), before);
        Connection::open(&path)
            .unwrap()
            .execute_batch("DROP TRIGGER reject_stage;")
            .unwrap();
        let plan = pruner.preview(10).expect("preview after rollback");
        assert!(
            !pruner
                .commit(plan, 51)
                .expect("commit after rollback")
                .skipped
        );
    }
}

#[test]
fn malformed_prune_state_and_coarser_alignment_fail_closed() {
    let directory = TestDirectory::new();
    let missing = directory.file("missing.sqlite3");
    assert_eq!(
        SessionPruner::open(&missing).unwrap_err(),
        PruneError::NotFound
    );
    std::fs::write(&missing, b"not sqlite").unwrap();
    assert_eq!(
        SessionPruner::open(&missing).unwrap_err(),
        PruneError::Corrupt
    );

    let bad_ride = dense_database(&directory, "bad-ride.sqlite3");
    let mut pruner = SessionPruner::open(&bad_ride).unwrap();
    Connection::open(&bad_ride)
        .unwrap()
        .execute(
            "UPDATE sample SET ride_state = 'private-value' WHERE sequence = 2",
            [],
        )
        .unwrap();
    assert_eq!(pruner.preview(10).unwrap_err(), PruneError::Incompatible);
    assert_eq!(
        format!("{:?}", pruner.preview(10).unwrap_err()),
        "Incompatible"
    );

    let missing_summary = dense_database(&directory, "missing-summary.sqlite3");
    Connection::open(&missing_summary)
        .unwrap()
        .execute(
            "UPDATE commit_marker SET maximum_speed_source_sequence = 999",
            [],
        )
        .unwrap();
    let mut pruner = SessionPruner::open(&missing_summary).unwrap();
    assert_eq!(pruner.preview(10).unwrap_err(), PruneError::Incompatible);

    let bad_foreign_key = dense_database(&directory, "bad-foreign-key.sqlite3");
    Connection::open(&bad_foreign_key)
        .unwrap()
        .execute_batch(
            "PRAGMA foreign_keys = OFF; DELETE FROM sample WHERE sequence = 1; UPDATE commit_marker SET stored_sample_count = stored_sample_count - 1;",
        )
        .unwrap();
    assert_eq!(
        SessionPruner::open(&bad_foreign_key).unwrap_err(),
        PruneError::Incompatible
    );

    let nonfinite = dense_database(&directory, "nonfinite.sqlite3");
    let mut pruner = SessionPruner::open(&nonfinite).unwrap();
    Connection::open(&nonfinite)
        .unwrap()
        .execute(
            "UPDATE sample SET speed_kph = ? WHERE sequence = 2",
            [f64::INFINITY],
        )
        .unwrap();
    assert_eq!(pruner.preview(10).unwrap_err(), PruneError::Incompatible);

    let alignment = dense_database(&directory, "alignment.sqlite3");
    let mut pruner = SessionPruner::open(&alignment).unwrap();
    let plan = pruner.preview(10).unwrap();
    pruner.commit(plan, 10).unwrap();
    assert_eq!(pruner.preview(10).unwrap_err(), PruneError::InvalidInput);
    assert_eq!(pruner.preview(15).unwrap_err(), PruneError::InvalidInput);
}

#[test]
fn source_row_ceiling_rejects_before_publishing_a_plan() {
    let directory = TestDirectory::new();
    let path = directory.file("too-many.sqlite3");
    SessionWriter::create(&path, metadata())
        .unwrap()
        .close()
        .unwrap();
    let database = Connection::open(&path).unwrap();
    database
        .execute_batch(
            "WITH RECURSIVE numbers(value) AS (VALUES(1) UNION ALL SELECT value + 1 FROM numbers WHERE value < 200001) INSERT INTO sample(sequence, observed_at_ms, monotonic_elapsed_ms, ride_state) SELECT value, value, value, 'idle' FROM numbers; UPDATE commit_marker SET committed_sample_sequence = 200001, recorded_sample_count = 200001, stored_sample_count = 200001, committed_elapsed_ms = 200001;",
        )
        .unwrap();
    drop(database);
    assert_eq!(
        SessionPruner::open(&path).unwrap_err(),
        PruneError::Incompatible
    );
}

#[test]
fn active_wal_progress_invalidates_a_preview_without_blocking_writer() {
    let directory = TestDirectory::new();
    let path = dense_database(&directory, "wal.sqlite3");
    let mut pruner = SessionPruner::open(&path).unwrap();
    let plan = pruner.preview(10).unwrap();
    let mut writer = SessionWriter::open(&path).expect("open concurrent writer");
    let mut next = sample(13, 1_200);
    next.speed_kph = Some(12.0);
    next.pack_voltage_v = Some(88.0);
    writer.append_samples(&[next]).expect("writer advances");
    writer.close().unwrap();
    assert_eq!(pruner.commit(plan, 20).unwrap_err(), PruneError::Stale);
    assert_eq!(
        scalar(
            &Connection::open(&path).unwrap(),
            "SELECT COUNT(*) FROM sample"
        ),
        13
    );
}

#[test]
fn interruption_is_payload_free_and_pruner_remains_reusable() {
    let directory = TestDirectory::new();
    let path = directory.file("interrupt.sqlite3");
    SessionWriter::create(&path, metadata())
        .unwrap()
        .close()
        .unwrap();
    let database = Connection::open(&path).unwrap();
    database
        .execute_batch(
            "WITH RECURSIVE numbers(value) AS (VALUES(1) UNION ALL SELECT value + 1 FROM numbers WHERE value < 200000) INSERT INTO sample(sequence, observed_at_ms, monotonic_elapsed_ms, ride_state, speed_kph, raw_pack_voltage_v) SELECT value, value, value, 'idle', value % 101, 100.0 - (value % 20) FROM numbers; UPDATE commit_marker SET committed_sample_sequence = 200000, recorded_sample_count = 200000, stored_sample_count = 200000, committed_elapsed_ms = 200000;",
        )
        .unwrap();
    drop(database);
    let mut pruner = SessionPruner::open(&path).unwrap();
    let interrupter = pruner.interrupter();
    let handle = thread::spawn(move || {
        for _ in 0..100 {
            thread::sleep(Duration::from_millis(1));
            interrupter.interrupt();
        }
    });
    let error = pruner.preview(10).expect_err("preview interrupted");
    handle.join().unwrap();
    assert_eq!(error, PruneError::Cancelled);
    assert_eq!(format!("{error:?}"), "Cancelled");
    assert_eq!(format!("{pruner:?}"), "SessionPruner([redacted])");
    let plan = pruner.preview(10).expect("preview after interruption");
    let interrupter = pruner.interrupter();
    let handle = thread::spawn(move || {
        for _ in 0..100 {
            thread::sleep(Duration::from_millis(1));
            interrupter.interrupt();
        }
    });
    assert_eq!(pruner.commit(plan, 2).unwrap_err(), PruneError::Cancelled);
    handle.join().unwrap();
    assert_eq!(
        scalar(
            &Connection::open(&path).unwrap(),
            "SELECT stored_sample_count FROM commit_marker"
        ),
        200_000
    );
    let plan = pruner.preview(10).expect("preview after cancelled commit");
    assert!(
        !pruner
            .commit(plan, 3)
            .expect("commit after cancelled commit")
            .skipped
    );
}

fn scalar(database: &Connection, sql: &str) -> u64 {
    database.query_row(sql, [], |row| row.get(0)).unwrap()
}

fn bytes_and_marker(path: &std::path::Path) -> (Vec<u8>, (u64, u64, u64, i64)) {
    let database = Connection::open(path).unwrap();
    let marker = database
        .query_row(
            "SELECT stored_sample_count, stored_location_count, history_revision, committed_at_ms FROM commit_marker",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    drop(database);
    (std::fs::read(path).unwrap(), marker)
}

fn durable_projection(path: &std::path::Path) -> (u64, u64, u64, u64, Option<i64>, Option<u64>) {
    Connection::open(path)
        .unwrap()
        .query_row(
            "SELECT (SELECT COUNT(*) FROM sample), (SELECT COUNT(*) FROM location), stored_sample_count, history_revision, (SELECT pruned_at_ms FROM session_metadata), (SELECT retained_resolution_seconds FROM session_metadata) FROM commit_marker",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .unwrap()
}

#[test]
fn preview_estimate_tracks_sample_storage_excludes_diagnostics_and_is_read_only() {
    let dir = TestDirectory::new();
    let path = dense_database(&dir, "storage.sqlite");
    let mut pruner = SessionPruner::open(&path).unwrap();
    let small = pruner.preview(10).unwrap().preview();
    pruner.close().unwrap();
    let db = Connection::open(&path).unwrap();
    // Simulate a much wider numeric extension payload without changing sample
    // selection. Diagnostic storage must never inflate the estimate.
    let payload = serde_json::to_string(&std::collections::BTreeMap::from_iter(
        (0..35).map(|i| (format!("field_{i:02}_{}", "x".repeat(50)), 1.23456789)),
    ))
    .unwrap();
    db.execute("UPDATE sample SET extension_json = ?", [&payload])
        .unwrap();
    drop(db);
    let mut pruner = SessionPruner::open(&path).unwrap();
    let wide = pruner.preview(10).unwrap().preview();
    assert_eq!(small.retained_sample_count, wide.retained_sample_count);
    assert!(wide.estimated_reclaimable_bytes > small.estimated_reclaimable_bytes * 2);
    pruner.close().unwrap();
    let db = Connection::open(&path).unwrap();
    for _ in 0..500 {
        db.execute(
            "INSERT INTO session_diagnostic(record_json) VALUES (?)",
            [serde_json::json!({"data": "x".repeat(900)}).to_string()],
        )
        .unwrap();
    }
    drop(db);
    let before = std::fs::read(&path).unwrap();
    let mut pruner = SessionPruner::open(&path).unwrap();
    let with_diagnostics = pruner.preview(10).unwrap().preview();
    assert_eq!(wide, with_diagnostics);
    pruner.close().unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), before);
}
