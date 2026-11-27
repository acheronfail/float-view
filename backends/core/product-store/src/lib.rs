//! Portable product persistence. Native hosts supply a prepared private root.
#![forbid(unsafe_code)]

use rusqlite::Connection;
use std::path::{Path, PathBuf};

mod appearance;
mod archive;
pub use appearance::BoardAppearance;
pub mod battery_catalog;
pub mod battery_presets;
mod boards;
mod csv;
mod dashboard;
mod files;
pub use archive::{
    AppImport, AppImportSummary, ArchiveExport, ArchiveImport, BoardExport, ExportFormat,
};
pub use files::{FileCancellation, ImportSink, StagedFile};
mod cache;
mod lifecycle;
mod ride;
pub use ride::RideCheckpoint;
mod maintenance;
pub use maintenance::{
    Maintenance, MaintenanceCancellation, MaintenanceCompletion, MaintenanceWork,
};
pub mod limits;
mod root;
mod sessions;
pub use lifecycle::SessionLease;
mod settings;
pub use sessions::{Session, SessionPage};
mod refloat_drafts;
mod tunes;
pub use boards::{Board, BoardHistory, Profile, RoutingHint, board_identity};
pub use cache::SchemaIdentity;
pub use refloat_drafts::{RefloatEditorDraft, RefloatEditorPosition};
pub use settings::{AnnouncementSettings, SessionDisplayOptions, Settings};
pub use tunes::{
    Tune, TuneIdentity, TunePage, TuneValue, TuneValues, is_tune_field, validate_tune_values,
};

pub const STORAGE_VERSION: &str = "102";
pub const CATALOG_SCHEMA: &str = include_str!("../../../sql/catalog.sql");

/// Errors intentionally exclude SQL, paths, identifiers and other private data.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    InvalidInput,
    Cancelled,
    ActiveSession,
    UnassociatedBoard,
    NotFound,
    Conflict { revision: u64 },
    Capacity,
    Busy,
    Full,
    Corrupt,
    UnsafePath,
    UnsupportedStorage,
    Io,
    Database,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for Error {}
impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        if error.kind() == std::io::ErrorKind::StorageFull {
            Self::Full
        } else {
            Self::Io
        }
    }
}
impl From<rusqlite::Error> for Error {
    fn from(value: rusqlite::Error) -> Self {
        use rusqlite::ffi::ErrorCode;
        match value.sqlite_error_code() {
            Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => Self::Busy,
            Some(ErrorCode::DiskFull) => Self::Full,
            Some(ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase) => Self::Corrupt,
            Some(ErrorCode::CannotOpen | ErrorCode::SystemIoFailure | ErrorCode::ReadOnly) => {
                Self::Io
            }
            _ => Self::Database,
        }
    }
}
pub type Result<T> = std::result::Result<T, Error>;

/// One ordered catalog owner. Long session operations use independent readers.
pub struct ProductStore {
    root: PathBuf,
    root_lock: crate::root::RootLock,
    catalog: Connection,
    catalog_revision: u64,
    cursor_epoch: String,
    leases: lifecycle::Leases,
    file_budget: files::FileBudgets,
}
impl ProductStore {
    pub fn open(root: &Path) -> Result<Self> {
        let (root, root_lock) = root::prepare(root)?;
        let fresh = !root.join("catalog.sqlite").try_exists()?;
        let catalog = Connection::open(root.join("catalog.sqlite"))?;
        catalog.busy_timeout(std::time::Duration::from_millis(limits::SQLITE_BUSY_MS))?;
        catalog.pragma_update(None, "trusted_schema", false)?;
        root::upgrade_baseline(&root, &catalog, fresh)?;
        // Validate existing storage before CREATE IF NOT EXISTS can mask drift.
        root::validate_catalog(&catalog, fresh)?;
        catalog.execute_batch(CATALOG_SCHEMA)?;
        root::validate_catalog(&catalog, false)?;
        root::publish_altitude_storage_version(&root)?;
        let mut store = Self {
            root,
            root_lock,
            catalog,
            catalog_revision: 0,
            cursor_epoch: identifier()?,
            leases: std::sync::Arc::default(),
            file_budget: std::sync::Arc::default(),
        };
        store.cleanup_staging()?;
        store.initialize_settings()?;
        store.recover()?;
        store.cleanup_orphan_sessions()?;
        Ok(store)
    }
    /// Only host-prepared app-private storage is exposed to shared composition.
    pub fn root(&self) -> &Path {
        &self.root
    }
}

pub(crate) fn identifier() -> Result<String> {
    let mut bytes = [0; 16];
    getrandom::fill(&mut bytes).map_err(|_| Error::Io)?;
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    Ok(format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    ))
}
pub(crate) fn json(value: &impl serde::Serialize, max: usize) -> Result<String> {
    // Inputs are already bounded models or bounded parsed objects.
    let result = serde_json::to_string(value).map_err(|_| Error::InvalidInput)?;
    if result.len() > max {
        return Err(Error::InvalidInput);
    }
    Ok(result)
}
pub(crate) fn object(text: &str, max: usize) -> Result<serde_json::Map<String, serde_json::Value>> {
    if text.len() > max {
        return Err(Error::InvalidInput);
    }
    serde_json::from_str(text).map_err(|_| Error::InvalidInput)
}
pub(crate) fn next_revision(revision: u64) -> Result<u64> {
    revision
        .checked_add(1)
        .filter(|r| *r <= limits::MAX_REVISION)
        .ok_or(Error::Capacity)
}
