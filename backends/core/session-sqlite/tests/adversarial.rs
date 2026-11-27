mod support;

use float_view_refloat_telemetry_service::ExtensionValue;
use float_view_session_sqlite::{
    LocationObservation, MAX_EXTENSION_NAME_BYTES, MAX_EXTENSIONS, MAX_LOCATION_BATCH,
    MAX_SAMPLE_BATCH, SessionMetadata, SessionWriter, WriterError,
};
use rusqlite::Connection;
use support::{TestDirectory, sample};

fn create(directory: &TestDirectory, name: &str) -> (std::path::PathBuf, SessionWriter) {
    let path = directory.file(name);
    let writer = SessionWriter::create(
        &path,
        SessionMetadata {
            expected_riding_persistence_ms: 100,
            expected_idle_persistence_ms: 1_000,
            committed_at_epoch_ms: 1,
        },
    )
    .expect("create writer");
    (path, writer)
}

#[test]
fn rejects_every_sample_boundary_before_mutation() {
    let directory = TestDirectory::new();
    let (_, mut writer) = create(&directory, "sample-bounds.sqlite3");
    assert_invalid_sample(&mut writer, Vec::new());
    assert_invalid_sample(
        &mut writer,
        (0..=MAX_SAMPLE_BATCH)
            .map(|index| sample(index as u64 + 1, index as u64))
            .collect(),
    );
    assert_invalid_sample(&mut writer, vec![sample(i64::MAX as u64 + 1, 0)]);

    let mut negative_time = sample(1, 0);
    negative_time.observed_at_epoch_ms = -1;
    assert_invalid_sample(&mut writer, vec![negative_time]);
    let mut unordered = vec![sample(1, 10), sample(2, 10)];
    unordered[1].sequence = 1;
    assert_invalid_sample(&mut writer, unordered);
    let mut nan = sample(1, 0);
    nan.speed_kph = Some(f64::NAN);
    assert_invalid_sample(&mut writer, vec![nan]);
    let mut duplicate_extension = sample(1, 0);
    duplicate_extension.extensions = vec![extension("same", 1.0), extension("same", 2.0)];
    assert_invalid_sample(&mut writer, vec![duplicate_extension]);
    let mut long_extension = sample(1, 0);
    long_extension.extensions = vec![extension(&"x".repeat(MAX_EXTENSION_NAME_BYTES + 1), 1.0)];
    assert_invalid_sample(&mut writer, vec![long_extension]);
    let mut too_many_extensions = sample(1, 0);
    too_many_extensions.extensions = (0..=MAX_EXTENSIONS)
        .map(|index| extension(&format!("field{index}"), index as f64))
        .collect();
    assert_invalid_sample(&mut writer, vec![too_many_extensions]);
    assert_eq!(writer.marker().expect("marker").stored_sample_count, 0);
}

#[test]
fn rejects_every_location_boundary_before_mutation() {
    let directory = TestDirectory::new();
    let (_, mut writer) = create(&directory, "location-bounds.sqlite3");
    assert_invalid_location(&mut writer, Vec::new());
    assert_invalid_location(
        &mut writer,
        (0..=MAX_LOCATION_BATCH)
            .map(|index| location(index as u64, 0.0, 0.0, None))
            .collect(),
    );
    assert_invalid_location(
        &mut writer,
        vec![location(i64::MAX as u64 + 1, 0.0, 0.0, None)],
    );
    for invalid in [
        location(0, f64::NAN, 0.0, None),
        location(0, -90.000_1, 0.0, None),
        location(0, 0.0, 180.000_1, None),
        location(0, 0.0, 0.0, Some(-0.1)),
        location(0, 0.0, 0.0, Some(f64::INFINITY)),
    ] {
        assert_invalid_location(&mut writer, vec![invalid]);
    }
    let mut negative_time = location(0, 0.0, 0.0, None);
    negative_time.observed_at_epoch_ms = -1;
    assert_invalid_location(&mut writer, vec![negative_time]);
    assert_eq!(writer.marker().expect("marker").stored_location_count, 0);
}

