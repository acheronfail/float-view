//! Opt-in on-disk stress test exercising the production writer and readers.
mod support;
use float_view_refloat_telemetry_service::{ExtensionValue, PackageState, RideState};
use float_view_session_history_kernel::GapPolicy;
use float_view_session_sqlite::{
    DiagnosticWriter, LocationObservation, MAX_PRUNE_SOURCE_ROWS, PublishedBoundary, ReaderError,
    SampleKey, SessionMetadata, SessionPruner, SessionReader, SessionWriter,
};
use std::time::Instant;
use support::{TestDirectory, sample};

#[test]
#[ignore = "on-disk SQLite scale benchmark"]
fn telemetry_scale() {
    let dir = TestDirectory::new();
    let path = dir.file("scale.sqlite");
    let mut writer = SessionWriter::create(
        &path,
        SessionMetadata {
            expected_riding_persistence_ms: 100,
            expected_idle_persistence_ms: 1000,
            committed_at_epoch_ms: 0,
        },
    )
    .unwrap();
    let sizes = std::env::var("FLOAT_VIEW_SAMPLE_SIZES").unwrap_or("1000,10000,199999".into());
    let batch_size = std::env::var("FLOAT_VIEW_BATCH_SIZE")
        .unwrap_or("100".into())
        .parse::<usize>()
        .unwrap();
    assert!((1..=1024).contains(&batch_size));
    let mut previous = 0_u64;
    for size in sizes.split(',').map(|n| n.parse::<u64>().unwrap()) {
        assert!(size > previous && size >= 102);
        let mut latencies = Vec::new();
        let begin = Instant::now();
        for first in (previous + 1..=size).step_by(batch_size) {
            let batch = (first..=(first + batch_size as u64 - 1).min(size))
                .map(|n| {
                    let mut s = sample(n, n * 100);
                    s.ride_state = RideState::Riding;
                    s.package_state = Some(if n % 1000 < 500 {
                        PackageState::Running
                    } else {
                        PackageState::Ready
                    });
                    s.speed_kph = Some((n % 50) as f64);
                    s.pack_voltage_v = Some(80. - (n % 100) as f64 / 100.);
                    s.duty_cycle = Some(0.4);
                    s.motor_current_a = Some(10.);
                    s.battery_current_a = Some(4.);
                    s.pitch_deg = Some(1.);
                    s.roll_deg = Some(2.);
                    s.controller_temp_c = Some(40.);
                    s.motor_temp_c = Some(45.);
                    s.extensions.push(ExtensionValue {
                        name: "testNumeric".into(),
                        value: (n % 31) as f64,
                    });
                    s
                })
                .collect::<Vec<_>>();
            let start = Instant::now();
            writer.append_samples(&batch).unwrap();
            latencies.push(start.elapsed().as_secs_f64() * 1000.);
        }
        let write_ms = begin.elapsed().as_secs_f64() * 1000.;
        latencies.sort_by(f64::total_cmp);
        println!(
            "samples={size} write_ms={write_ms:.2} rows_per_s={:.0} batch_p50_ms={:.2} batch_p95_ms={:.2} batch_max_ms={:.2}",
            (size - previous) as f64 / (write_ms / 1000.),
            latencies[latencies.len() / 2],
            latencies[latencies.len() * 95 / 100],
            latencies.last().unwrap()
        );
        let locations = ((previous / 100 + 1)..=size / 100)
            .map(|n| LocationObservation {
                observed_at_epoch_ms: (n * 10000) as i64,
                elapsed_ms: n * 10000,
                latitude: -34.9,
                longitude: 138.6,
                accuracy_m: Some(3.),
                altitude_m: None,
            })
            .collect::<Vec<_>>();
        let start = Instant::now();
        for batch in locations.chunks(100) {
            writer.append_locations(batch).unwrap();
        }
        println!(
            "samples={size} location_write_ms={:.2}",
            start.elapsed().as_secs_f64() * 1000.
        );
        let boundary = PublishedBoundary::from(&writer.marker().unwrap());
        assert_eq!(writer.marker().unwrap().stored_sample_count, size);
        let start = Instant::now();
        let mut reader = SessionReader::open(&path).unwrap();
        println!(
            "samples={size} reader_open_ms={:.2}",
            start.elapsed().as_secs_f64() * 1000.
        );
        let start = Instant::now();
        let page = reader
            .sample_page(
                &["speedKph".into(), "testNumeric".into()],
                0,
                size * 100,
                100,
                Some(SampleKey {
                    elapsed_ms: (size - 101) * 100,
                    sequence: size - 101,
                }),
                boundary,
            )
            .unwrap();
        assert_eq!(page.rows.len(), 100);
        assert_eq!(page.rows[0].key.sequence, size - 100);
        println!(
            "samples={size} deep_sample_page_ms={:.2}",
            start.elapsed().as_secs_f64() * 1000.
        );
        let start = Instant::now();
        let series_start = size.saturating_sub(199999) * 100;
        let series = reader.reduce_series(
            &["speedKph".into()],
            series_start,
            size * 100,
            1024,
            GapPolicy::Automatic,
            boundary,
        );
        println!(
            "samples={size} series_ms={:.2} success={}",
            start.elapsed().as_secs_f64() * 1000.,
            series.is_ok()
        );
        assert_eq!(series.unwrap().source_rows as u64, size.min(200000));
        let start = Instant::now();
        let mut event_count = 0;
        let mut after = None;
        loop {
            let page = reader
                .event_page(0, size * 100, 100, after, boundary)
                .unwrap();
            event_count += page.rows.len();
            after = page.next;
            if after.is_none() {
                break;
            }
        }
        assert_eq!(
            event_count as u64,
            writer.marker().unwrap().committed_event_count
        );
        println!(
            "samples={size} event_traverse_ms={:.2}",
            start.elapsed().as_secs_f64() * 1000.
        );
        let start = Instant::now();
        let locations = reader
            .location_page(
                size.saturating_sub(10000) * 100,
                size * 100,
                100,
                None,
                boundary,
            )
            .unwrap();
        assert!(!locations.rows.is_empty());
        println!(
            "samples={size} location_page_ms={:.2}",
            start.elapsed().as_secs_f64() * 1000.
        );
        // A live WAL reader keeps the old published boundary while recording continues.
        let mut extra = sample(size + 1, (size + 1) * 100);
        extra.speed_kph = Some(5.);
        writer.append_samples(&[extra]).unwrap();
        let page = reader
            .sample_page(
                &["speedKph".into()],
                size * 100,
                (size + 1) * 100,
                100,
                None,
                boundary,
            )
            .unwrap();
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0].key.sequence, size);
        previous = size + 1;
    }
    writer.close().unwrap();
    let start = Instant::now();
    let mut diagnostics = DiagnosticWriter::open(&path).unwrap();
    for n in 0..160 {
        diagnostics
            .append(
                &(0..32)
                    .map(|i| format!("{{\"number\":{}}}", n * 32 + i))
                    .collect::<Vec<_>>(),
            )
            .unwrap();
    }
    println!(
        "diagnostics_5120_ms={:.2}",
        start.elapsed().as_secs_f64() * 1000.
    );
    drop(diagnostics);
    if previous <= MAX_PRUNE_SOURCE_ROWS as u64 {
        let mut pruner = SessionPruner::open(&path).unwrap();
        let start = Instant::now();
        let plan = pruner.preview(10).unwrap();
        println!(
            "prune_preview_ms={:.2}",
            start.elapsed().as_secs_f64() * 1000.
        );
        let start = Instant::now();
        let result = pruner.commit(plan, 30000000).unwrap();
        assert!(result.preview.retained_sample_count < previous);
        println!(
            "prune_commit_ms={:.2} retained={}",
            start.elapsed().as_secs_f64() * 1000.,
            result.preview.retained_sample_count
        );
    } else {
        let mut reader = SessionReader::open(&path).unwrap();
        let boundary = PublishedBoundary::from(&reader.marker().unwrap());
        assert_eq!(
            reader.reduce_series(
                &["speedKph".into()],
                0,
                previous * 100,
                1024,
                GapPolicy::Automatic,
                boundary
            ),
            Err(ReaderError::InvalidInput)
        );
    }
}

