use rusqlite::OptionalExtension;
use std::collections::BTreeSet;
use std::fmt::{self, Debug, Display, Formatter};
use std::path::Path;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

use float_view_session_history_kernel::{
    GapPolicy, PersistenceCadence, RidePhase, SeriesAccumulator, SeriesColumn, SeriesConfig,
    SeriesObservation,
};
use rusqlite::ffi::ErrorCode;
use rusqlite::types::Value;
use rusqlite::{Connection, OpenFlags, Transaction, TransactionBehavior, params_from_iter};

use super::{
    CommitMarker, MAX_EXTENSION_NAME_BYTES, MAX_EXTENSIONS, MAX_PERSISTENCE_CADENCE_MS,
    WriterError, has_location_altitude, read_marker, validate_database,
};

pub const MAX_QUERY_FIELDS: usize = 16;
pub const MAX_SAMPLE_PAGE: usize = 2_000;
pub const MAX_EVENT_PAGE: usize = 500;
pub const MAX_LOCATION_PAGE: usize = 2_000;
pub const MAX_SERIES_BUCKETS: usize = 1_024;
pub const MAX_SERIES_SOURCE_ROWS: usize = 200_000;
pub const MAX_RECORDING_BREAKS: usize = 1_000;
const LOCATION_GAP_MS: u64 = 10_000;

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordingBreak {
    pub start_elapsed_ms: u64,
    pub end_elapsed_ms: u64,
    pub reason: crate::InterruptionReason,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum ReaderError {
    InvalidInput,
    NotFound,
    Incompatible,
    Corrupt,
    Busy,
    Cancelled,
    Io,
    Database,
}

impl Debug for ReaderError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidInput => "InvalidInput",
            Self::NotFound => "NotFound",
            Self::Incompatible => "Incompatible",
            Self::Corrupt => "Corrupt",
            Self::Busy => "Busy",
            Self::Cancelled => "Cancelled",
            Self::Io => "Io",
            Self::Database => "Database",
        })
    }
}

impl Display for ReaderError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        Debug::fmt(self, formatter)
    }
}

impl std::error::Error for ReaderError {}

#[derive(Clone, Eq, PartialEq)]
pub struct ReaderMetadata {
    pub expected_riding_persistence_ms: u64,
    pub expected_idle_persistence_ms: u64,
    pub pruned_at_epoch_ms: Option<i64>,
    pub retained_resolution_seconds: u64,
    pub prune_policy: Option<String>,
}

