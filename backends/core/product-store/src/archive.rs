//! Portable archive encoding and validation, outside the service mutation lock.
use crate::{
    Error, FileCancellation, ImportSink, ProductStore, Result, Session, SessionLease, StagedFile,
    boards, identifier, json, limits, root,
};
use float_view_session_sqlite::{
    CommitMarker, LOCATION_ALTITUDE_SCHEMA, SESSION_SCHEMA, SessionReader, has_location_altitude,
};
use rusqlite::{
    Connection, OpenFlags,
    backup::{Backup, StepResult},
    params,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    fs::{self, File},
    io::{Read, Write},
    sync::Arc,
};
#[path = "app_transfer.rs"]
mod app_transfer;
pub use app_transfer::{AppImport, AppImportSummary};

const META: &str =
    "CREATE TABLE float_view_archive_metadata(key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)";
fn archive_format_version(has_altitude: bool) -> &'static str {
    if has_altitude { "5" } else { "4" }
}
const MAX_MANIFEST: usize = 65_536;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    session_id: String,
    device_history_id: String,
    device_snapshot: DeviceSnapshot,
    board_profile_snapshot: Map<String, Value>,
    board_profile_revision: u64,
    started_at_ms: i64,
    ended_at_ms: Option<i64>,
    state: String,
    integrity: String,
    committed_sequence: u64,
    sample_count: u64,
    event_count: u64,
    requested_idle_ms: u64,
    effective_idle_ms: u64,
    requested_riding_ms: u64,
    effective_riding_ms: u64,
    close_reason: Option<String>,
    riding_elapsed_ms: u64,
    total_elapsed_ms: u64,
    distance_m: Option<f64>,
    max_speed_mps: Option<f64>,
    max_duty_cycle: Option<f64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeviceSnapshot {
    saved_device_id: String,
    device_history_id: String,
    display_name: String,
}
impl Manifest {
    fn validate(&self) -> Result<()> {
        boards::validate_id(&self.session_id)?;
        if !root::is_uuid(&self.session_id) {
            return Err(Error::InvalidInput);
        }
        boards::validate_history(&self.device_history_id)?;
        boards::validate_id(&self.device_snapshot.saved_device_id)?;
        if self.device_snapshot.device_history_id != self.device_history_id
            || self.device_snapshot.display_name.len() > 128
            || self.started_at_ms < 0
            || self.ended_at_ms.is_some_and(|v| v < self.started_at_ms)
            || !matches!(self.state.as_str(), "completed" | "interrupted")
            || !matches!(self.integrity.as_str(), "complete" | "recovered" | "dirty")
            || self.close_reason.as_ref().is_some_and(|v| v.len() > 128)
        {
            return Err(Error::InvalidInput);
        }
        for v in [
            self.board_profile_revision,
            self.committed_sequence,
            self.sample_count,
            self.event_count,
            self.riding_elapsed_ms,
            self.total_elapsed_ms,
        ] {
            if v > limits::MAX_REVISION {
                return Err(Error::InvalidInput);
            }
        }
        for v in [
            self.requested_idle_ms,
            self.effective_idle_ms,
            self.requested_riding_ms,
            self.effective_riding_ms,
        ] {
            if !(1..=float_view_session_sqlite::MAX_PERSISTENCE_CADENCE_MS).contains(&v) {
                return Err(Error::InvalidInput);
            }
        }
        if [self.distance_m, self.max_speed_mps, self.max_duty_cycle]
            .iter()
            .flatten()
            .any(|v| !v.is_finite() || *v < 0.)
        {
            return Err(Error::InvalidInput);
        }
        json(&self.board_profile_snapshot, limits::MAX_PROFILE_BYTES)?;
        boards::validate_profile(&self.board_profile_snapshot)
    }
}
pub struct ArchiveImport {
    stage: StagedFile,
    manifest: Manifest,
    marker: CommitMarker,
}
impl ImportSink {
    /// Run validation on a bounded worker, never under the service owner lock.
    pub fn validate(self, cancel: &FileCancellation) -> Result<ArchiveImport> {
        let stage = self.finish()?;
        cancel.check()?;
        let db = open(&stage, cancel)?;
        let has_altitude = has_location_altitude(&db)?;
        validate_schema(&db, has_altitude)?;
        let version:String=db.query_row("SELECT value FROM float_view_archive_metadata WHERE key='format_version' AND length(value)=1",[],|r|r.get(0))?;
        let text:String=db.query_row("SELECT value FROM float_view_archive_metadata WHERE key='session' AND length(CAST(value AS BLOB))<=?",[MAX_MANIFEST],|r|r.get(0))?;
        let count: usize = db.query_row(
            "SELECT COUNT(*) FROM (SELECT 1 FROM float_view_archive_metadata LIMIT 3)",
            [],
            |r| r.get(0),
        )?;
        if version != archive_format_version(has_altitude) || count != 2 {
            return Err(Error::InvalidInput);
        }
        let manifest: Manifest = serde_json::from_str(&text).map_err(|_| Error::InvalidInput)?;
        manifest.validate()?;
        db.execute_batch("DROP TABLE float_view_archive_metadata; PRAGMA journal_mode=WAL; PRAGMA wal_checkpoint(TRUNCATE)")?;
        db.close().map_err(|(_, e)| Error::from(e))?;
        cancel.check()?;
        let mut reader = SessionReader::open(&stage.path)?;
        let marker = reader.marker()?;
        let metadata = reader.metadata()?;
        let reader_marker_count = reader.ride_markers((&marker).into())?.len();
        reader.recording_breaks((&marker).into())?;
        drop(reader);
        let db = open(&stage, cancel)?;
        let counts:(u64,u64,u64)=db.query_row("SELECT (SELECT COUNT(*) FROM sample),(SELECT COUNT(*) FROM session_event),(SELECT COUNT(*) FROM location)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
        let maxima:(u64,u64,u64)=db.query_row("SELECT (SELECT COALESCE(MAX(sequence),0) FROM sample),(SELECT COALESCE(MAX(sequence),0) FROM session_event),(SELECT COALESCE(MAX(location_sequence),0) FROM location)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
        if maxima.0 != marker.committed_sample_sequence
            || maxima.1 != marker.committed_event_sequence
            || maxima.2 > marker.committed_location_sequence
        {
            return Err(Error::InvalidInput);
        }
        let fk: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check)",
            [],
            |r| r.get(0),
        )?;
        if fk
            || (marker.stored_sample_count == 0 && reader_marker_count == 0)
            || counts
                != (
                    marker.stored_sample_count,
                    marker.committed_event_count,
                    marker.stored_location_count,
                )
            || manifest.sample_count != marker.recorded_sample_count
            || manifest.event_count != marker.committed_event_count
            || manifest.committed_sequence != marker.committed_sample_sequence
            || manifest.effective_idle_ms != metadata.expected_idle_persistence_ms
            || manifest.effective_riding_ms != metadata.expected_riding_persistence_ms
        {
            return Err(Error::InvalidInput);
        }
        db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        drop(db);
        cancel.check()?;
        Ok(ArchiveImport {
            stage,
            manifest,
            marker,
        })
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Archive,
    Csv,
}
pub struct ArchiveExport {
    stage: StagedFile,
    session: PreparedExport,
}
struct PreparedExport {
    source: SessionLease,
    manifest: Manifest,
    format: ExportFormat,
    gps: bool,
    name_prefix: String,
}
impl ArchiveExport {
    pub fn run(self, cancel: &FileCancellation) -> Result<StagedFile> {
        let Self { mut stage, session } = self;
        cancel.check()?;
        root::require_kind(session.source.path(), false)?;
        let source =
            Connection::open_with_flags(session.source.path(), OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        configure(&source, cancel)?;
        // Name the staging file before encoding so the CSV entry shares its basename.
        let timestamp = export_timestamp(&source, session.manifest.started_at_ms)?;
        let destination = stage
            .path
            .with_file_name(format!("{}-{timestamp}.tmp", session.name_prefix));
        fs::rename(&stage.path, &destination)?;
        stage.path = destination;
        match session.format {
            ExportFormat::Archive => {
                let mut dest = open(&stage, cancel)?;
                {
                    let backup = Backup::new(&source, &mut dest)?;
                    loop {
                        cancel.check()?;
                        match backup.step(16)? {
                            StepResult::Done => break,
                            StepResult::More => {}
                            _ => return Err(Error::Busy),
                        }
                        if stage.len()? > limits::MAX_EXPORT_BYTES {
                            return Err(Error::Capacity);
                        }
                    }
                }
                dest.execute_batch(META)?;
                let version = archive_format_version(has_location_altitude(&dest)?);
                dest.execute("INSERT INTO float_view_archive_metadata(key,value) VALUES ('format_version',?),('session',?)",params![version,json(&session.manifest,MAX_MANIFEST)?])?;
                dest.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
                dest.close().map_err(|(_, e)| Error::from(e))?;
            }
            ExportFormat::Csv => crate::csv::write(&source, &stage, session.gps, cancel)?,
        }
        cancel.check()?;
        if stage.len()? > limits::MAX_EXPORT_BYTES {
            return Err(Error::Capacity);
        }
        let suffix = if session.format == ExportFormat::Archive {
            "floatview"
        } else {
            "csv.zip"
        };
        let destination = stage.path.with_extension(suffix);
        fs::rename(&stage.path, &destination)?;
        stage.path = destination;
        File::open(&stage.path)?.sync_all()?;
        Ok(stage)
    }
}
fn export_timestamp(db: &Connection, started_at_ms: i64) -> Result<String> {
    let timestamp: Option<String> = db.query_row(
        "SELECT strftime('%Y-%m-%d_%H-%M-%SZ', ?1 / 1000, 'unixepoch')",
        [started_at_ms],
        |row| row.get(0),
    )?;
    // Preserve exportability for stored timestamps outside SQLite's calendar range.
    Ok(timestamp.unwrap_or_else(|| format!("unix-ms-{started_at_ms}")))
}

fn export_name_prefix(name: &str) -> String {
    // Keep names portable across native save/share destinations and HTTP headers.
    let mut prefix = String::new();
    let mut separator = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            if separator && !prefix.is_empty() {
                prefix.push('_');
            }
            prefix.push(ch.to_ascii_lowercase());
            separator = false;
        } else {
            separator = true;
        }
        if prefix.len() >= 64 {
            prefix.truncate(64);
            break;
        }
    }
    let prefix = prefix.trim_end_matches('_');
    if prefix.is_empty() {
        "board".into()
    } else {
        prefix.into()
    }
}