#[test]
fn accepts_the_declared_maximum_batches() {
    let directory = TestDirectory::new();
    let (_, mut writer) = create(&directory, "maximum.sqlite3");
    let samples = (0..MAX_SAMPLE_BATCH)
        .map(|index| sample(index as u64 + 1, index as u64))
        .collect::<Vec<_>>();
    let marker = writer
        .append_samples(&samples)
        .expect("maximum sample batch");
    assert_eq!(marker.stored_sample_count, MAX_SAMPLE_BATCH as u64);
    let locations = (0..MAX_LOCATION_BATCH)
        .map(|index| location(index as u64, -80.0 + index as f64 / 10_000.0, 10.0, None))
        .collect::<Vec<_>>();
    let marker = writer
        .append_locations(&locations)
        .expect("maximum location batch");
    assert_eq!(marker.stored_location_count, MAX_LOCATION_BATCH as u64);
}

#[test]
fn locked_transaction_is_bounded_and_preserves_state() {
    let directory = TestDirectory::new();
    let (path, mut writer) = create(&directory, "busy.sqlite3");
    let locker = Connection::open(&path).expect("open locker");
    locker
        .execute_batch("BEGIN IMMEDIATE;")
        .expect("hold write lock");
    assert_eq!(
        writer
            .append_samples(&[sample(1, 0)])
            .expect_err("busy writer"),
        WriterError::Busy
    );
    locker.execute_batch("ROLLBACK;").expect("release lock");
    assert_eq!(
        writer
            .marker()
            .expect("unchanged marker")
            .stored_sample_count,
        0
    );
}

#[test]
fn mid_sample_failure_rolls_back_rows_fields_events_and_marker() {
    let directory = TestDirectory::new();
    let (path, mut writer) = create(&directory, "sample-rollback.sqlite3");
    let first = sample(1, 0);
    let before = writer.append_samples(&[first]).expect("seed sample");
    Connection::open(&path)
        .expect("open trigger connection")
        .execute_batch(
            "CREATE TRIGGER reject_third_sample BEFORE INSERT ON sample WHEN NEW.sequence = 3 BEGIN SELECT RAISE(ABORT, 'injected'); END;",
        )
        .expect("install trigger");
    let mut second = sample(2, 1_000);
    second.speed_kph = Some(1.0);
    let mut third = sample(3, 2_000);
    third.speed_kph = Some(2.0);
    assert_eq!(
        writer
            .append_samples(&[second, third])
            .expect_err("injected failure"),
        WriterError::Database
    );
    assert_eq!(writer.marker().expect("marker after rollback"), before);
    let database = Connection::open(&path).expect("independent database connection");
    assert_eq!(scalar(&database, "SELECT COUNT(*) FROM sample"), 1);
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM session_numeric_field"),
        0
    );
    assert_eq!(scalar(&database, "SELECT COUNT(*) FROM session_event"), 2);
}

#[test]
fn mid_location_failure_rolls_back_rows_and_marker() {
    let directory = TestDirectory::new();
    let (path, mut writer) = create(&directory, "location-rollback.sqlite3");
    let before = writer
        .append_locations(&[location(100, 1.0, 1.0, None)])
        .expect("seed location");
    Connection::open(&path)
        .expect("open trigger connection")
        .execute_batch(
            "CREATE TRIGGER reject_third_location BEFORE INSERT ON location WHEN NEW.location_sequence = 3 BEGIN SELECT RAISE(ABORT, 'injected'); END;",
        )
        .expect("install trigger");
    assert_eq!(
        writer
            .append_locations(&[location(200, 2.0, 2.0, None), location(300, 3.0, 3.0, None),])
            .expect_err("injected failure"),
        WriterError::Database
    );
    assert_eq!(writer.marker().expect("marker after rollback"), before);
    let database = Connection::open(&path).expect("independent database connection");
    assert_eq!(scalar(&database, "SELECT COUNT(*) FROM location"), 1);
}

fn assert_invalid_sample(
    writer: &mut SessionWriter,
    values: Vec<float_view_refloat_telemetry_service::NormalizedSample>,
) {
    assert_eq!(
        writer
            .append_samples(&values)
            .expect_err("invalid sample batch"),
        WriterError::InvalidInput
    );
}

fn assert_invalid_location(writer: &mut SessionWriter, values: Vec<LocationObservation>) {
    assert_eq!(
        writer
            .append_locations(&values)
            .expect_err("invalid location batch"),
        WriterError::InvalidInput
    );
}

fn extension(name: &str, value: f64) -> ExtensionValue {
    ExtensionValue {
        name: name.to_owned(),
        value,
    }
}

fn location(
    elapsed_ms: u64,
    latitude: f64,
    longitude: f64,
    accuracy_m: Option<f64>,
) -> LocationObservation {
    LocationObservation {
        observed_at_epoch_ms: 1_000_000 + i64::try_from(elapsed_ms).unwrap_or(0),
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
