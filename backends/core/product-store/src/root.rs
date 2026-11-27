use crate::{CATALOG_SCHEMA, Error, Result, STORAGE_VERSION, limits};
use rusqlite::Connection;
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

pub(crate) type RootLock = std::sync::Arc<std::sync::Mutex<Connection>>;

pub(crate) fn prepare(root: &Path) -> Result<(PathBuf, RootLock)> {
    if !root.is_absolute() || root.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(Error::UnsafePath);
    }
    let name = root.file_name().ok_or(Error::UnsafePath)?;
    // Parent is supplied by trusted native startup; permit system aliases such
    // as macOS /var, but never follow symlinks within the owned root.
    let parent = root.parent().ok_or(Error::UnsafePath)?.canonicalize()?;
    let root = parent.join(name);
    if root.exists() || root.symlink_metadata().is_ok() {
        require_kind(&root, true)?;
    } else {
        fs::create_dir(&root)?;
    }
    validate_root_entries(&root)?;
    // Reject unsupported roots before even creating the coordination database.
    inspect_storage(&root)?;
    let lock_path = root.join(".service.lock");
    if lock_path.symlink_metadata().is_ok() {
        require_kind(&lock_path, false)?;
    }
    // SQLite's platform VFS supplies process-safe locking on every target,
    // including Android where std::fs::File::try_lock is unsupported. Keep
    // the exclusive transaction alive through every reader and staged lease.
    // No product data is written into this dedicated lock database.
    for suffix in ["-journal", "-wal", "-shm"] {
        let path = root.join(format!(".service.lock{suffix}"));
        if path.symlink_metadata().is_ok() {
            require_kind(&path, false)?;
        }
    }
    let lock = Connection::open(&lock_path)?;
    require_kind(&lock_path, false)?;
    lock.busy_timeout(std::time::Duration::ZERO)?;
    lock.execute_batch("PRAGMA trusted_schema=OFF; BEGIN EXCLUSIVE")?;
    validate_root_entries(&root)?;
    // Recheck under the exclusive owner: another process may have initialized
    // the root between the read-only preflight and acquiring the lock.
    match inspect_storage(&root)? {
        StorageAction::Current => {}
        StorageAction::Initialize => write_marker(&root)?,
        StorageAction::ResetDevelopment => {
            // The old marker stays in place until every owned deletion finishes.
            // An interrupted reset can repeat; baseline 100 is never reset.
            visit_owned(&root, false)?;
            visit_owned(&root, true)?;
            write_marker(&root)?;
        }
    }
    Ok((root, std::sync::Arc::new(std::sync::Mutex::new(lock))))
}
fn validate_root_entries(root: &Path) -> Result<()> {
    for name in [
        "catalog.sqlite",
        "catalog.sqlite-wal",
        "catalog.sqlite-shm",
        "catalog.sqlite-journal",
        ".schema-version",
    ] {
        let path = root.join(name);
        if path.symlink_metadata().is_ok() {
            require_kind(&path, false)?;
        }
    }
    for name in ["Exports", "refloat-schema-cache"] {
        let path = root.join(name);
        if path.symlink_metadata().is_ok() {
            require_kind(&path, true)?;
        }
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum StorageAction {
    Current,
    Initialize,
    ResetDevelopment,
}

fn read_marker(path: &Path) -> Result<Option<String>> {
    if path.symlink_metadata().is_ok() {
        require_kind(path, false)?;
    }
    match fs::File::open(path) {
        Ok(file) => {
            require_kind(path, false)?;
            let mut bytes = Vec::new();
            file.take(65).read_to_end(&mut bytes)?;
            if bytes.len() > 64 {
                return Err(Error::UnsupportedStorage);
            }
            String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| Error::UnsupportedStorage)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // A dangling marker symlink is not an empty/new root.
            if path.symlink_metadata().is_ok() {
                return Err(Error::UnsafePath);
            }
            Ok(None)
        }
        Err(e) => Err(e.into()),
    }
}

fn inspect_storage(root: &Path) -> Result<StorageAction> {
    let marker = root.join(".schema-version");
    if marker.symlink_metadata().is_ok() {
        require_kind(&marker, false)?;
    }
    let text = read_marker(&marker)?;
    match text.as_deref().map(str::trim) {
        Some(STORAGE_VERSION | "101" | "100") => {
            // A missing catalog beside recordings is corruption, not a new root.
            if !root.join("catalog.sqlite").try_exists()? && !initialization_only(root, true)? {
                return Err(Error::Corrupt);
            }
            Ok(StorageAction::Current)
        }
        // Exact markers found in shared product-store Git history. Do not use a
        // numeric range: future or unrecognised formats never authorize erasure.
        Some(
            "12" | "13" | "14" | "15" | "17" | "18" | "19" | "20" | "21" | "22" | "23" | "24"
            | "25" | "26",
        ) => {
            visit_owned(root, false)?;
            Ok(StorageAction::ResetDevelopment)
        }
        None if initialization_only(root, false)? => Ok(StorageAction::Initialize),
        _ => Err(Error::UnsupportedStorage),
    }
}

fn initialization_only(root: &Path, marked: bool) -> Result<bool> {
    for (i, entry) in fs::read_dir(root)?.enumerate() {
        if i >= limits::MAX_DIRECTORY_ENTRIES {
            return Err(Error::Capacity);
        }
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return Ok(false);
        };
        match name {
            ".service.lock"
            | ".service.lock-journal"
            | ".service.lock-wal"
            | ".service.lock-shm" => {
                require_kind(&entry.path(), false)?;
            }
            ".schema-version" if marked => {}
            ".schema-version.tmp" => {
                if !matches!(
                    read_marker(&entry.path())?.as_deref(),
                    Some(STORAGE_VERSION | "100")
                ) {
                    return Ok(false);
                }
            }
            _ => return Ok(false),
        }
    }
    Ok(true)
}