impl Debug for ReaderMetadata {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str("ReaderMetadata([redacted])")
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FieldSource {
    Stable,
    Extension,
}

#[derive(Clone, Eq, PartialEq)]
pub struct FieldDescriptor {
    pub name: String,
    pub source: FieldSource,
    pub first_sequence: u64,
}

impl Debug for FieldDescriptor {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("FieldDescriptor")
            .field("source", &self.source)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PublishedBoundary {
    pub history_revision: u64,
    pub sample_sequence: u64,
    pub event_sequence: u64,
    pub location_sequence: u64,
}

impl From<&CommitMarker> for PublishedBoundary {
    fn from(marker: &CommitMarker) -> Self {
        Self {
            history_revision: marker.history_revision,
            sample_sequence: marker.committed_sample_sequence,
            event_sequence: marker.committed_event_sequence,
            location_sequence: marker.committed_location_sequence,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct SampleKey {
    pub elapsed_ms: u64,
    pub sequence: u64,
}

#[derive(Clone, PartialEq)]
pub struct SampleRecord {
    pub key: SampleKey,
    pub ride_state: String,
    pub values: Vec<Option<f64>>,
}

impl Debug for SampleRecord {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SampleRecord")
            .field("value_count", &self.values.len())
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SamplePage {
    pub rows: Vec<SampleRecord>,
    pub next: Option<SampleKey>,
}

#[derive(Clone, PartialEq)]
pub struct EventRecord {
    pub key: SampleKey,
    pub kind: String,
    pub details_json: String,
    pub source_sample_sequence: Option<u64>,
}

impl Debug for EventRecord {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str("EventRecord([redacted])")
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct EventPage {
    pub rows: Vec<EventRecord>,
    pub next: Option<SampleKey>,
}

#[derive(Clone, PartialEq)]
pub struct LocationRecord {
    pub location_sequence: u64,
    pub elapsed_ms: u64,
    pub observed_at_epoch_ms: i64,
    pub latitude: f64,
    pub longitude: f64,
    pub accuracy_m: Option<f64>,
    pub altitude_m: Option<f64>,
}

impl Debug for LocationRecord {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str("LocationRecord([redacted])")
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LocationGap {
    pub start_elapsed_ms: u64,
    pub end_elapsed_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LocationPage {
    pub rows: Vec<LocationRecord>,
    pub gaps: Vec<LocationGap>,
    pub published_location_sequence: u64,
    pub next_location_sequence: Option<u64>,
}

#[derive(Clone, PartialEq)]
pub struct SeriesReduction {
    pub columns: Vec<SeriesColumn>,
    pub source_rows: usize,
}

impl Debug for SeriesReduction {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SeriesReduction")
            .field("column_count", &self.columns.len())
            .field("source_rows", &self.source_rows)
            .finish()
    }
}

#[derive(Clone)]
pub struct ReadInterrupter(Arc<rusqlite::InterruptHandle>);

impl Debug for ReadInterrupter {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str("ReadInterrupter([redacted])")
    }
}

impl ReadInterrupter {
    pub fn interrupt(&self) {
        self.0.interrupt();
    }
}

pub struct SessionReader {
    connection: Connection,
    interrupter: ReadInterrupter,
}

impl Debug for SessionReader {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str("SessionReader([redacted])")
    }
}

impl SessionReader {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, ReaderError> {
        Self::open_cancellable(path, Arc::new(AtomicBool::new(false)))
    }

    /// Read-only lease with cancellation active during validation and SQL work.
    pub fn open_cancellable(
        path: impl AsRef<Path>,
        cancelled: Arc<AtomicBool>,
    ) -> Result<Self, ReaderError> {
        if cancelled.load(Ordering::Acquire) {
            return Err(ReaderError::Cancelled);
        }
        let path = path.as_ref();
        if !path.is_file() {
            return Err(ReaderError::NotFound);
        }
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(map_open)?;
        connection
            .busy_timeout(Duration::from_millis(250))
            .map_err(map_sqlite)?;
        connection.progress_handler(1000, Some(move || cancelled.load(Ordering::Acquire)));
        validate_database(&connection).map_err(map_writer)?;
        validate_reader_state(&connection)?;
        let interrupter = ReadInterrupter(Arc::new(connection.get_interrupt_handle()));
        Ok(Self {
            connection,
            interrupter,
        })
    }

    pub fn interrupter(&self) -> ReadInterrupter {
        self.interrupter.clone()
    }

    pub fn close(self) -> Result<(), ReaderError> {
        self.connection
            .close()
            .map_err(|(_, error)| map_sqlite(error))
    }

    pub fn metadata(&mut self) -> Result<ReaderMetadata, ReaderError> {
        let transaction = self.deferred()?;
        let value = read_metadata(&transaction)?;
        transaction.commit().map_err(map_sqlite)?;
        Ok(value)
    }

    pub fn marker(&mut self) -> Result<CommitMarker, ReaderError> {
        let transaction = self.deferred()?;
        let value = read_marker(&transaction).map_err(map_writer)?;
        transaction.commit().map_err(map_sqlite)?;
        Ok(value)
    }

    /// Exact interruption endpoints, independent of reduced series and field nulls.
    pub fn recording_breaks(
        &mut self,
        boundary: PublishedBoundary,
    ) -> Result<Vec<RecordingBreak>, ReaderError> {
        let tx = self.deferred()?;
        validate_boundary(&tx, boundary)?;
        let mut statement = tx
            .prepare(
                "SELECT e.monotonic_elapsed_ms, e.source_sample_sequence,
                    CASE WHEN length(CAST(e.details_json AS BLOB))<=256 THEN e.details_json ELSE '' END,
                    p.sequence, p.monotonic_elapsed_ms, n.monotonic_elapsed_ms
             FROM session_event e
             LEFT JOIN sample p ON p.sequence=json_extract(e.details_json,'$.previousSequence')
             LEFT JOIN sample n ON n.sequence=e.source_sample_sequence
             WHERE e.kind='recordingBoundary' AND e.sequence<=?
             ORDER BY e.sequence LIMIT 1001",
            )
            .map_err(map_sqlite)?;
        let mut rows = statement
            .query([to_i64(boundary.event_sequence)?])
            .map_err(map_sqlite)?;
        let mut breaks: Vec<RecordingBreak> = Vec::new();
        let mut count = 0;
        while let Some(row) = rows.next().map_err(map_sqlite)? {
            count += 1;
            if count > MAX_RECORDING_BREAKS {
                return Err(ReaderError::Incompatible);
            }
            let end: u64 = row.get(0).map_err(map_sqlite)?;
            let source: Option<u64> = row.get(1).map_err(map_sqlite)?;
            let details: String = row.get(2).map_err(map_sqlite)?;
            let details: serde_json::Value =
                serde_json::from_str(&details).map_err(|_| ReaderError::Incompatible)?;
            let reason = match details.get("reason") {
                None => crate::InterruptionReason::Unknown,
                Some(value) => {
                    serde_json::from_value(value.clone()).map_err(|_| ReaderError::Incompatible)?
                }
            };
            let previous: Option<u64> = row.get(3).map_err(map_sqlite)?;
            let start: Option<u64> = row.get(4).map_err(map_sqlite)?;
            let resumed: Option<u64> = row.get(5).map_err(map_sqlite)?;
            let (Some(start), Some(previous), Some(source)) = (start, previous, source) else {
                return Err(ReaderError::Incompatible);
            };
            if details["value"] != "resumed"
                || details["previousSequence"].as_u64() != Some(previous)
                || previous >= source
                || source > boundary.sample_sequence
                || resumed != Some(end)
                || start > end
                || end > 9_007_199_254_740_991
                || breaks.last().is_some_and(|b| start < b.end_elapsed_ms)
            {
                return Err(ReaderError::Incompatible);
            }
            if end > start {
                breaks.push(RecordingBreak {
                    start_elapsed_ms: start,
                    end_elapsed_ms: end,
                    reason,
                });
            }
        }
        drop(rows);
        drop(statement);
        tx.commit().map_err(map_sqlite)?;
        Ok(breaks)
    }

    pub fn connection_contexts(
        &mut self,
        boundary: PublishedBoundary,
    ) -> Result<Vec<super::ConnectionContextEvent>, ReaderError> {
        let tx = self.deferred()?;
        validate_boundary(&tx, boundary)?;
        let rows = super::connection_context::read_contexts(&tx, boundary.event_sequence)
            .map_err(map_writer)?;
        tx.commit().map_err(map_sqlite)?;
        Ok(rows)
    }

    pub fn ride_markers(
        &mut self,
        boundary: PublishedBoundary,
    ) -> Result<Vec<super::RideMarker>, ReaderError> {
        let tx = self.deferred()?;
        validate_boundary(&tx, boundary)?;
        let markers =
            super::markers::read_markers(&tx, boundary.event_sequence).map_err(map_writer)?;
        tx.commit().map_err(map_sqlite)?;
        Ok(markers)
    }

    pub fn fields(&mut self) -> Result<Vec<FieldDescriptor>, ReaderError> {
        let transaction = self.deferred()?;
        let value = read_fields(&transaction)?;
        transaction.commit().map_err(map_sqlite)?;
        Ok(value)
    }

    pub fn sample_page(
        &mut self,
        fields: &[String],
        start_elapsed_ms: u64,
        end_elapsed_ms: u64,
        limit: usize,
        after: Option<SampleKey>,
        boundary: PublishedBoundary,
    ) -> Result<SamplePage, ReaderError> {
        validate_range(start_elapsed_ms, end_elapsed_ms)?;
        if !(1..=MAX_SAMPLE_PAGE).contains(&limit) {
            return Err(ReaderError::InvalidInput);
        }
        if after.is_some_and(|key| key.elapsed_ms > end_elapsed_ms) {
            return Err(ReaderError::InvalidInput);
        }
        let transaction = self.deferred()?;
        validate_boundary(&transaction, boundary)?;
        let resolved = resolve_fields(&transaction, fields)?;
        let rows = query_samples(
            &transaction,
            &resolved,
            start_elapsed_ms,
            end_elapsed_ms,
            limit + 1,
            after,
            boundary.sample_sequence,
        )?;
        let has_more = rows.len() > limit;
        let rows = rows.into_iter().take(limit).collect::<Vec<_>>();
        let next = has_more.then(|| rows.last().expect("nonempty bounded page").key);
        transaction.commit().map_err(map_sqlite)?;
        Ok(SamplePage { rows, next })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn reduce_series(
        &mut self,
        fields: &[String],
        start_elapsed_ms: u64,
        end_elapsed_ms: u64,
        buckets: usize,
        gap_policy: GapPolicy,
        boundary: PublishedBoundary,
    ) -> Result<SeriesReduction, ReaderError> {
        validate_range(start_elapsed_ms, end_elapsed_ms)?;
        if !(1..=MAX_SERIES_BUCKETS).contains(&buckets) {
            return Err(ReaderError::InvalidInput);
        }
        let transaction = self.deferred()?;
        validate_boundary(&transaction, boundary)?;
        let metadata = read_metadata(&transaction)?;
        let resolved = resolve_fields(&transaction, fields)?;
        let config = SeriesConfig {
            fields: fields.to_vec(),
            start_elapsed_ms,
            end_elapsed_ms,
            buckets,
            gap_policy,
            cadence: PersistenceCadence {
                default_ms: metadata.expected_idle_persistence_ms,
                riding_ms: Some(metadata.expected_riding_persistence_ms),
                idle_ms: Some(metadata.expected_idle_persistence_ms),
                retained_resolution_seconds: metadata.retained_resolution_seconds,
            },
        };
        let mut accumulator =
            SeriesAccumulator::new(config).map_err(|_| ReaderError::InvalidInput)?;
        let source_rows = stream_series(
            &transaction,
            &resolved,
            start_elapsed_ms,
            end_elapsed_ms,
            boundary.sample_sequence,
            &mut accumulator,
        )?;
        let columns = accumulator
            .finish()
            .map_err(|_| ReaderError::Incompatible)?;
        transaction.commit().map_err(map_sqlite)?;
        Ok(SeriesReduction {
            columns,
            source_rows,
        })
    }

    pub fn event_page(
        &mut self,
        start_elapsed_ms: u64,
        end_elapsed_ms: u64,
        limit: usize,
        after: Option<SampleKey>,
        boundary: PublishedBoundary,
    ) -> Result<EventPage, ReaderError> {
        validate_range(start_elapsed_ms, end_elapsed_ms)?;
        if !(1..=MAX_EVENT_PAGE).contains(&limit) {
            return Err(ReaderError::InvalidInput);
        }
        let transaction = self.deferred()?;
        validate_boundary(&transaction, boundary)?;
        let after_present = after.is_some();
        let (after_elapsed, after_sequence) = after
            .map(|key| (key.elapsed_ms, key.sequence))
            .unwrap_or((0, 0));
        let cursor_filter = if after_present {
            " AND (monotonic_elapsed_ms,sequence)>(?5,?6)"
        } else {
            ""
        };
        let sql = format!(
            "SELECT sequence, source_sample_sequence, monotonic_elapsed_ms, kind, details_json FROM session_event WHERE monotonic_elapsed_ms BETWEEN ?1 AND ?2 AND sequence <= ?3 {cursor_filter} AND kind IN ('packageState','packageMode','footpadState','stopCondition','setpointAdjustment','wheelslip','darkride','charging','alertReason','firmwareFault','fatalErrorLatched','firmwareFaultHistory','imuTimeoutHistory') ORDER BY monotonic_elapsed_ms, sequence LIMIT ?7"
        );
        let mut statement = transaction.prepare_cached(&sql).map_err(map_sqlite)?;
        let mapped = statement
            .query_map(
                rusqlite::params![
                    to_i64(start_elapsed_ms.max(after_elapsed))?,
                    to_i64(end_elapsed_ms)?,
                    to_i64(boundary.event_sequence)?,
                    i64::from(after_present),
                    to_i64(after_elapsed)?,
                    to_i64(after_sequence)?,
                    to_i64((limit + 1) as u64)?,
                ],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .map_err(map_sqlite)?;
        let mut rows = Vec::new();
        for row in mapped {
            let (sequence, source, elapsed, kind, details_json) = row.map_err(map_sqlite)?;
            let details: serde_json::Value =
                serde_json::from_str(&details_json).map_err(|_| ReaderError::Incompatible)?;
            let valid_details = if kind == "firmwareFaultHistory" {
                super::faults::valid_fault_details(&details)
                    && details["occurredElapsedMs"]
                        .as_u64()
                        .is_none_or(|t| t <= elapsed as u64)
            } else if kind == "imuTimeoutHistory" {
                super::faults::valid_timeout_details(&details)
                    && details["occurredElapsedMs"]
                        .as_u64()
                        .is_none_or(|t| t <= elapsed as u64)
            } else {
                details.as_object().is_some_and(|object| {
                    object.len() == 1
                        && object
                            .get("value")
                            .and_then(|value| value.as_str())
                            .is_some()
                })
            };
            let source_sample_sequence = source.map(from_i64).transpose()?;
            if !valid_details
                || source_sample_sequence
                    .is_some_and(|sequence| sequence == 0 || sequence > boundary.sample_sequence)
            {
                return Err(ReaderError::Incompatible);
            }
            rows.push(EventRecord {
                key: SampleKey {
                    elapsed_ms: from_i64(elapsed)?,
                    sequence: from_i64(sequence)?,
                },
                kind,
                details_json,
                source_sample_sequence,
            });
        }
        drop(statement);
        let has_more = rows.len() > limit;
        rows.truncate(limit);
        let next = has_more.then(|| rows.last().expect("nonempty bounded page").key);
        transaction.commit().map_err(map_sqlite)?;
        Ok(EventPage { rows, next })
    }

    pub fn location_page(
        &mut self,
        start_elapsed_ms: u64,
        end_elapsed_ms: u64,
        limit: usize,
        after_location_sequence: Option<u64>,
        boundary: PublishedBoundary,
    ) -> Result<LocationPage, ReaderError> {
        validate_range(start_elapsed_ms, end_elapsed_ms)?;
        if !(1..=MAX_LOCATION_PAGE).contains(&limit) {
            return Err(ReaderError::InvalidInput);
        }
        let transaction = self.deferred()?;
        validate_boundary(&transaction, boundary)?;
        let after = after_location_sequence.unwrap_or(0);
        if after > boundary.location_sequence {
            return Err(ReaderError::InvalidInput);
        }
        // Continuations seek directly by their sequence cursor. Valid location
        // streams have nondecreasing elapsed times; validate that invariant below
        // rather than rescanning the elapsed index from the beginning of the range.
        let altitude = has_location_altitude(&transaction).map_err(map_sqlite)?;
        let sql = location_page_sql(after_location_sequence.is_some(), altitude);
        let mut statement = transaction.prepare_cached(&sql).map_err(map_sqlite)?;
        let mapped = statement
            .query_map(
                rusqlite::params![
                    to_i64(start_elapsed_ms)?,
                    to_i64(end_elapsed_ms)?,
                    to_i64(boundary.location_sequence)?,
                    to_i64(after)?,
                    to_i64((limit + 1) as u64)?,
                ],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, f64>(3)?,
                        row.get::<_, f64>(4)?,
                        row.get::<_, Option<f64>>(5)?,
                        row.get::<_, Option<f64>>(6)?,
                    ))
                },
            )
            .map_err(map_sqlite)?;
        let mut rows = Vec::new();
        let mut previous_location_sequence = after;
        let mut previous_elapsed = None;
        for row in mapped {
            let (sequence, elapsed, observed, latitude, longitude, accuracy, altitude) =
                row.map_err(map_sqlite)?;
            if observed < 0
                || !latitude.is_finite()
                || !longitude.is_finite()
                || !(-90.0..=90.0).contains(&latitude)
                || !(-180.0..=180.0).contains(&longitude)
                || accuracy.is_some_and(|value| !value.is_finite() || value < 0.0)
                || altitude.is_some_and(|value| !value.is_finite())
            {
                return Err(ReaderError::Incompatible);
            }
            let location_sequence = from_i64(sequence)?;
            if location_sequence <= previous_location_sequence
                || previous_elapsed.is_some_and(|previous| elapsed < previous)
            {
                return Err(ReaderError::Incompatible);
            }
            previous_location_sequence = location_sequence;
            previous_elapsed = Some(elapsed);
            rows.push(LocationRecord {
                location_sequence,
                elapsed_ms: from_i64(elapsed)?,
                observed_at_epoch_ms: observed,
                latitude,
                longitude,
                accuracy_m: accuracy,
                altitude_m: altitude,
            });
        }
        drop(statement);
        let has_more = rows.len() > limit;
        rows.truncate(limit);
        let mut gap_statement = transaction.prepare("SELECT monotonic_elapsed_ms FROM session_event WHERE kind='recordingBoundary' AND sequence<=? ORDER BY monotonic_elapsed_ms LIMIT 1001").map_err(map_sqlite)?;
        let boundaries = gap_statement
            .query_map([to_i64(boundary.event_sequence)?], |r| r.get::<_, u64>(0))
            .map_err(map_sqlite)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_sqlite)?;
        drop(gap_statement);
        if boundaries.len() > 1000 {
            return Err(ReaderError::Incompatible);
        }
        let prior: Option<u64> = if after > 0 {
            transaction
                .query_row(
                    "SELECT monotonic_elapsed_ms FROM location WHERE location_sequence=?",
                    [to_i64(after)?],
                    |r| r.get(0),
                )
                .optional()
                .map_err(map_sqlite)?
        } else {
            None
        };
        let times: Vec<_> = prior
            .into_iter()
            .chain(rows.iter().map(|r| r.elapsed_ms))
            .collect();
        let gaps = times
            .windows(2)
            .filter_map(|pair| {
                let (left, right) = (pair[0], pair[1]);
                if right > left && boundaries.iter().any(|b| *b > left && *b <= right) {
                    Some(LocationGap {
                        start_elapsed_ms: left,
                        end_elapsed_ms: right,
                    })
                } else if right.saturating_sub(left) > LOCATION_GAP_MS {
                    Some(LocationGap {
                        start_elapsed_ms: left + 1,
                        end_elapsed_ms: right - 1,
                    })
                } else {
                    None
                }
            })
            .collect();
        let next_location_sequence = has_more.then(|| {
            rows.last()
                .expect("nonempty bounded page")
                .location_sequence
        });
        transaction.commit().map_err(map_sqlite)?;
        Ok(LocationPage {
            rows,
            gaps,
            published_location_sequence: boundary.location_sequence,
            next_location_sequence,
        })
    }

    fn deferred(&mut self) -> Result<Transaction<'_>, ReaderError> {
        self.connection
            .transaction_with_behavior(TransactionBehavior::Deferred)
            .map_err(map_sqlite)
    }
}

fn location_page_sql(continued: bool, altitude: bool) -> String {
    let altitude = if altitude { "altitude_m" } else { "NULL" };
    let order = if continued {
        "location_sequence"
    } else {
        "monotonic_elapsed_ms, location_sequence"
    };
    format!(
        "SELECT location_sequence, monotonic_elapsed_ms, observed_at_ms, latitude, longitude, accuracy_m, {altitude} FROM location WHERE monotonic_elapsed_ms BETWEEN ?1 AND ?2 AND location_sequence <= ?3 AND location_sequence > ?4 ORDER BY {order} LIMIT ?5"
    )
}

fn stream_series(
    transaction: &Transaction<'_>,
    fields: &[ResolvedField],
    start_elapsed_ms: u64,
    end_elapsed_ms: u64,
    published_sequence: u64,
    accumulator: &mut SeriesAccumulator,
) -> Result<usize, ReaderError> {
    let mut values = Vec::new();
    let expressions = field_expressions(fields, &mut values)?;
    values.extend([
        Value::Integer(to_i64(start_elapsed_ms)?),
        Value::Integer(to_i64(end_elapsed_ms)?),
        Value::Integer(to_i64(published_sequence)?),
        Value::Integer(to_i64((MAX_SERIES_SOURCE_ROWS + 1) as u64)?),
    ]);
    let sql = format!(
        "SELECT sequence, monotonic_elapsed_ms, ride_state, {}, EXISTS(SELECT 1 FROM session_event e WHERE e.kind='recordingBoundary' AND e.source_sample_sequence=sample.sequence) FROM sample WHERE monotonic_elapsed_ms BETWEEN ? AND ? AND sequence <= ? ORDER BY monotonic_elapsed_ms, sequence LIMIT ?",
        expressions.join(", ")
    );
    let mut statement = transaction.prepare(&sql).map_err(map_sqlite)?;
    let mut rows = statement
        .query(params_from_iter(values))
        .map_err(map_sqlite)?;
    let mut source_rows = 0_usize;
    while let Some(row) = rows.next().map_err(map_sqlite)? {
        source_rows += 1;
        if source_rows > MAX_SERIES_SOURCE_ROWS {
            return Err(ReaderError::InvalidInput);
        }
        let sequence = from_i64(row.get::<_, i64>(0).map_err(map_sqlite)?)?;
        let elapsed_ms = from_i64(row.get::<_, i64>(1).map_err(map_sqlite)?)?;
        let ride_state = row.get::<_, String>(2).map_err(map_sqlite)?;
        let ride_phase = match ride_state.as_str() {
            "riding" => RidePhase::Riding,
            "idle" | "unknown" => RidePhase::Other,
            _ => return Err(ReaderError::Incompatible),
        };
        let mut row_values = Vec::with_capacity(fields.len());
        for index in 0..fields.len() {
            let value = row.get::<_, Option<f64>>(index + 3).map_err(map_sqlite)?;
            if value.is_some_and(|number| !number.is_finite()) {
                return Err(ReaderError::Incompatible);
            }
            row_values.push(value);
        }
        if row
            .get::<_, bool>(expressions.len() + 3)
            .map_err(map_sqlite)?
        {
            accumulator
                .break_segment()
                .map_err(|_| ReaderError::Incompatible)?;
        }
        accumulator
            .append(SeriesObservation {
                elapsed_ms,
                sequence,
                ride_phase,
                values: &row_values,
            })
            .map_err(|_| ReaderError::Incompatible)?;
    }
    Ok(source_rows)
}

#[derive(Clone)]
enum ResolvedField {
    Stable(&'static str),
    Extension(String),
}

fn resolve_fields(
    transaction: &Transaction<'_>,
    fields: &[String],
) -> Result<Vec<ResolvedField>, ReaderError> {
    if fields.is_empty() || fields.len() > MAX_QUERY_FIELDS {
        return Err(ReaderError::InvalidInput);
    }
    let mut unique = BTreeSet::new();
    let durable = read_fields(transaction)?
        .into_iter()
        .filter(|field| field.source == FieldSource::Extension)
        .map(|field| field.name)
        .collect::<BTreeSet<_>>();
    fields
        .iter()
        .map(|field| {
            if field.is_empty()
                || field.len() > MAX_EXTENSION_NAME_BYTES
                || !unique.insert(field.as_str())
            {
                return Err(ReaderError::InvalidInput);
            }
            if let Some(column) = stable_column(field) {
                Ok(ResolvedField::Stable(column))
            } else if durable.contains(field) {
                Ok(ResolvedField::Extension(field.clone()))
            } else {
                Err(ReaderError::InvalidInput)
            }
        })
        .collect()
}

fn query_samples(
    transaction: &Transaction<'_>,
    fields: &[ResolvedField],
    start_elapsed_ms: u64,
    end_elapsed_ms: u64,
    limit: usize,
    after: Option<SampleKey>,
    published_sequence: u64,
) -> Result<Vec<SampleRecord>, ReaderError> {
    let mut values = Vec::new();
    let expressions = field_expressions(fields, &mut values)?;
    // Start at the cursor; the tuple comparison resolves tied times.
    values.extend([
        Value::Integer(to_i64(
            start_elapsed_ms.max(after.map_or(0, |key| key.elapsed_ms)),
        )?),
        Value::Integer(to_i64(end_elapsed_ms)?),
        Value::Integer(to_i64(published_sequence)?),
    ]);
    let cursor_filter = if let Some(after) = after {
        values.extend([
            Value::Integer(to_i64(after.elapsed_ms)?),
            Value::Integer(to_i64(after.sequence)?),
        ]);
        " AND (monotonic_elapsed_ms,sequence)>(?,?)"
    } else {
        ""
    };
    values.push(Value::Integer(to_i64(limit as u64)?));
    let selected = if expressions.is_empty() {
        String::new()
    } else {
        format!(", {}", expressions.join(", "))
    };
    let sql = format!(
        "SELECT sequence, monotonic_elapsed_ms, ride_state{selected} FROM sample WHERE monotonic_elapsed_ms BETWEEN ? AND ? AND sequence <= ? {cursor_filter} ORDER BY monotonic_elapsed_ms, sequence LIMIT ?"
    );
    let mut statement = transaction.prepare(&sql).map_err(map_sqlite)?;
    let mapped = statement
        .query_map(params_from_iter(values), |row| {
            let mut row_values = Vec::with_capacity(fields.len());
            for index in 0..fields.len() {
                row_values.push(row.get::<_, Option<f64>>(index + 3)?);
            }
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row_values,
            ))
        })
        .map_err(map_sqlite)?;
    let mut result = Vec::new();
    for row in mapped {
        let (sequence, elapsed, ride_state, values) = row.map_err(map_sqlite)?;
        if !matches!(ride_state.as_str(), "idle" | "riding" | "unknown")
            || values.iter().flatten().any(|value| !value.is_finite())
        {
            return Err(ReaderError::Incompatible);
        }
        result.push(SampleRecord {
            key: SampleKey {
                elapsed_ms: from_i64(elapsed)?,
                sequence: from_i64(sequence)?,
            },
            ride_state,
            values,
        });
    }
    Ok(result)
}

fn field_expressions(
    fields: &[ResolvedField],
    values: &mut Vec<Value>,
) -> Result<Vec<String>, ReaderError> {
    fields
        .iter()
        .map(|field| match field {
            ResolvedField::Stable(column) => Ok((*column).to_owned()),
            ResolvedField::Extension(name) => {
                values.push(Value::Text(json_path(name)?));
                Ok("json_extract(extension_json, ?)".to_owned())
            }
        })
        .collect()
}

fn json_path(name: &str) -> Result<String, ReaderError> {
    serde_json::to_string(name)
        .map(|quoted| format!("$.{quoted}"))
        .map_err(|_| ReaderError::InvalidInput)
}

fn read_metadata(connection: &Connection) -> Result<ReaderMetadata, ReaderError> {
    connection
        .query_row(
            "SELECT expected_riding_persistence_ms, expected_idle_persistence_ms, pruned_at_ms, COALESCE(retained_resolution_seconds, 0), prune_policy FROM session_metadata WHERE singleton = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .map_err(map_sqlite)
        .and_then(|(riding, idle, pruned, retained, policy)| {
            let riding = from_i64(riding)?;
            let idle = from_i64(idle)?;
            let retained = from_i64(retained)?;
            if !(1..=MAX_PERSISTENCE_CADENCE_MS).contains(&riding)
                || !(1..=MAX_PERSISTENCE_CADENCE_MS).contains(&idle)
                || retained > 300
                || pruned.is_some_and(|value| value < 0)
                || policy.as_ref().is_some_and(|value| value != "m4-source-v1")
            {
                return Err(ReaderError::Incompatible);
            }
            Ok(ReaderMetadata {
                expected_riding_persistence_ms: riding,
                expected_idle_persistence_ms: idle,
                pruned_at_epoch_ms: pruned,
                retained_resolution_seconds: retained,
                prune_policy: policy,
            })
        })
}

fn read_fields(connection: &Connection) -> Result<Vec<FieldDescriptor>, ReaderError> {
    let mut statement = connection
        .prepare("SELECT field_name, source, first_sequence FROM session_numeric_field ORDER BY field_name LIMIT ?")
        .map_err(map_sqlite)?;
    let rows = statement
        .query_map(
            [i64::try_from(MAX_EXTENSIONS + 37).expect("small bound")],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .map_err(map_sqlite)?;
    let mut result = Vec::new();
    let mut extensions = 0;
    for row in rows {
        let (name, source, sequence) = row.map_err(map_sqlite)?;
        if name.is_empty() || name.len() > MAX_EXTENSION_NAME_BYTES {
            return Err(ReaderError::Incompatible);
        }
        let source = match source.as_str() {
            "stable" if stable_column(&name).is_some() => FieldSource::Stable,
            "extension" if stable_column(&name).is_none() => {
                extensions += 1;
                FieldSource::Extension
            }
            _ => return Err(ReaderError::Incompatible),
        };
        if extensions > MAX_EXTENSIONS {
            return Err(ReaderError::Incompatible);
        }
        result.push(FieldDescriptor {
            name,
            source,
            first_sequence: from_i64(sequence)?,
        });
    }
    Ok(result)
}

fn validate_reader_state(connection: &Connection) -> Result<(), ReaderError> {
    let metadata = read_metadata(connection)?;
    let marker = read_marker(connection).map_err(map_writer)?;
    if marker.committed_at_epoch_ms < 0
        || marker.committed_sample_sequence > i64::MAX as u64
        || marker.committed_event_sequence > i64::MAX as u64
        || marker.committed_location_sequence > i64::MAX as u64
        || metadata.retained_resolution_seconds > 300
    {
        return Err(ReaderError::Incompatible);
    }
    read_fields(connection)?;
    Ok(())
}

fn validate_boundary(
    transaction: &Transaction<'_>,
    boundary: PublishedBoundary,
) -> Result<(), ReaderError> {
    let marker = read_marker(transaction).map_err(map_writer)?;
    if boundary.history_revision != marker.history_revision
        || boundary.sample_sequence > marker.committed_sample_sequence
        || boundary.event_sequence > marker.committed_event_sequence
        || boundary.location_sequence > marker.committed_location_sequence
    {
        return Err(ReaderError::InvalidInput);
    }
    Ok(())
}

fn validate_range(start: u64, end: u64) -> Result<(), ReaderError> {
    if start > end || end > i64::MAX as u64 {
        Err(ReaderError::InvalidInput)
    } else {
        Ok(())
    }
}

fn stable_column(name: &str) -> Option<&'static str> {
    Some(match name {
        "packVoltageV" => "raw_pack_voltage_v",
        "dutyCycle" => "duty_cycle",
        "controllerTempC" => "controller_temp_c",
        "motorTempC" => "motor_temp_c",
        "bmsCircuitryTempC" => "bms_circuitry_temp_c",
        "bmsHighestCellTempC" => "bms_highest_cell_temp_c",
        "motorCurrentA" => "motor_current_a",
        "batteryCurrentA" => "battery_current_a",
        "erpm" => "erpm",
        "speedKph" => "speed_kph",
        "pitchDeg" => "pitch_deg",
        "balancePitchDeg" => "balance_pitch_deg",
        "rollDeg" => "roll_deg",
        "directionalMotorCurrentA" => "directional_motor_current_a",
        "filteredMotorCurrentA" => "filtered_motor_current_a",
        "requestedBalanceCurrentA" => "requested_balance_current_a",
        "boosterCurrentA" => "booster_current_a",
        "fieldWeakeningCurrentA" => "field_weakening_current_a",
        "footpadAdc1V" => "footpad_adc_1_v",
        "footpadAdc2V" => "footpad_adc_2_v",
        "remoteInput" => "remote_input",
        "setpointDeg" => "setpoint_deg",
        "atrSetpointDeg" => "atr_setpoint_deg",
        "brakeTiltSetpointDeg" => "brake_tilt_setpoint_deg",
        "torqueTiltSetpointDeg" => "torque_tilt_setpoint_deg",
        "turnTiltSetpointDeg" => "turn_tilt_setpoint_deg",
        "remoteSetpointDeg" => "remote_setpoint_deg",
        "atrAccelerationDifferenceErpmPerSecond" => "atr_acceleration_difference_erpm_per_second",
        "atrSpeedBoost" => "atr_speed_boost",
        "distanceM" => "distance_m",
        "odometerM" => "odometer_m",
        "ampHoursDrawnAh" => "amp_hours_drawn_ah",
        "ampHoursChargedAh" => "amp_hours_charged_ah",
        "wattHoursDrawnWh" => "watt_hours_drawn_wh",
        "wattHoursChargedWh" => "watt_hours_charged_wh",
        "batteryLevel" => "battery_level",
        "chargingCurrentA" => "charging_current_a",
        "chargingVoltageV" => "charging_voltage_v",
        _ => return None,
    })
}

fn from_i64(value: i64) -> Result<u64, ReaderError> {
    u64::try_from(value).map_err(|_| ReaderError::Incompatible)
}

fn to_i64(value: u64) -> Result<i64, ReaderError> {
    i64::try_from(value).map_err(|_| ReaderError::InvalidInput)
}

fn map_writer(error: WriterError) -> ReaderError {
    match error {
        WriterError::InvalidInput | WriterError::TargetExists => ReaderError::Incompatible,
        WriterError::Incompatible => ReaderError::Incompatible,
        WriterError::Corrupt => ReaderError::Corrupt,
        WriterError::Busy => ReaderError::Busy,
        WriterError::Io | WriterError::Full => ReaderError::Io,
        WriterError::Database => ReaderError::Database,
    }
}

fn map_open(error: rusqlite::Error) -> ReaderError {
    match error.sqlite_error_code() {
        Some(ErrorCode::CannotOpen) => ReaderError::NotFound,
        Some(ErrorCode::PermissionDenied) => ReaderError::Io,
        _ => map_sqlite(error),
    }
}

fn map_sqlite(error: rusqlite::Error) -> ReaderError {
    match error.sqlite_error_code() {
        Some(ErrorCode::OperationInterrupted) => ReaderError::Cancelled,
        Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => ReaderError::Busy,
        Some(ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase) => ReaderError::Corrupt,
        Some(ErrorCode::SystemIoFailure | ErrorCode::CannotOpen | ErrorCode::PermissionDenied) => {
            ReaderError::Io
        }
        _ => ReaderError::Database,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_catalogue_has_exact_closed_surface() {
        let fields = [
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
        assert_eq!(fields.len(), 38);
        assert!(
            fields
                .into_iter()
                .all(|field| stable_column(field).is_some())
        );
        assert_eq!(stable_column("extension"), None);
    }

    #[test]
    fn diagnostics_are_payload_free() {
        assert_eq!(format!("{:#?}", ReaderError::Database), "Database");
        assert_eq!(
            format!(
                "{:?}",
                SessionReader {
                    connection: Connection::open_in_memory().unwrap(),
                    interrupter: ReadInterrupter(Arc::new(
                        Connection::open_in_memory().unwrap().get_interrupt_handle()
                    ))
                }
            ),
            "SessionReader([redacted])"
        );
        assert_eq!(
            format!(
                "{:?}",
                EventRecord {
                    key: SampleKey {
                        elapsed_ms: 1,
                        sequence: 2
                    },
                    kind: "secret".into(),
                    details_json: "secret".into(),
                    source_sample_sequence: None
                }
            ),
            "EventRecord([redacted])"
        );
    }
}

#[cfg(test)]
mod location_query_tests {
    use super::*;
    #[test]
    fn continuation_seeks_primary_key_without_sorting() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(super::super::SESSION_SCHEMA).unwrap();
        let mut statement = db
            .prepare(&format!(
                "EXPLAIN QUERY PLAN {}",
                location_page_sql(true, false)
            ))
            .unwrap();
        let plan = statement
            .query_map([0, 1000000, 1000000, 900000, 101], |row| {
                row.get::<_, String>(3)
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
            .join("; ");
        assert!(plan.contains("USING INTEGER PRIMARY KEY"), "{plan}");
        assert!(!plan.contains("TEMP B-TREE"), "{plan}");
    }
}