#[test]
#[ignore = "on-disk SQLite scale benchmark"]
fn gps_pagination_scale() {
    use rusqlite::Connection;
    let dir = TestDirectory::new();
    let path = dir.file("gps.sqlite");
    SessionWriter::create(
        &path,
        SessionMetadata {
            expected_riding_persistence_ms: 100,
            expected_idle_persistence_ms: 1000,
            committed_at_epoch_ms: 0,
        },
    )
    .unwrap()
    .close()
    .unwrap();
    let size = std::env::var("FLOAT_VIEW_GPS_ROWS")
        .unwrap_or("100000".into())
        .parse::<u64>()
        .unwrap();
    assert!(size >= 1000);
    let mut db = Connection::open(&path).unwrap();
    let tx = db.transaction().unwrap();
    {
        let mut insert=tx.prepare("INSERT INTO location(location_sequence,observed_at_ms,monotonic_elapsed_ms,latitude,longitude,accuracy_m) VALUES (?1,?2,?2,-34.9,?3,3)").unwrap();
        for n in 1..=size {
            insert
                .execute(rusqlite::params![
                    n,
                    (n / 3) * 1000 + (n / 1000) * 20000,
                    138.6 + (n % 3) as f64 * 0.000001
                ])
                .unwrap();
        }
    }
    let end = (size / 3) * 1000 + (size / 1000) * 20000;
    tx.execute("UPDATE commit_marker SET committed_location_sequence=?1,committed_location_elapsed_ms=?2,recorded_location_count=?1,stored_location_count=?1,last_location_status='available'",rusqlite::params![size,end]).unwrap();
    tx.commit().unwrap();
    let mut reader = SessionReader::open(&path).unwrap();
    let boundary = PublishedBoundary::from(&reader.marker().unwrap());
    for after in [None, Some(size / 2), Some(size - 101)] {
        let start = Instant::now();
        let page = reader.location_page(0, end, 100, after, boundary).unwrap();
        assert_eq!(page.rows.len(), 100);
        assert_eq!(page.rows[0].location_sequence, after.unwrap_or(0) + 1);
        println!(
            "gps_rows={size} after={after:?} page_ms={:.2}",
            start.elapsed().as_secs_f64() * 1000.
        );
    }
    let start = Instant::now();
    let mut after = None;
    let mut count = 0;
    loop {
        let page = reader.location_page(0, end, 1000, after, boundary).unwrap();
        for row in &page.rows {
            count += 1;
            assert_eq!(row.location_sequence, count);
        }
        after = page.next_location_sequence;
        if after.is_none() {
            break;
        }
    }
    assert_eq!(count, size);
    println!(
        "gps_rows={size} traverse_ms={:.2}",
        start.elapsed().as_secs_f64() * 1000.
    );
}