pub(crate) fn write_marker(root: &Path) -> Result<()> {
    let temporary = root.join(".schema-version.tmp");
    if temporary.symlink_metadata().is_ok() {
        require_kind(&temporary, false)?;
        fs::remove_file(&temporary)?;
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    std::io::Write::write_all(&mut file, STORAGE_VERSION.as_bytes())?;
    file.sync_all()?;
    fs::rename(temporary, root.join(".schema-version"))?;
    fs::File::open(root)?.sync_all()?;
    Ok(())
}

pub(crate) fn require_kind(path: &Path, directory: bool) -> Result<()> {
    let meta = path.symlink_metadata()?;
    if meta.file_type().is_symlink()
        || (directory && !meta.is_dir())
        || (!directory && !meta.is_file())
    {
        return Err(Error::UnsafePath);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if !directory && meta.nlink() != 1 {
            return Err(Error::UnsafePath);
        }
    }
    Ok(())
}
fn visit_owned(root: &Path, delete: bool) -> Result<()> {
    for (i, entry) in fs::read_dir(root)?.enumerate() {
        if i >= limits::MAX_DIRECTORY_ENTRIES {
            return Err(Error::Capacity);
        }
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let path = entry.path();
        if matches!(name, "Exports" | "refloat-schema-cache") {
            require_kind(&path, true)?;
            for (j, child) in fs::read_dir(&path)?.enumerate() {
                if j >= limits::MAX_DIRECTORY_ENTRIES {
                    return Err(Error::Capacity);
                }
                let child = child?.path();
                require_kind(&child, false)?;
                let child_name = child
                    .file_name()
                    .and_then(|s| s.to_str())
                    .ok_or(Error::UnsupportedStorage)?;
                let recognized = if name == "Exports" {
                    issued_file(child_name, "float-view-", ".tmp")
                } else {
                    let stem = child_name
                        .strip_suffix(".json")
                        .or_else(|| child_name.strip_suffix(".tmp"));
                    stem.is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
                };
                if !recognized {
                    return Err(Error::UnsupportedStorage);
                }
                if delete {
                    fs::remove_file(child)?;
                }
            }
            if delete {
                fs::remove_dir(path)?;
            }
        } else if owned_session_temporary(name)
            || matches!(
                name,
                "catalog.sqlite"
                    | "catalog.sqlite-wal"
                    | "catalog.sqlite-shm"
                    | "catalog.sqlite-journal"
                    | ".schema-version.tmp"
            )
            || issued_file(name, "session-", ".sqlite")
            || issued_file(name, "import-", ".floatview.tmp")
        {
            require_kind(&path, false)?;
            if delete {
                fs::remove_file(path)?;
            }
        } else if path.is_dir() || name.ends_with(".sqlite") || name.ends_with(".db") {
            return Err(Error::UnsupportedStorage);
        }
    }
    Ok(())
}
fn issued_file(name: &str, prefix: &str, suffix: &str) -> bool {
    let name = name
        .strip_suffix("-wal")
        .or_else(|| name.strip_suffix("-shm"))
        .or_else(|| name.strip_suffix("-journal"))
        .unwrap_or(name);
    name.strip_prefix(prefix)
        .and_then(|s| s.strip_suffix(suffix))
        .is_some_and(is_uuid)
}

pub(crate) fn is_uuid(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}

pub(crate) fn validate_catalog(catalog: &Connection, fresh: bool) -> Result<()> {
    if catalog.query_row("PRAGMA quick_check(1)", [], |r| r.get::<_, String>(0))? != "ok" {
        return Err(Error::Corrupt);
    }
    validate_catalog_shape(catalog, fresh, false)
}
fn validate_catalog_shape(catalog: &Connection, fresh: bool, baseline: bool) -> Result<()> {
    let expected = Connection::open_in_memory()?;
    expected.execute_batch(CATALOG_SCHEMA)?;
    if baseline {
        expected.execute_batch("DROP TABLE ride_checkpoint")?;
    }
    fn schema(db: &Connection) -> Result<Vec<(String, String, String)>> {
        let mut statement = db.prepare("SELECT type,name,COALESCE(sql,'') FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name LIMIT 65")?;
        let rows = statement
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        if rows.len() > 64 {
            return Err(Error::Corrupt);
        }
        Ok(rows)
    }
    let actual = schema(catalog)?;
    if !(fresh && actual.is_empty()) && actual != schema(&expected)? {
        return Err(Error::Corrupt);
    }
    Ok(())
}

// SessionWriter's unpublished SQLite files and their sidecars are disposable
// after the exclusive root owner has been acquired. Match only issued names.
pub(crate) fn owned_session_temporary(name: &str) -> bool {
    let base = name
        .strip_suffix("-wal")
        .or_else(|| name.strip_suffix("-shm"))
        .or_else(|| name.strip_suffix("-journal"))
        .unwrap_or(name);
    let Some(base) = base
        .strip_prefix(".session-")
        .and_then(|s| s.strip_suffix(".tmp"))
    else {
        return false;
    };
    let Some((id, sequence)) = base.split_once(".sqlite.float-view-") else {
        return false;
    };
    if !is_uuid(id) {
        return false;
    }
    let Some((pid, sequence)) = sequence.split_once('.') else {
        return false;
    };
    !pid.is_empty()
        && !sequence.is_empty()
        && pid.bytes().all(|b| b.is_ascii_digit())
        && sequence.bytes().all(|b| b.is_ascii_digit())
}

/// Baseline 100 adds catalog ownership before marker publication.
/// An interrupted marker publication accepts only the exact committed new schema.
pub(crate) fn upgrade_baseline(root: &Path, catalog: &Connection, fresh: bool) -> Result<()> {
    if read_marker(&root.join(".schema-version"))?
        .as_deref()
        .map(str::trim)
        != Some("100")
    {
        return Ok(());
    }
    if !fresh && validate_catalog(catalog, false).is_err() {
        if catalog.query_row("PRAGMA quick_check(1)", [], |r| r.get::<_, String>(0))? != "ok" {
            return Err(Error::Corrupt);
        }
        validate_catalog_shape(catalog, false, true)?;
        catalog.execute_batch("BEGIN IMMEDIATE")?;
        let start = CATALOG_SCHEMA
            .find("CREATE TABLE IF NOT EXISTS ride_checkpoint")
            .ok_or(Error::Corrupt)?;
        let result = catalog.execute_batch(&CATALOG_SCHEMA[start..]);
        if let Err(error) = result {
            let _ = catalog.execute_batch("ROLLBACK");
            return Err(error.into());
        }
        catalog.execute_batch("COMMIT")?;
    }
    Ok(())
}

pub(crate) fn publish_altitude_storage_version(root: &Path) -> Result<()> {
    if matches!(
        read_marker(&root.join(".schema-version"))?
            .as_deref()
            .map(str::trim),
        Some("100" | "101")
    ) {
        write_marker(root)?;
    }
    Ok(())
}