fn require_export_space(root: &std::path::Path, needed: u64) -> Result<()> {
    let space = rustix::fs::statvfs(root).map_err(|_| Error::Io)?;
    check_export_space(space.f_bavail.saturating_mul(space.f_frsize), needed)
}
fn check_export_space(available: u64, needed: u64) -> Result<()> {
    if available < needed {
        Err(Error::Full)
    } else {
        Ok(())
    }
}

/// One output and one reusable scratch file; session bytes never accumulate in memory.
pub struct BoardExport {
    app_manifest: Option<Vec<u8>>,
    sessions: Vec<PreparedExport>,
    stage: StagedFile,
    scratch: StagedFile,
}
impl BoardExport {
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }
    pub fn run(self, cancel: &FileCancellation) -> Result<StagedFile> {
        self.run_with_progress(cancel, |_| {})
    }
    pub fn run_with_progress(
        self,
        cancel: &FileCancellation,
        progress: impl Fn(usize),
    ) -> Result<StagedFile> {
        let Self {
            app_manifest,
            sessions,
            mut stage,
            mut scratch,
        } = self;
        cancel.check()?;
        let name = if app_manifest.is_some() {
            "float-view-app-transfer.zip".into()
        } else {
            let first = sessions.first().ok_or(Error::NotFound)?;
            format!(
                "{}-all-sessions-{}.zip",
                first.name_prefix,
                if first.format == ExportFormat::Csv {
                    "csv"
                } else {
                    "archives"
                }
            )
        };
        let destination = stage.path.with_file_name(name);
        fs::rename(&stage.path, &destination)?;
        stage.path = destination;
        let mut output = zip::ZipWriter::new(File::create(stage.path())?);
        let mut budget = 0_u64;
        if let Some(manifest) = &app_manifest {
            output
                .start_file(
                    "manifest.json",
                    zip::write::SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Stored),
                )
                .map_err(|_| Error::Io)?;
            output.write_all(manifest)?;
            budget = manifest.len() as u64 + 512;
        }
        let mut buffer = [0_u8; 65_536];
        for (index, session) in sessions.into_iter().enumerate() {
            cancel.check()?;
            require_export_space(
                &stage.root,
                session
                    .source
                    .path()
                    .metadata()?
                    .len()
                    .saturating_mul(2)
                    .saturating_add(limits::EXPORT_FREE_SPACE_HEADROOM),
            )?;
            scratch = ArchiveExport {
                stage: scratch,
                session,
            }
            .run(cancel)?;
            // Include a conservative bound for each ZIP local/central header and filename.
            budget = budget
                .checked_add(scratch.len()?)
                .and_then(|v| v.checked_add(512))
                .filter(|v| *v <= limits::MAX_BOARD_EXPORT_BYTES)
                .ok_or(Error::Capacity)?;
            let name = scratch
                .path()
                .file_name()
                .and_then(|v| v.to_str())
                .ok_or(Error::UnsafePath)?;
            output
                .start_file(
                    if app_manifest.is_some() {
                        format!("sessions/{:05}.floatview", index + 1)
                    } else {
                        format!("{:05}-{name}", index + 1)
                    },
                    zip::write::SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Stored),
                )
                .map_err(|_| Error::Io)?;
            let mut input = File::open(scratch.path())?;
            loop {
                cancel.check()?;
                let count = input.read(&mut buffer)?;
                if count == 0 {
                    break;
                }
                output.write_all(&buffer[..count])?;
            }
            drop(input);
            // SQLite archives must start with an empty file on the next iteration.
            File::create(scratch.path())?;
            progress(index + 1);
        }
        cancel.check()?;
        output.finish().map_err(|_| Error::Io)?.sync_all()?;
        if stage.len()? > limits::MAX_BOARD_EXPORT_BYTES {
            return Err(Error::Capacity);
        }
        Ok(stage)
    }
}

