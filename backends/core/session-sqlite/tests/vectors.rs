mod support;

use std::fs;

use float_view_refloat_telemetry_service::{ExtensionValue, PackageState, RideState};
use float_view_session_sqlite::{
    LocationObservation, SESSION_SCHEMA, SessionMetadata, SessionWriter, WriterError,
};
use rusqlite::Connection;
use support::{TestDirectory, sample};

const SAMPLE_FIXTURE: &str = include_str!("../../../fixtures/session-sqlite/samples.tsv");
const SAMPLE_EXPECTED: &str = include_str!("../../../fixtures/session-sqlite/samples-expected.tsv");
const LOCATION_FIXTURE: &str = include_str!("../../../fixtures/session-sqlite/locations.tsv");
const LOCATION_EXPECTED: &str =
    include_str!("../../../fixtures/session-sqlite/locations-expected.tsv");

fn metadata() -> SessionMetadata {
    SessionMetadata {
        expected_riding_persistence_ms: 100,
        expected_idle_persistence_ms: 1_000,
        committed_at_epoch_ms: 999_000,
    }
}

#[test]
fn creates_the_exact_canonical_database_and_reopens_it() {
    assert_eq!(
        SESSION_SCHEMA.as_bytes(),
        fs::read("../../sql/session.sql").expect("read canonical schema")
    );
    let directory = TestDirectory::new();
    let path = directory.file("session.sqlite3");
    let writer = SessionWriter::create(&path, metadata()).expect("create writer");
    assert_eq!(writer.marker().expect("marker").recorded_sample_count, 0);
    writer.checkpoint().expect("checkpoint");
    writer.close().expect("close");

    let database = Connection::open(&path).expect("independent database connection");
    let pragmas: (i64, String, i64) = database
        .query_row(
            "SELECT (SELECT auto_vacuum FROM pragma_auto_vacuum), (SELECT journal_mode FROM pragma_journal_mode), (SELECT synchronous FROM pragma_synchronous)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("query pragmas");
    assert_eq!(pragmas, (2, "wal".to_owned(), 2));
    assert_eq!(
        database
            .query_row("SELECT COUNT(*) FROM session_metadata", [], |row| row
                .get::<_, i64>(0))
            .expect("metadata count"),
        1
    );
    drop(database);
    SessionWriter::open(&path).expect("reopen compatible database");
}

#[test]
fn rejects_superseded_android_framework_metadata() {
    let directory = TestDirectory::new();
    let path = directory.file("android-session.sqlite3");
    SessionWriter::create(&path, metadata())
        .expect("create writer")
        .close()
        .expect("close writer");
    Connection::open(&path)
        .expect("open Android-shaped database")
        .execute_batch(
            "CREATE TABLE android_metadata (locale TEXT); INSERT INTO android_metadata(locale) VALUES ('en_US');",
        )
        .expect("add exact Android framework metadata");
    assert_eq!(
        SessionWriter::open(&path).expect_err("reject superseded Android metadata"),
        WriterError::Incompatible
    );
}

#[test]
fn preserves_an_existing_target_and_rejects_malformed_files() {
    let directory = TestDirectory::new();
    let target = directory.file("existing.sqlite3");
    fs::write(&target, b"owner data").expect("seed target");
    assert_eq!(
        SessionWriter::create(&target, metadata()).expect_err("must reject target"),
        WriterError::TargetExists
    );
    assert_eq!(fs::read(&target).expect("target remains"), b"owner data");
    assert_eq!(
        directory.path().read_dir().expect("list directory").count(),
        1
    );
    assert_eq!(
        SessionWriter::open(&target).expect_err("must reject corrupt file"),
        WriterError::Corrupt
    );

    let incompatible = directory.file("incompatible.sqlite3");
    Connection::open(&incompatible)
        .expect("open incompatible")
        .execute_batch("CREATE TABLE unrelated(value INTEGER);")
        .expect("create incompatible schema");
    let before = fs::read(&incompatible).expect("capture incompatible file");
    assert_eq!(
        SessionWriter::open(&incompatible).expect_err("must reject incompatible schema"),
        WriterError::Incompatible
    );
    assert_eq!(
        fs::read(&incompatible).expect("read incompatible file"),
        before
    );

    let invalid_singleton = directory.file("invalid-singleton.sqlite3");
    SessionWriter::create(&invalid_singleton, metadata())
        .expect("create singleton database")
        .close()
        .expect("close singleton database");
    Connection::open(&invalid_singleton)
        .expect("open singleton database")
        .execute("DELETE FROM commit_marker", [])
        .expect("remove marker");
    assert_eq!(
        SessionWriter::open(&invalid_singleton).expect_err("reject missing marker"),
        WriterError::Incompatible
    );
}

#[test]
fn sample_batches_replay_transitions_fields_and_exact_aggregates() {
    let directory = TestDirectory::new();
    let path = directory.file("samples.sqlite3");
    let mut writer = SessionWriter::create(&path, metadata()).expect("create writer");
    let mut samples = [
        sample(1, 0),
        sample(2, 1_000),
        sample(3, 2_000),
        sample(4, 3_000),
    ];
    samples[0].package_state = Some(PackageState::Ready);
    samples[0].duty_cycle = Some(0.1);
    samples[1].ride_state = RideState::Riding;
    samples[1].package_state = Some(PackageState::Running);
    samples[1].speed_kph = Some(18.0);
    samples[1].duty_cycle = Some(-0.5);
    samples[1].extensions.push(ExtensionValue {
        name: "customVoltage".to_owned(),
        value: 42.5,
    });
    samples[2].ride_state = RideState::Riding;
    samples[2].package_state = Some(PackageState::Running);
    samples[2].speed_kph = Some(-18.0);
    samples[2].duty_cycle = Some(0.5);
    samples[2].extensions.push(ExtensionValue {
        name: "customVoltage".to_owned(),
        value: 43.0,
    });
    samples[3].package_state = Some(PackageState::Ready);
    samples[3].speed_kph = Some(0.0);
    samples[3].duty_cycle = Some(0.2);

    writer.append_samples(&samples[..2]).expect("first batch");
    writer.checkpoint().expect("checkpoint");
    writer.close().expect("close");
    let mut writer = SessionWriter::open(&path).expect("reopen");
    let marker = writer.append_samples(&samples[2..]).expect("second batch");
    assert_eq!(marker.recorded_sample_count, 4);
    assert_eq!(marker.stored_sample_count, 4);
    assert_eq!(marker.committed_sample_sequence, 4);
    assert_eq!(marker.committed_elapsed_ms, 3_000);
    assert_eq!(marker.riding_elapsed_ms, 2_000);
    assert_eq!(marker.distance_m, Some(7.5));
    assert_eq!(marker.maximum_speed_kph, Some(18.0));
    assert_eq!(marker.maximum_speed_source_sequence, Some(2));
    assert_eq!(marker.maximum_duty_cycle, Some(0.5));
    assert_eq!(marker.maximum_duty_source_sequence, Some(2));
    assert_eq!(marker.last_speed_kph, Some(0.0));
    assert_eq!(marker.last_ride_state.as_deref(), Some("idle"));
    let replayed = writer.append_samples(&samples).expect("duplicate replay");
    assert_eq!(replayed.recorded_sample_count, 8);
    assert_eq!(replayed.stored_sample_count, 4);
    writer.close().expect("close");

    let database = Connection::open(&path).expect("independent database connection");
    assert_eq!(scalar(&database, "SELECT COUNT(*) FROM sample"), 4);
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM session_numeric_field"),
        3
    );
    assert_eq!(scalar(&database, "SELECT COUNT(*) FROM session_event"), 5);
    let extension: String = database
        .query_row(
            "SELECT extension_json FROM sample WHERE sequence = 2",
            [],
            |row| row.get(0),
        )
        .expect("extension JSON");
    assert_eq!(extension, r#"{"customVoltage":42.5}"#);
}

#[test]
fn locations_sort_deduplicate_and_continue_after_reopen() {
    let directory = TestDirectory::new();
    let path = directory.file("locations.sqlite3");
    let mut writer = SessionWriter::create(&path, metadata()).expect("create writer");
    let locations = [
        location(2_500, -33.8688, 151.2093, None),
        location(1_500, -33.8680, 151.2090, Some(4.5)),
        location(1_500, -33.8680, 151.2090, Some(9.0)),
    ];
    let marker = writer
        .append_locations(&locations)
        .expect("append locations");
    assert_eq!(marker.recorded_location_count, 2);
    assert_eq!(marker.committed_location_elapsed_ms, 2_500);
    writer.close().expect("close");
    let mut writer = SessionWriter::open(&path).expect("reopen");
    let unchanged = writer
        .append_locations(&locations)
        .expect("duplicate locations");
    assert_eq!(unchanged, marker);
    let marker = writer
        .append_locations(&[location(3_500, 90.0, -180.0, Some(0.0))])
        .expect("boundary location");
    assert_eq!(marker.recorded_location_count, 3);
    assert_eq!(marker.stored_location_count, 3);
    assert_eq!(marker.committed_location_sequence, 3);
    assert_eq!(marker.last_location_status, "available");
}

#[test]
fn literal_fixtures_replay_to_the_committed_database_projection() {
    let directory = TestDirectory::new();
    let path = directory.file("fixtures.sqlite3");
    let mut writer = SessionWriter::create(&path, metadata()).expect("create writer");
    let samples = parse_sample_fixture();
    let sample_marker = writer
        .append_samples(&samples)
        .expect("append sample fixture");
    writer.close().expect("close");

    let database = Connection::open(&path).expect("independent sample projection");
    let sample_actual = vec![
        projection(
            "sample",
            "count",
            scalar(&database, "SELECT COUNT(*) FROM sample"),
        ),
        projection(
            "session_numeric_field",
            "count",
            scalar(&database, "SELECT COUNT(*) FROM session_numeric_field"),
        ),
        projection(
            "session_event",
            "count",
            scalar(&database, "SELECT COUNT(*) FROM session_event"),
        ),
        projection(
            "commit_marker",
            "recorded_sample_count",
            sample_marker.recorded_sample_count,
        ),
        projection(
            "commit_marker",
            "stored_sample_count",
            sample_marker.stored_sample_count,
        ),
        projection(
            "commit_marker",
            "committed_sample_sequence",
            sample_marker.committed_sample_sequence,
        ),
        projection(
            "commit_marker",
            "committed_elapsed_ms",
            sample_marker.committed_elapsed_ms,
        ),
        projection(
            "commit_marker",
            "riding_elapsed_ms",
            sample_marker.riding_elapsed_ms,
        ),
        projection(
            "commit_marker",
            "distance_m",
            sample_marker.distance_m.expect("distance"),
        ),
        projection(
            "commit_marker",
            "maximum_speed_kph",
            sample_marker.maximum_speed_kph.expect("maximum speed"),
        ),
        projection(
            "commit_marker",
            "maximum_speed_source_sequence",
            sample_marker
                .maximum_speed_source_sequence
                .expect("speed source"),
        ),
        projection(
            "commit_marker",
            "maximum_duty_cycle",
            sample_marker.maximum_duty_cycle.expect("maximum duty"),
        ),
        projection(
            "commit_marker",
            "maximum_duty_source_sequence",
            sample_marker
                .maximum_duty_source_sequence
                .expect("duty source"),
        ),
        projection(
            "commit_marker",
            "last_speed_kph",
            sample_marker.last_speed_kph.expect("last speed"),
        ),
        format!(
            "commit_marker\tlast_ride_state\t{}",
            sample_marker.last_ride_state.expect("last state")
        ),
    ];
    assert_eq!(sample_actual, fixture_data_lines(SAMPLE_EXPECTED));
    drop(database);

    let mut writer = SessionWriter::open(&path).expect("reopen for locations");
    let location_marker = writer
        .append_locations(&parse_location_fixture())
        .expect("append location fixture");
    writer.close().expect("close");
    let database = Connection::open(&path).expect("independent location projection");
    let (first, last): (i64, i64) = database
        .query_row(
            "SELECT MIN(location_sequence), MAX(location_sequence) FROM location",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("location sequence bounds");
    let location_actual = vec![
        projection(
            "location",
            "count",
            scalar(&database, "SELECT COUNT(*) FROM location"),
        ),
        projection("location", "first_sequence", first),
        projection("location", "last_sequence", last),
        projection(
            "commit_marker",
            "committed_location_sequence",
            location_marker.committed_location_sequence,
        ),
        projection(
            "commit_marker",
            "committed_location_elapsed_ms",
            location_marker.committed_location_elapsed_ms,
        ),
        projection(
            "commit_marker",
            "recorded_location_count",
            location_marker.recorded_location_count,
        ),
        projection(
            "commit_marker",
            "stored_location_count",
            location_marker.stored_location_count,
        ),
        format!(
            "commit_marker\tlast_location_status\t{}",
            location_marker.last_location_status
        ),
    ];
    assert_eq!(location_actual, fixture_data_lines(LOCATION_EXPECTED));
}

fn parse_sample_fixture() -> Vec<float_view_refloat_telemetry_service::NormalizedSample> {
    fixture_data_lines(SAMPLE_FIXTURE)
        .into_iter()
        .map(|line| {
            let fields = line.split('\t').collect::<Vec<_>>();
            assert_eq!(fields.len(), 9);
            let mut value = sample(
                fields[0].parse().expect("sequence"),
                fields[2].parse().expect("elapsed"),
            );
            value.observed_at_epoch_ms = fields[1].parse().expect("observed");
            value.ride_state = match fields[3] {
                "idle" => RideState::Idle,
                "riding" => RideState::Riding,
                _ => panic!("unexpected ride fixture"),
            };
            value.package_state = Some(match fields[4] {
                "ready" => PackageState::Ready,
                "running" => PackageState::Running,
                _ => panic!("unexpected package fixture"),
            });
            value.speed_kph = parse_optional(fields[5]);
            value.duty_cycle = parse_optional(fields[6]);
            if fields[7] != "-" {
                value.extensions.push(ExtensionValue {
                    name: fields[7].to_owned(),
                    value: fields[8].parse().expect("extension value"),
                });
            } else {
                assert_eq!(fields[8], "-");
            }
            value
        })
        .collect()
}

fn parse_location_fixture() -> Vec<LocationObservation> {
    fixture_data_lines(LOCATION_FIXTURE)
        .into_iter()
        .map(|line| {
            let fields = line.split('\t').collect::<Vec<_>>();
            assert_eq!(fields.len(), 5);
            LocationObservation {
                observed_at_epoch_ms: fields[0].parse().expect("observed"),
                elapsed_ms: fields[1].parse().expect("elapsed"),
                latitude: fields[2].parse().expect("latitude"),
                longitude: fields[3].parse().expect("longitude"),
                accuracy_m: parse_optional(fields[4]),
                altitude_m: None,
            }
        })
        .collect()
}

fn parse_optional(value: &str) -> Option<f64> {
    (value != "-").then(|| value.parse().expect("optional number"))
}

fn fixture_data_lines(value: &str) -> Vec<String> {
    value
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_owned)
        .collect()
}

fn projection(table: &str, key: &str, value: impl std::fmt::Display) -> String {
    format!("{table}\t{key}\t{value}")
}

fn location(
    elapsed_ms: u64,
    latitude: f64,
    longitude: f64,
    accuracy_m: Option<f64>,
) -> LocationObservation {
    LocationObservation {
        observed_at_epoch_ms: 1_000_000 + elapsed_ms as i64,
        elapsed_ms,
        latitude,
        longitude,
        accuracy_m,
        altitude_m: None,
    }
}

fn scalar(database: &Connection, sql: &str) -> i64 {
    database
        .query_row(sql, [], |row| row.get(0))
        .expect("scalar")
}

#[test]
fn explicit_recording_boundary_excludes_offline_time_and_distance_after_reopen() {
    use float_view_session_history_kernel::GapPolicy;
    use float_view_session_sqlite::{PublishedBoundary, SessionReader};
    let directory = TestDirectory::new();
    let path = directory.file("ride.sqlite");
    let mut writer = SessionWriter::create(&path, metadata()).unwrap();
    let moving = |sequence, elapsed| {
        let mut s = sample(sequence, elapsed);
        s.ride_state = RideState::Riding;
        s.speed_kph = Some(36.);
        s
    };
    writer
        .append_samples(&[moving(1, 0), moving(2, 1000)])
        .unwrap();
    writer.mark_recording_gap();
    let marker = writer
        .append_samples(&[moving(3, 3_601_000), moving(4, 3_602_000)])
        .unwrap();
    assert_eq!(marker.riding_elapsed_ms, 2000);
    assert_eq!(marker.distance_m, Some(20.));
    writer.close().unwrap();
    let mut reader = SessionReader::open(&path).unwrap();
    let series = reader
        .reduce_series(
            &["speedKph".into()],
            0,
            3_602_000,
            100,
            GapPolicy::ExplicitMilliseconds(3_600_000),
            PublishedBoundary::from(&marker),
        )
        .unwrap();
    assert_eq!(series.columns[0].generations.first(), Some(&0));
    assert_eq!(series.columns[0].generations.last(), Some(&1));
    drop(reader);
    // Force the existing out-of-order recomputation path to agree with incremental summaries.
    let mut writer = SessionWriter::open(&path).unwrap();
    let recomputed = writer.append_samples(&[moving(5, 500)]).unwrap();
    assert_eq!(recomputed.riding_elapsed_ms, 2000);
    assert_eq!(recomputed.distance_m, Some(20.));
}

#[test]
fn short_recording_gap_survives_gps_pagination_and_pruning() {
    use float_view_session_history_kernel::GapPolicy;
    use float_view_session_sqlite::{PublishedBoundary, SessionPruner, SessionReader};
    let directory = TestDirectory::new();
    let path = directory.file("short-gap.sqlite");
    let mut writer = SessionWriter::create(&path, metadata()).unwrap();
    let sample = |seq, elapsed| {
        let mut s = sample(seq, elapsed);
        s.speed_kph = Some(36.);
        s
    };
    writer
        .append_samples(&[sample(1, 0), sample(2, 1000)])
        .unwrap();
    writer.mark_recording_gap();
    writer
        .append_samples(&[sample(3, 1100), sample(4, 2000)])
        .unwrap();
    let marker = writer
        .append_locations(&[
            LocationObservation {
                observed_at_epoch_ms: 1_001_000,
                elapsed_ms: 1000,
                latitude: 1.,
                longitude: 1.,
                accuracy_m: None,
                altitude_m: None,
            },
            LocationObservation {
                observed_at_epoch_ms: 1_001_100,
                elapsed_ms: 1100,
                latitude: 1.001,
                longitude: 1.001,
                accuracy_m: None,
                altitude_m: None,
            },
        ])
        .unwrap();
    writer.close().unwrap();
    let mut reader = SessionReader::open(&path).unwrap();
    let page = reader
        .location_page(0, 2000, 1, None, PublishedBoundary::from(&marker))
        .unwrap();
    let next = reader
        .location_page(
            0,
            2000,
            1,
            page.next_location_sequence,
            PublishedBoundary::from(&marker),
        )
        .unwrap();
    assert_eq!(next.gaps.len(), 1);
    assert_eq!(next.gaps[0].start_elapsed_ms, 1000);
    assert_eq!(next.gaps[0].end_elapsed_ms, 1100);
    drop(reader);
    let mut pruner = SessionPruner::open(&path).unwrap();
    let plan = pruner.preview(10).unwrap();
    pruner.commit(plan, 1_002_001).unwrap();
    drop(pruner);
    let db = Connection::open(&path).unwrap();
    for seq in [2, 3] {
        assert!(
            db.query_row(
                "SELECT EXISTS(SELECT 1 FROM sample WHERE sequence=?)",
                [seq],
                |r| r.get::<_, bool>(0)
            )
            .unwrap()
        );
    }
    drop(db);
    let mut reader = SessionReader::open(&path).unwrap();
    let marker = reader.marker().unwrap();
    let series = reader
        .reduce_series(
            &["speedKph".into()],
            0,
            2000,
            10,
            GapPolicy::ExplicitMilliseconds(3_600_000),
            PublishedBoundary::from(&marker),
        )
        .unwrap();
    assert!(series.columns[0].generations.last() > series.columns[0].generations.first());
}
