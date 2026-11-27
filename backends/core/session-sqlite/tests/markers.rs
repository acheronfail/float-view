mod support;
use float_view_session_sqlite::{
    LocationObservation, SessionMetadata, SessionReader, SessionWriter,
};
use support::{TestDirectory, sample};
fn id(n: usize) -> String {
    format!("00000000-0000-4000-8000-{n:012x}")
}
fn writer(path: &std::path::Path) -> SessionWriter {
    SessionWriter::create(
        path,
        SessionMetadata {
            expected_riding_persistence_ms: 100,
            expected_idle_persistence_ms: 1000,
            committed_at_epoch_ms: 1_000_000,
        },
    )
    .unwrap()
}
#[test]
fn markers_are_durable_idempotent_and_independent_of_samples() {
    let dir = TestDirectory::new();
    let path = dir.file("markers.db");
    let mut w = writer(&path);
    let (first, boundary) = w
        .append_ride_marker(&id(1), 1000, 1_001_000, false)
        .unwrap();
    assert_eq!(boundary.committed_elapsed_ms, 1000);
    assert_eq!(
        w.append_ride_marker(&id(1), 1001, 1_001_001, false)
            .unwrap()
            .0,
        first
    );
    assert!(
        w.append_ride_marker(&id(2), 1499, 1_001_499, false)
            .is_err()
    );
    w.append_samples(&[sample(1, 500)]).unwrap();
    assert_eq!(w.marker().unwrap().committed_elapsed_ms, 1000);
    w.close().unwrap();
    let mut w = SessionWriter::open(&path).unwrap();
    assert_eq!(
        w.append_ride_marker(&id(1), 3000, 1_003_000, false)
            .unwrap()
            .0,
        first
    );
    let boundary = w.marker().unwrap();
    assert_eq!(
        SessionReader::open(&path)
            .unwrap()
            .ride_markers((&boundary).into())
            .unwrap(),
        vec![first]
    );
}
#[test]
fn markers_use_only_recent_committed_fixes_and_enforce_capacity() {
    let dir = TestDirectory::new();
    let path = dir.file("locations.db");
    let mut w = writer(&path);
    w.append_locations(&[LocationObservation {
        elapsed_ms: 1000,
        observed_at_epoch_ms: 1_001_000,
        latitude: 1.,
        longitude: 2.,
        accuracy_m: Some(5.),
        altitude_m: None,
    }])
    .unwrap();
    assert!(
        w.append_ride_marker(&id(0), 11_000, 1_011_000, true)
            .unwrap()
            .0
            .location
            .is_some()
    );
    assert!(
        w.append_ride_marker(&id(1), 11_500, 1_011_500, true)
            .unwrap()
            .0
            .location
            .is_none()
    );
    for n in 2..1000 {
        w.append_ride_marker(
            &id(n),
            11_000 + n as u64 * 500,
            1_011_000 + n as i64 * 500,
            false,
        )
        .unwrap();
    }
    assert!(
        w.append_ride_marker(&id(1000), 1_000_000, 2_000_000, false)
            .is_err()
    );
    assert!(
        w.append_ride_marker(&id(0), 1_000_000, 2_000_000, false)
            .is_ok()
    );
}
#[test]
fn malformed_marker_and_failed_commit_do_not_publish() {
    let dir = TestDirectory::new();
    let path = dir.file("failure.db");
    let mut w = writer(&path);
    let before = w.marker().unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("CREATE TRIGGER fail_marker BEFORE INSERT ON session_event BEGIN SELECT RAISE(ABORT,'failure'); END;").unwrap();
    assert!(
        w.append_ride_marker(&id(1), 1000, 1_001_000, false)
            .is_err()
    );
    assert_eq!(w.marker().unwrap(), before);
    db.execute_batch("DROP TRIGGER fail_marker;").unwrap();
    w.append_ride_marker(&id(1), 1000, 1_001_000, false)
        .unwrap();
    db.execute(
        "UPDATE session_event SET details_json='{}' WHERE kind='session_marker'",
        [],
    )
    .unwrap();
    let mut reader = SessionReader::open(&path).unwrap();
    assert!(reader.ride_markers((&w.marker().unwrap()).into()).is_err());
}

#[test]
fn pruning_preserves_marker_location_and_duration() {
    let dir = TestDirectory::new();
    let path = dir.file("prune.db");
    let mut w = writer(&path);
    w.append_samples(&(1..=100).map(|n| sample(n, n * 100)).collect::<Vec<_>>())
        .unwrap();
    w.append_locations(&[LocationObservation {
        elapsed_ms: 11_000,
        observed_at_epoch_ms: 1_011_000,
        latitude: 1.,
        longitude: 2.,
        accuracy_m: None,
        altitude_m: None,
    }])
    .unwrap();
    let (marker, _) = w
        .append_ride_marker(&id(1), 12_000, 1_012_000, true)
        .unwrap();
    w.close().unwrap();
    let mut pruner = float_view_session_sqlite::SessionPruner::open(&path).unwrap();
    let plan = pruner.preview(10).unwrap();
    pruner.commit(plan, 1_100_000).unwrap();
    let mut reader = SessionReader::open(&path).unwrap();
    let boundary = reader.marker().unwrap();
    assert!(boundary.committed_elapsed_ms >= 12_000);
    assert_eq!(
        reader.ride_markers((&boundary).into()).unwrap(),
        vec![marker]
    );
}

#[test]
fn disabled_and_future_fixes_produce_time_only_markers() {
    let dir = TestDirectory::new();
    let path = dir.file("future.db");
    let mut w = writer(&path);
    w.append_locations(&[LocationObservation {
        elapsed_ms: 2000,
        observed_at_epoch_ms: 1_002_000,
        latitude: 1.,
        longitude: 2.,
        accuracy_m: Some(1.),
        altitude_m: None,
    }])
    .unwrap();
    for (n, elapsed, wall, enabled) in [
        (1, 1000, 1_001_000, true),
        (2, 2000, 1_001_999, true),
        (3, 2500, 1_002_500, false),
    ] {
        assert!(
            w.append_ride_marker(&id(n), elapsed, wall, enabled)
                .unwrap()
                .0
                .location
                .is_none()
        );
    }
    let old = w.marker().unwrap();
    let (located, _) = w.append_ride_marker(&id(4), 3000, 1_003_000, true).unwrap();
    assert!(located.location.is_some());
    let mut reader = SessionReader::open(&path).unwrap();
    assert_eq!(reader.ride_markers((&old).into()).unwrap().len(), 3);
    assert_eq!(
        reader
            .ride_markers((&w.marker().unwrap()).into())
            .unwrap()
            .len(),
        4
    );
    let mut other = writer(&dir.file("other.db"));
    assert!(
        other
            .append_ride_marker(&id(1), 3000, 1_003_000, true)
            .unwrap()
            .0
            .location
            .is_none()
    );
}