impl ProductStore {
    pub fn prepare_export(&self, id: &str, format: ExportFormat) -> Result<ArchiveExport> {
        Ok(ArchiveExport {
            session: self.prepare_export_source(id, format, false)?,
            stage: self.stage(true, limits::MAX_EXPORT_BYTES * 2)?,
        })
    }
    fn prepare_export_source(
        &self,
        id: &str,
        format: ExportFormat,
        bulk: bool,
    ) -> Result<PreparedExport> {
        let s = self.session(id)?;
        if s.state == "active" {
            return Err(Error::ActiveSession);
        }
        let board_name: String = self.catalog.query_row(
            "SELECT COALESCE(NULLIF(custom_display_name,''),NULLIF(advertised_name,''),'board') FROM saved_device WHERE device_history_id=?",
            [&s.device_history_id],
            |row| row.get(0),
        )?;
        let (idle,eidle,riding,eriding,reason):(u64,u64,u64,u64,Option<String>)=self.catalog.query_row("SELECT requested_idle_ms,effective_idle_ms,requested_riding_ms,effective_riding_ms,close_reason FROM session_catalog WHERE session_id=?",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))?;
        let manifest = Manifest {
            session_id: s.session_id,
            device_history_id: s.device_history_id,
            device_snapshot: serde_json::from_value(s.device_snapshot)
                .map_err(|_| Error::Corrupt)?,
            board_profile_snapshot: serde_json::from_value(s.profile_snapshot)
                .map_err(|_| Error::Corrupt)?,
            board_profile_revision: s.profile_revision,
            started_at_ms: s.started_at_ms,
            ended_at_ms: s.ended_at_ms,
            state: s.state,
            integrity: s.integrity,
            committed_sequence: s.committed_sequence,
            sample_count: s.recorded_sample_count,
            event_count: s.event_count,
            requested_idle_ms: idle,
            effective_idle_ms: eidle,
            requested_riding_ms: riding,
            effective_riding_ms: eriding,
            close_reason: reason,
            riding_elapsed_ms: s.riding_elapsed_ms,
            total_elapsed_ms: s.total_elapsed_ms,
            distance_m: s.distance_m,
            max_speed_mps: s.max_speed_mps,
            max_duty_cycle: s.max_duty_cycle,
        };
        manifest.validate()?;
        let source = if bulk {
            self.lease_bulk_export_session(id)?
        } else {
            self.lease_session(id)?
        };
        if source.path().metadata()?.len() > limits::MAX_EXPORT_BYTES {
            return Err(Error::Capacity);
        }
        Ok(PreparedExport {
            source,
            manifest,
            format,
            gps: self.settings()?.include_gps_location_when_exporting,
            name_prefix: export_name_prefix(&board_name),
        })
    }
    pub fn prepare_board_export(&self, id: &str, format: ExportFormat) -> Result<BoardExport> {
        let board = self.board(id)?;
        let mut statement = self.catalog.prepare(
            "SELECT session_id FROM session_catalog WHERE device_history_id=? AND pending_delete=0 AND state!='active' ORDER BY started_at_ms,session_id LIMIT ?"
        )?;
        let ids = statement
            .query_map(
                params![
                    board.device_history_id,
                    limits::MAX_BOARD_EXPORT_SESSIONS + 1
                ],
                |r| r.get::<_, String>(0),
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        if ids.is_empty() {
            return Err(Error::NotFound);
        }
        if ids.len() > limits::MAX_BOARD_EXPORT_SESSIONS {
            return Err(Error::Capacity);
        }
        let sessions = ids
            .iter()
            .map(|id| self.prepare_export_source(id, format, true))
            .collect::<Result<Vec<_>>>()?;
        let sizes = sessions
            .iter()
            .map(|s| {
                s.source
                    .path()
                    .metadata()
                    .map(|m| m.len())
                    .map_err(Error::from)
            })
            .collect::<Result<Vec<_>>>()?;
        let estimated = sizes
            .iter()
            .sum::<u64>()
            .saturating_mul(2)
            .min(limits::MAX_BOARD_EXPORT_BYTES)
            .saturating_add(sizes.iter().max().copied().unwrap_or(0).saturating_mul(2))
            .saturating_add(limits::EXPORT_FREE_SPACE_HEADROOM);
        require_export_space(&self.root, estimated)?;
        Ok(BoardExport {
            app_manifest: None,
            sessions,
            stage: self.stage(true, limits::MAX_BOARD_EXPORT_BYTES)?,
            scratch: self.stage(true, limits::MAX_EXPORT_BYTES * 2)?,
        })
    }
    /// A short owner transaction attaches a validated, service-issued file.
    pub fn attach_import(&mut self, mut import: ArchiveImport) -> Result<Session> {
        if import.stage.root != self.root || !Arc::ptr_eq(&import.stage.budget, &self.file_budget) {
            return Err(Error::InvalidInput);
        }
        let active: bool = self.catalog.query_row(
            "SELECT EXISTS(SELECT 1 FROM session_catalog WHERE state='active')",
            [],
            |r| r.get(0),
        )?;
        if active {
            return Err(Error::ActiveSession);
        }
        let id = import.manifest.session_id.clone();
        match self.session(&id) {
            Ok(existing) => {
                return if existing.device_history_id == import.manifest.device_history_id {
                    Ok(existing)
                } else {
                    Err(Error::InvalidInput)
                };
            }
            Err(Error::NotFound) => {}
            Err(error) => return Err(error),
        }
        let job = identifier()?;
        let file = format!("session-{id}.sqlite");
        let destination = self.root.join(&file);
        if destination.try_exists()? {
            return Err(Error::Capacity);
        }
        let revision = crate::next_revision(self.catalog_revision)?;
        let m = &import.manifest;
        root::require_kind(&import.stage.path, false)?;
        // Rename before the transaction; the lease cleans failed attachment.
        // Startup removes an unreferenced owned session after a crash here.
        fs::rename(&import.stage.path, &destination)?;
        import.stage.path = destination;
        File::open(&self.root)?.sync_all()?;
        let tx = self
            .catalog
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        attach_session_row(&tx, &id, &job, &file, m, &import.marker)?;
        let committed = tx.commit();
        // A commit error can have an uncertain durable outcome. Preserve the
        // file; startup reconciles referenced files and removes true orphans.
        import.stage.owned = false;
        committed?;
        self.catalog_revision = revision;
        self.session(&id)
    }
}
fn configure(db: &Connection, cancel: &FileCancellation) -> Result<()> {
    db.busy_timeout(std::time::Duration::from_millis(limits::SQLITE_BUSY_MS))?;
    db.pragma_update(None, "trusted_schema", false)?;
    let cancel = cancel.clone();
    db.progress_handler(1000, Some(move || cancel.interrupted()));
    Ok(())
}
fn open(stage: &StagedFile, cancel: &FileCancellation) -> Result<Connection> {
    root::require_kind(&stage.path, false)?;
    for suffix in ["-wal", "-shm", "-journal"] {
        let p = std::path::PathBuf::from(format!("{}{suffix}", stage.path.display()));
        if p.symlink_metadata().is_ok() {
            root::require_kind(&p, false)?;
        }
    }
    let db = Connection::open_with_flags(&stage.path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    configure(&db, cancel)?;
    Ok(db)
}
fn validate_schema(db: &Connection, has_altitude: bool) -> Result<()> {
    if db.query_row("PRAGMA quick_check(1)", [], |r| r.get::<_, String>(0))? != "ok" {
        return Err(Error::Corrupt);
    }
    let expected = Connection::open_in_memory()?;
    expected.execute_batch(SESSION_SCHEMA)?;
    if has_altitude {
        expected.execute_batch(LOCATION_ALTITUDE_SCHEMA)?;
    }
    expected.execute_batch(META)?;
    fn schema(db: &Connection) -> Result<Vec<(String, String, String)>> {
        let mut s=db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name LIMIT 65")?;
        let mut rows = s.query([])?;
        let mut output = Vec::new();
        while let Some(r) = rows.next()? {
            if output.len() == 64 {
                return Err(Error::InvalidInput);
            }
            let sql = r.get_ref(2)?.as_str().map_err(|_| Error::InvalidInput)?;
            if sql.len() > 32768 {
                return Err(Error::InvalidInput);
            }
            let mut quoted = None;
            let normalized: String = sql
                .chars()
                .filter_map(|c| {
                    if let Some(q) = quoted {
                        if c == q {
                            quoted = None;
                        }
                        Some(c)
                    } else if matches!(c, '\'' | '"' | '`') {
                        quoted = Some(c);
                        Some(c)
                    } else if c.is_whitespace() {
                        None
                    } else {
                        Some(c.to_ascii_lowercase())
                    }
                })
                .collect();
            output.push((r.get(0)?, r.get(1)?, normalized));
        }
        Ok(output)
    }
    if schema(db)? != schema(&expected)? {
        return Err(Error::InvalidInput);
    }
    Ok(())
}

#[cfg(test)]
mod export_name_tests {
    use super::*;

    #[test]
    fn board_names_are_bounded_lowercase_and_path_safe() {
        for (name, expected) in [
            ("My Board", "my_board"),
            ("  GT / Street: Board?!  ", "gt_street_board"),
            ("../A\\B\r\n\"C.zip", "a_b_c_zip"),
            ("Éclair 🛹", "clair"),
            ("_?! 🛹", "board"),
            ("", "board"),
        ] {
            assert_eq!(export_name_prefix(name), expected);
        }
        assert_eq!(export_name_prefix(&"A".repeat(128)), "a".repeat(64));
        assert_eq!(
            export_name_prefix(&format!("{} B", "A".repeat(63))),
            "a".repeat(63)
        );
    }

    #[test]
    fn timestamps_use_utc_calendar_dates_and_preserve_extreme_values() {
        let db = Connection::open_in_memory().unwrap();
        for (ms, expected) in [
            (0, "1970-01-01_00-00-00Z"),
            (1_709_251_199_999, "2024-02-29_23-59-59Z"),
            (1_709_251_200_000, "2024-03-01_00-00-00Z"),
            (i64::MAX, "unix-ms-9223372036854775807"),
        ] {
            assert_eq!(export_timestamp(&db, ms).unwrap(), expected);
        }
    }
}

fn attach_session_row(
    tx: &Connection,
    id: &str,
    job: &str,
    file: &str,
    m: &Manifest,
    marker: &CommitMarker,
) -> Result<()> {
    boards::import_board_on(
        tx,
        &m.device_history_id,
        Some(&m.device_snapshot.display_name),
        &json(&m.board_profile_snapshot, limits::MAX_PROFILE_BYTES)?,
        m.started_at_ms,
    )?;
    tx.execute("INSERT INTO session_catalog(session_id,job_id,device_history_id,device_snapshot_json,profile_snapshot_json,profile_revision,file_name,started_at_ms,ended_at_ms,state,integrity,requested_idle_ms,effective_idle_ms,requested_riding_ms,effective_riding_ms,close_reason) VALUES(?,?,?,?,?,?,?,?,?,'completed','complete',?,?,?,?,?)",params![id,job,m.device_history_id,json(&m.device_snapshot,limits::MAX_PROFILE_BYTES)?,json(&m.board_profile_snapshot,limits::MAX_PROFILE_BYTES)?,m.board_profile_revision,file,m.started_at_ms,m.ended_at_ms,m.requested_idle_ms,m.effective_idle_ms,m.requested_riding_ms,m.effective_riding_ms,m.close_reason])?;
    crate::sessions::apply_marker(tx, id, marker)?;
    Ok(())
}

#[cfg(test)]
mod disk_admission_tests {
    use super::*;
    #[test]
    fn insufficient_space_is_rejected_at_the_estimated_boundary() {
        assert_eq!(check_export_space(99, 100), Err(Error::Full));
        assert_eq!(check_export_space(100, 100), Ok(()));
        assert_eq!(check_export_space(101, 100), Ok(()));
    }
}
