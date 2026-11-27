use float_view_product_store::{
    Error, ProductStore, RoutingHint, Settings, board_identity, limits,
};
use rusqlite::Connection;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);

#[test]
fn board_appearance_is_optional_isolated_validated_and_durable() {
    use float_view_product_store::BoardAppearance;
    let root = Root::new();
    let mut store = root.open();
    let first = store
        .ensure_board("first", Some("First"), Some(&[1; 12]), 1)
        .unwrap();
    let second = store
        .ensure_board("second", Some("Second"), Some(&[2; 12]), 1)
        .unwrap();
    assert_eq!(
        store.profile(&first.saved_device_id).unwrap().appearance(),
        BoardAppearance::default()
    );
    let appearance = BoardAppearance {
        rail: 6,
        hooks: 3,
        left_top: "#ed5555".into(),
        ..BoardAppearance::default()
    };
    let patch = serde_json::json!({"appearance":appearance}).to_string();
    store
        .update_profile(&first.saved_device_id, 0, &patch, 2)
        .unwrap();
    for field in ["rail", "hooks", "rim"] {
        let mut bad = serde_json::to_value(&appearance).unwrap();
        bad[field] = serde_json::json!("invalid");
        assert_eq!(
            store.update_profile(
                &first.saved_device_id,
                1,
                &serde_json::json!({"appearance":bad}).to_string(),
                3
            ),
            Err(Error::InvalidInput)
        );
    }
    assert_eq!(store.profile(&first.saved_device_id).unwrap().revision, 1);
    assert_eq!(
        store.profile(&second.saved_device_id).unwrap().appearance(),
        BoardAppearance::default()
    );
    drop(store);
    let mut store = root.open();
    assert_eq!(
        store.profile(&first.saved_device_id).unwrap().appearance(),
        appearance
    );
    assert_eq!(
        store.update_profile(&first.saved_device_id, 0, &patch, 4),
        Err(Error::Conflict { revision: 1 })
    );
    store
        .update_profile(&first.saved_device_id, 1, r#"{"appearance":null}"#, 5)
        .unwrap();
    assert_eq!(
        store.profile(&first.saved_device_id).unwrap().appearance(),
        BoardAppearance::default()
    );
}
struct Root(PathBuf);
impl Root {
    fn new() -> Self {
        let parent = std::env::temp_dir().canonicalize().unwrap();
        let path = parent.join(format!(
            "float-view-products-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn open(&self) -> ProductStore {
        ProductStore::open(&self.0).unwrap()
    }
}
impl Drop for Root {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn safety_acceptance_is_explicit_validated_and_durable() {
    let root = Root::new();
    let mut store = root.open();
    assert!(!store.settings().unwrap().safety_disclaimer_accepted);
    assert_eq!(
        store.update_settings(0, r#"{"safetyDisclaimerAccepted":"yes"}"#),
        Err(Error::InvalidInput)
    );
    assert_eq!(store.settings().unwrap().revision, 0);
    let accepted = store
        .update_settings(0, r#"{"safetyDisclaimerAccepted":true}"#)
        .unwrap();
    assert!(accepted.safety_disclaimer_accepted);
    drop(store);
    assert_eq!(root.open().settings().unwrap(), accepted);
}

#[test]
fn current_storage_reopens_without_changing_revision_or_sql() {
    let root = Root::new();
    let mut store = root.open();
    assert_eq!(store.settings().unwrap(), Settings::default());
    let value = store
        .update_settings(
            0,
            r#"{"minimumSessionDistance":42,"locationRecordingEnabled":true}"#,
        )
        .unwrap();
    drop(store);
    assert_eq!(root.open().settings().unwrap(), value);
    assert_eq!(
        fs::read_to_string(root.0.join(".schema-version")).unwrap(),
        float_view_product_store::STORAGE_VERSION
    );
    let conn = Connection::open(root.0.join("catalog.sqlite")).unwrap();
    assert_eq!(
        conn.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "wal"
    );
}

#[test]
fn frozen_public_baseline_catalog_opens_and_preserves_user_settings() {
    let root = Root::new();
    fs::write(root.0.join(".schema-version"), "100").unwrap();
    fs::write(
        root.0.join("catalog.sqlite"),
        include_bytes!("../../../fixtures/public-baseline/100/catalog.sqlite"),
    )
    .unwrap();
    let mut store = root.open();
    let settings = store.settings().unwrap();
    assert_eq!(settings.minimum_session_distance, 42.);
    assert!(settings.safety_disclaimer_accepted);
    assert!(!settings.announcements.footpad_enabled);
    assert_eq!(settings.announcements.footpad_delay_seconds, 1);
    assert_eq!(store.boards().unwrap().len(), 1);
    let updated = store
        .update_settings(settings.revision, r#"{"minimumSessionDistance":100}"#)
        .unwrap();
    drop(store);
    assert_eq!(root.open().settings().unwrap(), updated);
}
#[test]
fn outdated_storage_resets_only_owned_files() {
    let root = Root::new();
    fs::write(root.0.join(".schema-version"), "12").unwrap();
    fs::write(root.0.join("catalog.sqlite"), "old database").unwrap();
    fs::write(
        root.0
            .join("session-00000000-0000-4000-8000-000000000001.sqlite"),
        "old session",
    )
    .unwrap();
    fs::write(root.0.join("personal-note.txt"), "keep").unwrap();
    let store = root.open();
    assert_eq!(store.settings().unwrap().revision, 0);
    assert!(
        !root
            .0
            .join("session-00000000-0000-4000-8000-000000000001.sqlite")
            .exists()
    );
    assert_eq!(
        fs::read_to_string(root.0.join("personal-note.txt")).unwrap(),
        "keep"
    );
}

#[test]
fn unknown_future_or_malformed_markers_preserve_every_file() {
    for marker in [
        b"0".as_slice(),
        b"11",
        b"16",
        b"27",
        b"99",
        b"999999",
        b"garbage",
        b"100\nx",
        &[255],
        &[b'1'; 65],
    ] {
        let root = Root::new();
        fs::write(root.0.join(".schema-version"), marker).unwrap();
        fs::write(root.0.join("catalog.sqlite"), b"private catalog").unwrap();
        fs::write(root.0.join("session-private.sqlite"), b"private recording").unwrap();
        assert!(
            matches!(ProductStore::open(&root.0), Err(Error::UnsupportedStorage)),
            "marker: {marker:?}"
        );
        assert_eq!(fs::read(root.0.join(".schema-version")).unwrap(), marker);
        assert_eq!(
            fs::read(root.0.join("catalog.sqlite")).unwrap(),
            b"private catalog"
        );
        assert_eq!(
            fs::read(root.0.join("session-private.sqlite")).unwrap(),
            b"private recording"
        );
        assert_eq!(fs::read_dir(&root.0).unwrap().count(), 3);
    }
}

#[test]
fn missing_marker_on_nonempty_storage_never_initializes_or_deletes() {
    let root = Root::new();
    fs::write(root.0.join("catalog.sqlite"), b"private catalog").unwrap();
    assert!(matches!(
        ProductStore::open(&root.0),
        Err(Error::UnsupportedStorage)
    ));
    assert_eq!(
        fs::read(root.0.join("catalog.sqlite")).unwrap(),
        b"private catalog"
    );
    assert_eq!(fs::read_dir(&root.0).unwrap().count(), 1);
}

#[test]
fn interrupted_development_reset_finishes_and_baseline_never_resets_again() {
    for marker in [
        "12", "13", "14", "15", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26",
    ] {
        let root = Root::new();
        let mut old = root.open();
        old.update_settings(0, r#"{"minimumSessionDistance":42}"#)
            .unwrap();
        old.ensure_board("old board", None, Some(&[3; 12]), 1)
            .unwrap();
        drop(old);
        fs::write(root.0.join(".schema-version"), marker).unwrap();
        fs::write(root.0.join(".schema-version.tmp"), "100").unwrap();
        fs::write(
            root.0
                .join("session-00000000-0000-4000-8000-000000000001.sqlite-journal"),
            "old journal",
        )
        .unwrap();
        let mut fresh = root.open();
        assert_eq!(fresh.settings().unwrap(), Settings::default());
        assert!(
            !root
                .0
                .join("session-00000000-0000-4000-8000-000000000001.sqlite-journal")
                .exists()
        );
        assert!(!root.0.join(".schema-version.tmp").exists());
        let value = fresh
            .update_settings(0, r#"{"minimumSessionDistance":75}"#)
            .unwrap();
        drop(fresh);
        assert_eq!(root.open().settings().unwrap(), value);
        assert_eq!(
            fs::read_to_string(root.0.join(".schema-version")).unwrap(),
            float_view_product_store::STORAGE_VERSION
        );
    }
    // No catalog remains after interruption, but the old marker still authorizes completion.
    let root = Root::new();
    fs::write(root.0.join(".schema-version"), "26").unwrap();
    fs::write(
        root.0
            .join("session-00000000-0000-4000-8000-000000000002.sqlite"),
        "old",
    )
    .unwrap();
    drop(root.open());
    assert!(
        !root
            .0
            .join("session-00000000-0000-4000-8000-000000000002.sqlite")
            .exists()
    );
}

#[test]
fn unknown_development_layout_and_missing_baseline_catalog_are_preserved() {
    let root = Root::new();
    fs::write(root.0.join(".schema-version"), "26").unwrap();
    fs::write(root.0.join("catalog.sqlite"), "old catalog").unwrap();
    fs::write(root.0.join("unrecognised.sqlite"), "keep").unwrap();
    assert!(matches!(
        ProductStore::open(&root.0),
        Err(Error::UnsupportedStorage)
    ));
    assert_eq!(
        fs::read_to_string(root.0.join("catalog.sqlite")).unwrap(),
        "old catalog"
    );
    assert_eq!(
        fs::read_to_string(root.0.join("unrecognised.sqlite")).unwrap(),
        "keep"
    );
    let root = Root::new();
    fs::write(root.0.join(".schema-version"), "100").unwrap();
    fs::write(
        root.0
            .join("session-00000000-0000-4000-8000-000000000003.sqlite"),
        "recording",
    )
    .unwrap();
    assert!(matches!(ProductStore::open(&root.0), Err(Error::Corrupt)));
    assert_eq!(
        fs::read_to_string(
            root.0
                .join("session-00000000-0000-4000-8000-000000000003.sqlite")
        )
        .unwrap(),
        "recording"
    );
    assert!(!root.0.join("catalog.sqlite").exists());
}

#[test]
fn interrupted_empty_initialization_retries_without_a_version_reset() {
    let root = Root::new();
    fs::write(root.0.join(".schema-version.tmp"), "100").unwrap();
    drop(root.open());
    assert_eq!(
        fs::read_to_string(root.0.join(".schema-version")).unwrap(),
        float_view_product_store::STORAGE_VERSION
    );
    assert!(!root.0.join(".schema-version.tmp").exists());
}
#[test]
fn ordinary_corruption_and_schema_drift_never_reset() {
    let root = Root::new();
    drop(root.open());
    fs::write(root.0.join("catalog.sqlite"), "corruption").unwrap();
    assert!(matches!(ProductStore::open(&root.0), Err(Error::Corrupt)));
    assert_eq!(
        fs::read(root.0.join("catalog.sqlite")).unwrap(),
        b"corruption"
    );
    let root = Root::new();
    drop(root.open());
    let conn = Connection::open(root.0.join("catalog.sqlite")).unwrap();
    conn.execute_batch("CREATE TABLE unexpected(private TEXT)")
        .unwrap();
    drop(conn);
    assert!(matches!(ProductStore::open(&root.0), Err(Error::Corrupt)));
    assert_eq!(
        fs::read_to_string(root.0.join(".schema-version")).unwrap(),
        float_view_product_store::STORAGE_VERSION
    );
}
#[test]
fn unavailable_or_escaping_root_fails_without_creating_parent() {
    let root = Root::new();
    assert!(ProductStore::open(&root.0.join("missing/child")).is_err());
    assert!(!root.0.join("missing").exists());
    assert!(matches!(
        ProductStore::open(&root.0.join("../escape")),
        Err(Error::UnsafePath)
    ));
    assert!(matches!(
        ProductStore::open(std::path::Path::new("relative")),
        Err(Error::UnsafePath)
    ));
    fs::write(root.0.join("file"), "not a directory").unwrap();
    assert!(matches!(
        ProductStore::open(&root.0.join("file")),
        Err(Error::UnsafePath)
    ));
}
#[cfg(unix)]
#[test]
fn symlinks_and_hardlinks_never_authorize_reset_or_catalog_access() {
    use std::os::unix::fs::symlink;
    let root = Root::new();
    let outside = Root::new();
    let secret = outside.0.join("secret");
    fs::write(&secret, "keep").unwrap();
    symlink(&secret, root.0.join("catalog.sqlite")).unwrap();
    assert!(matches!(
        ProductStore::open(&root.0),
        Err(Error::UnsafePath)
    ));
    assert_eq!(fs::read_to_string(&secret).unwrap(), "keep");
    fs::remove_file(root.0.join("catalog.sqlite")).unwrap();
    fs::hard_link(&secret, root.0.join("catalog.sqlite")).unwrap();
    assert!(matches!(
        ProductStore::open(&root.0),
        Err(Error::UnsafePath)
    ));
    let parent = Root::new();
    symlink(&outside.0, parent.0.join("alias")).unwrap();
    assert!(matches!(
        ProductStore::open(&parent.0.join("alias")),
        Err(Error::UnsafePath)
    ));
    fs::remove_file(root.0.join("catalog.sqlite")).unwrap();
    fs::write(root.0.join(".schema-version"), "26").unwrap();
    fs::create_dir(root.0.join("Exports")).unwrap();
    symlink(&secret, root.0.join("Exports/export.csv")).unwrap();
    fs::write(
        root.0
            .join("session-00000000-0000-4000-8000-000000000003.sqlite"),
        "not deleted before validation",
    )
    .unwrap();
    assert!(matches!(
        ProductStore::open(&root.0),
        Err(Error::UnsafePath)
    ));
    assert!(
        root.0
            .join("session-00000000-0000-4000-8000-000000000003.sqlite")
            .exists()
    );
}
#[test]
fn accent_presets_validate_and_survive_reopening() {
    let root = Root::new();
    let mut store = root.open();
    assert_eq!(store.settings().unwrap().accent_preference, "teal");
    for (revision, accent) in ["purple", "blue", "teal", "amber", "rose"]
        .iter()
        .enumerate()
    {
        let updated = store
            .update_settings(
                revision as u64,
                &format!(r#"{{"accentPreference":"{accent}"}}"#),
            )
            .unwrap();
        assert_eq!(updated.accent_preference, *accent);
    }
    // Changing the default must not rewrite an explicitly saved purple choice.
    store
        .update_settings(5, r#"{"accentPreference":"purple"}"#)
        .unwrap();
    drop(store);
    let mut store = root.open();
    assert_eq!(store.settings().unwrap().accent_preference, "purple");
    store
        .update_settings(6, r#"{"accentPreference":"rose"}"#)
        .unwrap();
    for invalid in [
        r#"{"accentPreference":"orange"}"#,
        r#"{"accentPreference":null}"#,
        r#"{"accentPreference":1}"#,
    ] {
        assert_eq!(store.update_settings(7, invalid), Err(Error::InvalidInput));
        assert_eq!(store.settings().unwrap().revision, 7);
    }
    drop(store);
    assert_eq!(root.open().settings().unwrap().accent_preference, "rose");
}

#[test]
fn settings_validate_atomically_and_cas_across_connections() {
    let root = Root::new();
    let mut a = root.open();
    assert!(matches!(ProductStore::open(&root.0), Err(Error::Busy)));
    let first=a.update_settings(0,r#"{"idleProbeIntervalMs":-1,"ridingPersistIntervalMs":100000,"historyGapThresholdSeconds":0.01}"#).unwrap();
    assert_eq!(
        (
            first.idle_probe_interval_ms,
            first.riding_persist_interval_ms,
            first.history_gap_threshold_seconds
        ),
        (100, 10_000, Some(0.1))
    );
    assert_eq!(
        a.update_settings(0, "{}"),
        Err(Error::Conflict { revision: 1 })
    );
    for invalid in [
        r#"{"idleProbeIntervalMs":true}"#,
        r#"{"idleProbeIntervalMs":1.5}"#,
        r#"{"revision":3}"#,
        r#"{"themePreference":"auto"}"#,
        r#"{"minimumSessionDistance":null}"#,
        r#"{"locationRecordingEnabled":1}"#,
        r#"{"idleProbeIntervalMs":500,"unknown":true}"#,
    ] {
        assert_eq!(a.update_settings(1, invalid), Err(Error::InvalidInput));
        assert_eq!(a.settings().unwrap(), first);
    }
    let large = format!(
        "{{\"unknown\":\"{}\"}}",
        "x".repeat(limits::MAX_SETTINGS_BYTES)
    );
    assert_eq!(a.update_settings(1, &large), Err(Error::InvalidInput));
    assert_eq!(
        a.update_settings(1, r#"{"historyGapThresholdSeconds":null}"#)
            .unwrap()
            .revision,
        2
    );
    let external = Connection::open(root.0.join("catalog.sqlite")).unwrap();
    external
        .execute("UPDATE settings SET revision=3", [])
        .unwrap();
    assert_eq!(
        a.update_settings(2, "{}"),
        Err(Error::Conflict { revision: 3 })
    );
}
#[test]
fn sql_revision_is_authoritative_no_legacy_json_fallback() {
    let root = Root::new();
    drop(root.open());
    let conn = Connection::open(root.0.join("catalog.sqlite")).unwrap();
    conn.execute("UPDATE settings SET revision=7", []).unwrap();
    drop(conn);
    let mut store = root.open();
    assert_eq!(store.settings().unwrap().revision, 7);
    assert_eq!(store.update_settings(7, "{}").unwrap().revision, 8);
}
#[test]
fn canonical_identity_vectors_and_absent_identity() {
    let uuid: Vec<u8> = (1..=12).collect();
    assert_eq!(
        board_identity(Some(&uuid)).unwrap(),
        "vesc-v1-3ad3f33d03efba4de40aeb78f4513d6b5480595764b3a9e46dcc694025fa28ec"
    );
    for uuid in [
        None,
        Some([0u8; 12].as_slice()),
        Some([255u8; 12].as_slice()),
        Some([1u8; 11].as_slice()),
    ] {
        assert_eq!(board_identity(uuid), None);
    }
}
#[test]
fn imported_board_associates_on_explicit_save_without_leaking_private_identifiers() {
    let root = Root::new();
    let mut store = root.open();
    let uuid: Vec<u8> = (1..=12).collect();
    let identity = board_identity(Some(&uuid)).unwrap();
    let imported = store
        .import_board(
            &identity,
            Some(" Import "),
            r#"{"motor":"hub","seriesCount":16,"parallelCount":2}"#,
            1,
        )
        .unwrap();
    assert_eq!(imported.local_identifier, None);
    assert_eq!(imported.display_name(), "Import");
    let saved = store
        .ensure_board("private-platform-address", Some("BLE"), Some(&uuid), 2)
        .unwrap();
    assert_eq!(saved.saved_device_id, imported.saved_device_id);
    assert_eq!(saved.last_seen_at_ms, Some(2));
    assert_eq!(store.boards().unwrap().len(), 1);
    let serialized = serde_json::to_string(&saved).unwrap();
    assert!(!serialized.contains("private-platform-address"));
    assert!(!serialized.contains("0102030405060708090a0b0c"));
    assert!(
        store
            .profile(&saved.saved_device_id)
            .unwrap()
            .missing_fields()
            .is_empty()
    );
}
#[test]
fn revisions_names_profiles_and_route_invalidation_are_atomic() {
    let root = Root::new();
    let mut store = root.open();
    let b = store
        .ensure_board("local", None, Some(&[1; 12]), 1)
        .unwrap();
    let id = &b.saved_device_id;
    assert_eq!(
        store.profile(id).unwrap().missing_fields(),
        ["seriesCount", "parallelCount", "motor"]
    );
    store.update_board(id, 0, Some(&"a".repeat(128))).unwrap();
    assert_eq!(
        store.update_board(id, 1, Some(&"é".repeat(65))),
        Err(Error::InvalidInput)
    );
    assert_eq!(
        store.update_board(id, 0, None),
        Err(Error::Conflict { revision: 1 })
    );
    assert_eq!(
        store
            .update_board(id, 1, Some("   "))
            .unwrap()
            .custom_display_name,
        None
    );
    let hint = RoutingHint {
        can_id: 42,
        controller_uuid: Some([1; 12]),
    };
    store.set_routing_hint(id, Some(&hint), 1).unwrap();
    assert_eq!(store.routing_hint(id).unwrap(), Some(hint.clone()));
    assert_eq!(
        store.update_profile(id, 0, r#"{"seriesCount":true,"preferredCanId":42}"#, 2),
        Err(Error::InvalidInput)
    );
    assert_eq!(store.routing_hint(id).unwrap(), Some(hint));
    let p = store
        .update_profile(
            id,
            0,
            r#"{"seriesCount":16,"parallelCount":2,"motor":"hub","preferredCanId":42}"#,
            2,
        )
        .unwrap();
    assert!(p.missing_fields().is_empty());
    assert!(store.routing_hint(id).unwrap().is_none());
    assert_eq!(
        store.update_profile(id, 0, "{}", 3),
        Err(Error::Conflict { revision: 1 })
    );
    assert_eq!(
        store.update_profile(id, 1, r#"{"preferredCanId":254}"#, 3),
        Err(Error::InvalidInput)
    );
    assert_eq!(store.profile(id).unwrap(), p);
}
#[test]
fn board_capacity_is_checked_before_insertion_but_allows_existing_board() {
    let root = Root::new();
    let mut store = root.open();
    for i in 0..limits::MAX_BOARDS {
        store
            .ensure_board(&format!("local-{i}"), None, Some(&[i as u8 + 1; 12]), 1)
            .unwrap();
    }
    assert_eq!(
        store.ensure_board("overflow", None, Some(&[254; 12]), 1),
        Err(Error::Capacity)
    );
    store
        .ensure_board("local-0", Some("updated"), Some(&[1; 12]), 2)
        .unwrap();
    assert_eq!(store.boards().unwrap().len(), limits::MAX_BOARDS);
}
#[test]
fn catalog_lock_wait_is_bounded_and_failed_mutation_does_not_advance_revision() {
    let root = Root::new();
    let mut store = root.open();
    let other = Connection::open(root.0.join("catalog.sqlite")).unwrap();
    other.execute_batch("BEGIN IMMEDIATE").unwrap();
    let start = std::time::Instant::now();
    assert_eq!(store.update_settings(0, "{}"), Err(Error::Busy));
    assert!(start.elapsed() < std::time::Duration::from_secs(2));
    other.execute_batch("ROLLBACK").unwrap();
    assert_eq!(store.settings().unwrap().revision, 0);
}

#[test]
fn empty_existing_catalog_is_corruption_not_a_reset() {
    let root = Root::new();
    drop(root.open());
    fs::write(root.0.join("catalog.sqlite"), []).unwrap();
    assert!(matches!(ProductStore::open(&root.0), Err(Error::Corrupt)));
    assert_eq!(
        fs::metadata(root.0.join("catalog.sqlite")).unwrap().len(),
        0
    );
}
#[cfg(unix)]
#[test]
fn protected_root_is_reported_without_reset() {
    use std::os::unix::fs::PermissionsExt;
    let root = Root::new();
    drop(root.open());
    let path = root.0.join("catalog.sqlite");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o0)).unwrap();
    let result = ProductStore::open(&root.0);
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    assert!(matches!(result, Err(Error::Io)));
    assert_eq!(
        fs::read_to_string(root.0.join(".schema-version")).unwrap(),
        float_view_product_store::STORAGE_VERSION
    );
    assert_eq!(root.open().settings().unwrap(), Settings::default());
}
fn tune_fixture() -> (
    float_view_product_store::TuneIdentity,
    float_view_product_store::TuneValues,
    float_view_refloat_configuration_codec::ConfigurationSchema,
) {
    use float_view_product_store::*;
    use float_view_refloat_configuration_codec::*;
    let field = ConfigurationField {
        name: "gain".into(),
        long_name: "Gain".into(),
        field_type: FieldType::Integer,
        wire_type: Some(WireType::Uint8),
        default_value: ConfigurationValue::Integer(2),
        minimum: Some(0.),
        maximum: Some(10.),
        step: Some(1.),
        precision: None,
        editor_scale: 1.0,
        edit_as_percentage: false,
        scale: None,
        suffix: String::new(),
        choices: vec![],
        description: String::new(),
    };
    let excluded = ConfigurationField {
        name: "tiltback_duty".into(),
        long_name: "Duty Tiltback".into(),
        ..field.clone()
    };
    let hardware = ConfigurationField {
        name: "hardware.current_max".into(),
        long_name: "Hardware Current".into(),
        ..field.clone()
    };
    let schema = ConfigurationSchema {
        fingerprint: "a".repeat(64),
        wire_signature: 42,
        fields: vec![field, excluded, hardware],
        groups: vec![
            ConfigurationGroup {
                name: "General".into(),
                subgroups: vec![ConfigurationSubgroup {
                    name: "Tune".into(),
                    fields: vec!["gain".into(), "tiltback_duty".into()],
                }],
            },
            ConfigurationGroup {
                name: "Hardware".into(),
                subgroups: vec![ConfigurationSubgroup {
                    name: "Limits".into(),
                    fields: vec!["hardware.current_max".into()],
                }],
            },
        ],
    };
    let identity = TuneIdentity {
        package_name: "refloat".into(),
        package_version: "1.4.0".into(),
        schema_fingerprint: schema.fingerprint.clone(),
        wire_signature: schema.wire_signature,
    };
    (
        identity,
        [("gain".into(), TuneValue::Integer(2))].into(),
        schema,
    )
}
#[test]
fn tunes_require_exact_identity_portable_values_and_revision() {
    use float_view_product_store::*;
    let root = Root::new();
    let mut store = root.open();
    let (identity, values, schema) = tune_fixture();
    assert!(is_tune_field("gain", &schema));
    assert!(!is_tune_field("tiltback_duty", &schema));
    assert!(!is_tune_field("hardware.current_max", &schema));
    let tune = store
        .create_tune("Tune", None, &identity, &values, &schema, 1)
        .unwrap();
    assert_eq!(tune.revision, 1);
    assert_eq!(
        store.create_tune("Tune", None, &identity, &TuneValues::new(), &schema, 1),
        Err(Error::InvalidInput)
    );
    let wrong_values = [("gain".into(), TuneValue::Integer(11))].into();
    assert_eq!(
        store.create_tune("Tune", None, &identity, &wrong_values, &schema, 1),
        Err(Error::InvalidInput)
    );
    let mut wrong = identity.clone();
    wrong.wire_signature += 1;
    assert_eq!(
        store.create_tune("Tune", None, &wrong, &values, &schema, 1),
        Err(Error::InvalidInput)
    );
    assert_eq!(
        store.update_tune(&tune.configuration_id, 0, "new", None, &values, &schema, 2),
        Err(Error::Conflict { revision: 1 })
    );
    let updated = store
        .update_tune(
            &tune.configuration_id,
            1,
            &"é".repeat(64),
            Some(&"x".repeat(1024)),
            &values,
            &schema,
            2,
        )
        .unwrap();
    assert_eq!(updated.revision, 2);
    assert_eq!(
        store.create_tune(&"é".repeat(65), None, &identity, &values, &schema, 2),
        Err(Error::InvalidInput)
    );
    assert_eq!(
        store.delete_tune(&tune.configuration_id, 1),
        Err(Error::Conflict { revision: 2 })
    );
    store.delete_tune(&tune.configuration_id, 2).unwrap();
    assert_eq!(store.tune(&tune.configuration_id), Err(Error::NotFound));
}
#[test]
fn tune_keyset_cursor_binds_every_identity_component() {
    let root = Root::new();
    let mut store = root.open();
    let (identity, values, schema) = tune_fixture();
    for _ in 0..3 {
        store
            .create_tune("same time", None, &identity, &values, &schema, 1)
            .unwrap();
    }
    let first = store.tunes(&identity, 1, None).unwrap();
    let cursor = first.next_cursor.as_deref().unwrap();
    let second = store.tunes(&identity, 1, Some(cursor)).unwrap();
    assert_ne!(
        first.items[0].configuration_id,
        second.items[0].configuration_id
    );
    for part in 0..3 {
        let mut changed = identity.clone();
        match part {
            0 => changed.package_version = "other".into(),
            1 => changed.schema_fingerprint = "b".repeat(64),
            _ => changed.wire_signature += 1,
        };
        assert_eq!(
            store.tunes(&changed, 1, Some(cursor)),
            Err(Error::InvalidInput)
        );
    }
    assert_eq!(store.tunes(&identity, 51, None), Err(Error::InvalidInput));
    assert_eq!(
        store.tunes(&identity, 1, Some(&"a".repeat(513))),
        Err(Error::InvalidInput)
    );
}
fn cache_identity(version: &str) -> float_view_product_store::SchemaIdentity {
    float_view_product_store::SchemaIdentity {
        firmware_version: "6.05".into(),
        hardware_name: "controller".into(),
        package_version: version.into(),
        custom_index: 0,
        hardware_configuration_crc: 42,
    }
}
#[test]
fn cache_checks_size_digest_identity_and_bounded_eviction() {
    let root = Root::new();
    let mut store = root.open();
    let identity = cache_identity("1.4.0");
    let payload = vec![1; limits::MAX_SCHEMA_BYTES];
    store.store_schema(&identity, &payload).unwrap();
    assert_eq!(store.cached_schema(&identity).unwrap(), Some(payload));
    assert_eq!(
        store.store_schema(&identity, &vec![0; limits::MAX_SCHEMA_BYTES + 1]),
        Err(Error::InvalidInput)
    );
    let path = fs::read_dir(root.0.join("refloat-schema-cache"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let mut envelope: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    envelope["digest"] = "bad".into();
    fs::write(&path, serde_json::to_vec(&envelope).unwrap()).unwrap();
    assert_eq!(store.cached_schema(&identity).unwrap(), None);
    assert!(!path.exists());
    store.store_schema(&identity, &[1]).unwrap();
    let mut envelope: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    envelope["identity"]["hardwareName"] = "different".into();
    fs::write(&path, serde_json::to_vec(&envelope).unwrap()).unwrap();
    assert_eq!(store.cached_schema(&identity).unwrap(), None);
    for i in 0..10 {
        store
            .store_schema(&cache_identity(&format!("1.4.{i}")), &[1])
            .unwrap();
    }
    assert_eq!(
        fs::read_dir(root.0.join("refloat-schema-cache"))
            .unwrap()
            .count(),
        limits::MAX_SCHEMA_CACHE_ENTRIES
    );
    let mut disabled = identity;
    disabled.hardware_configuration_crc = 0;
    assert_eq!(store.cached_schema(&disabled).unwrap(), None);
}

#[test]
fn exclusive_root_owner_excludes_another_process_and_releases_on_exit() {
    const KEY: &str = "FLOAT_VIEW_TEST_LOCK_ROOT";
    if let Some(path) = std::env::var_os(KEY) {
        assert!(matches!(
            ProductStore::open(std::path::Path::new(&path)),
            Err(Error::Busy)
        ));
        return;
    }
    let root = Root::new();
    let owner = root.open();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "exclusive_root_owner_excludes_another_process_and_releases_on_exit",
        ])
        .env(KEY, &root.0)
        .status()
        .unwrap();
    assert!(status.success());
    drop(owner);
    assert!(ProductStore::open(&root.0).is_ok());
}

#[test]
fn crash_during_session_creation_removes_only_issued_temporary_names() {
    let root = Root::new();
    drop(root.open());
    let base = ".session-00112233-4455-6677-8899-aabbccddeeff.sqlite.float-view-12.3.tmp";
    for suffix in ["", "-wal", "-shm", "-journal"] {
        fs::write(
            root.0.join(format!("{base}{suffix}")),
            "interrupted creation",
        )
        .unwrap();
    }
    let unrelated = root.0.join(".session-personal.sqlite.float-view-12.3.tmp");
    fs::write(&unrelated, "keep").unwrap();
    drop(root.open());
    for suffix in ["", "-wal", "-shm", "-journal"] {
        assert!(!root.0.join(format!("{base}{suffix}")).exists());
    }
    assert_eq!(fs::read_to_string(unrelated).unwrap(), "keep");
}

#[test]
fn battery_profile_validation_boundaries_conflicts_and_reopen() {
    let root = Root::new();
    let mut store = root.open();
    let b = store
        .ensure_board("battery-board", None, Some(&[7; 12]), 1)
        .unwrap();
    let id = &b.saved_device_id;
    let original = store.profile(id).unwrap();
    for patch in [
        r#"{"batteryCellProfileId":"unknown"}"#,
        r#"{"batteryCellProfileId":4}"#,
        r#"{"batteryMinimumCellVoltageV":2.699}"#,
        r#"{"batteryMinimumCellVoltageV":4.2}"#,
        r#"{"batteryMinimumCellVoltageV":"NaN"}"#,
        r#"{"batteryMinimumCellVoltageV":1e999}"#,
    ] {
        assert!(
            store
                .update_profile(id, original.revision, patch, 2)
                .is_err()
        );
        assert_eq!(store.profile(id).unwrap(), original);
    }
    let mut revision = original.revision;
    for voltage in [2.7, 3., 4.199999] {
        let updated = store.update_profile(id, revision, &format!(r#"{{"batteryCellProfileId":"molicel-p45b","batteryMinimumCellVoltageV":{voltage}}}"#), 3).unwrap();
        assert_eq!(updated.missing_fields(), original.missing_fields());
        revision = updated.revision;
    }
    assert!(matches!(
        store.update_profile(id, 0, r#"{"batteryCellProfileId":"generic-linear"}"#, 4),
        Err(Error::Conflict { .. })
    ));
    let expected = store.profile(id).unwrap();
    drop(store);
    assert_eq!(root.open().profile(id).unwrap(), expected);
}

#[test]
fn preset_selection_is_atomic_and_overrides_survive_reopen_and_import() {
    let root = Root::new();
    let mut store = root.open();
    let b = store
        .ensure_board("preset", None, Some(&[9; 12]), 1)
        .unwrap();
    let id = &b.saved_device_id;
    let preset = "floatwheel-adv2-samsung-50s";
    let first = store
        .update_profile(
            id,
            0,
            &format!(r#"{{"batteryPresetId":"{preset}","motor":"keep"}}"#),
            2,
        )
        .unwrap();
    assert_eq!(first.values["seriesCount"], 20);
    assert_eq!(first.values["parallelCount"], 2);
    assert_eq!(first.values["batteryCapacityAh"], 10.);
    assert_eq!(first.values["batteryCellProfileId"], "samsung-50s");
    let lock = Connection::open(root.0.join("catalog.sqlite")).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    assert_eq!(
        store.update_profile(
            id,
            1,
            r#"{"batteryPresetId":"fungineers-funwheel-x7s-molicel-p30b"}"#,
            3
        ),
        Err(Error::Busy)
    );
    lock.execute_batch("ROLLBACK").unwrap();
    assert_eq!(store.profile(id).unwrap(), first);

    for patch in [
        r#"{"batteryPresetId":"unknown"}"#,
        r#"{"batteryPresetId":7}"#,
        r#"{"batteryPresetId":"floatwheel-adv2-samsung-50s","batteryCapacityAh":null}"#,
        r#"{"batteryCapacityAh":0.09}"#,
        r#"{"batteryCapacityAh":200.1}"#,
        r#"{"batteryCapacityAh":"9"}"#,
    ] {
        assert!(store.update_profile(id, 1, patch, 3).is_err());
        assert_eq!(store.profile(id).unwrap(), first);
    }
    assert!(matches!(
        store.update_profile(
            id,
            0,
            r#"{"batteryPresetId":"fungineers-funwheel-x7s-molicel-p30b"}"#,
            3
        ),
        Err(Error::Conflict { .. })
    ));
    let override_ = store
        .update_profile(
            id,
            1,
            r#"{"batteryCapacityAh":8.7,"batteryMinimumCellVoltageV":3.2}"#,
            3,
        )
        .unwrap();
    assert_eq!(override_.values["batteryPresetId"], preset);
    let imported = store
        .import_board(
            "imported-preset",
            None,
            &serde_json::to_string(&override_.values).unwrap(),
            4,
        )
        .unwrap();
    assert_eq!(
        store.profile(&imported.saved_device_id).unwrap().values,
        override_.values
    );
    assert!(
        store
            .import_board(
                "invalid-preset",
                None,
                r#"{"batteryPresetId":"floatwheel-adv2-samsung-50s","seriesCount":18}"#,
                4
            )
            .is_err()
    );
    let cleared = store
        .update_profile(id, 2, r#"{"batteryCapacityAh":null}"#, 4)
        .unwrap();
    assert_eq!(cleared.values["batteryPresetId"], preset);
    drop(store);
    let mut store = root.open();
    assert_eq!(store.profile(id).unwrap(), cleared);
    let reset = store
        .update_profile(id, 3, &format!(r#"{{"batteryPresetId":"{preset}"}}"#), 5)
        .unwrap();
    assert_eq!(reset.values["batteryCapacityAh"], 10.);
    assert!(reset.values["batteryMinimumCellVoltageV"].is_null());
    assert_eq!(reset.values["motor"], "keep");
    let curve = store
        .update_profile(id, 4, r#"{"batteryCellProfileId":"generic-linear"}"#, 6)
        .unwrap();
    assert!(curve.values["batteryPresetId"].is_null());
    assert_eq!(curve.values["batteryCapacityAh"], 10.);
    let count = store
        .update_profile(id, 5, r#"{"parallelCount":3}"#, 7)
        .unwrap();
    assert!(count.values["batteryCapacityAh"].is_null());
    let count = store
        .update_profile(id, 6, r#"{"seriesCount":22,"batteryCapacityAh":0.1}"#, 8)
        .unwrap();
    assert_eq!(count.values["batteryCapacityAh"], 0.1);
    let count = store
        .update_profile(id, 7, r#"{"batteryCapacityAh":200}"#, 9)
        .unwrap();
    assert_eq!(count.values["batteryCapacityAh"], 200);
}

#[test]
fn live_widget_slots_are_validated_and_persisted() {
    let root = Root::new();
    let mut store = root.open();
    assert_eq!(
        store.settings().unwrap().live_widget_slots,
        ["empty", "powerW", "elapsedMs", "odometerM", "distanceM"]
    );
    for invalid in [
        r#"[]"#,
        r#"["speedKph"]"#,
        r#"["speedKph","powerW","motorTempC","unknown","driveLoad"]"#,
        "null",
    ] {
        assert!(matches!(
            store.update_settings(0, &format!(r#"{{"liveWidgetSlots":{invalid}}}"#)),
            Err(Error::InvalidInput)
        ));
    }
    let updated = store
        .update_settings(
            0,
            r#"{"liveWidgetSlots":["maxSpeedKph","headlights","leds","altitudeM","powerW"]}"#,
        )
        .unwrap();
    assert_eq!(
        updated.live_widget_slots,
        ["maxSpeedKph", "headlights", "leds", "altitudeM", "powerW"]
    );
    assert!(matches!(
        store.update_settings(
            0,
            r#"{"liveWidgetSlots":["powerW","powerW","powerW","powerW"]}"#
        ),
        Err(Error::Conflict { .. })
    ));
    drop(store);
    assert_eq!(root.open().settings().unwrap(), updated);
}

#[test]
fn net_consumption_selections_survive_reopen() {
    let root = Root::new();
    let mut store = root.open();
    let slots = serde_json::json!([
        "wattHoursNetWh",
        "ampHoursNetAh",
        "empty",
        "powerW",
        "distanceM"
    ]);
    let settings = store
        .update_settings(
            0,
            &serde_json::json!({"liveWidgetSlots": slots}).to_string(),
        )
        .unwrap();
    let board = store
        .ensure_board("net-energy", Some("Net energy"), Some(&[1; 12]), 0)
        .unwrap();
    let dashboard = serde_json::json!({"version": 1, "widgets": [
        {"id": "wh", "kind": "reading", "field": "wattHoursNetWh", "presentation": "number", "size": "compact"},
        {"id": "ah", "kind": "reading", "field": "ampHoursNetAh", "presentation": "trend", "size": "compact"}
    ]});
    let saved = store
        .update_profile(
            &board.saved_device_id,
            0,
            &serde_json::json!({"liveWidgetSlots": slots, "customDashboard": dashboard})
                .to_string(),
            1,
        )
        .unwrap();
    drop(store);
    let store = root.open();
    assert_eq!(store.settings().unwrap(), settings);
    let reopened = store.profile(&board.saved_device_id).unwrap();
    assert_eq!(reopened, saved);
    assert_eq!(reopened.values["liveWidgetSlots"], slots);
    assert_eq!(reopened.values["customDashboard"], dashboard);
}

#[test]
fn custom_dashboard_is_atomic_bounded_independent_and_survives_reopen() {
    let root = Root::new();
    let mut store = root.open();
    let first = store
        .ensure_board("dash-first", Some("First"), Some(&[1; 12]), 0)
        .unwrap();
    let second = store
        .ensure_board("dash-second", Some("Second"), Some(&[2; 12]), 0)
        .unwrap();
    let id = &first.saved_device_id;
    let dashboard = serde_json::json!({"version":1,"widgets":[{"id":"theme","kind":"action","action":"themeToggle","size":{"columns":1,"rows":1}},{"id":"mark","kind":"action","action":"rideMarker","size":"compact"},{"id":"a","kind":"reading","field":"motorCurrentA","presentation":"gauge","size":"large","range":{"min":-100,"max":100}},{"id":"peak","kind":"reading","field":"maxSpeedKph","presentation":"gauge","size":"compact","range":{"min":0,"max":60}}]});
    for invalid in [
        serde_json::json!({"version":1,"widgets":[{"id":"mark","kind":"action","action":"unknown","size":"compact"}]}),
        serde_json::json!({"version":1,"widgets":[{"id":"mark","kind":"action","action":"rideMarker","size":"compact","control":"leds"}]}),
        serde_json::json!({"version":2,"widgets":[]}),
        serde_json::json!({"version":1,"widgets":[],"extra":true}),
        serde_json::json!({"version":1,"widgets":[dashboard["widgets"][0].clone(),dashboard["widgets"][0].clone()]}),
        serde_json::json!({"version":1,"widgets":(0..25).map(|i|serde_json::json!({"id":format!("w{i}"),"kind":"visual","visual":"battery","size":"compact"})).collect::<Vec<_>>()}),
        serde_json::json!({"version":1,"widgets":[{"id":"a","kind":"reading","field":"headlights","presentation":"gauge","size":"large"}]}),
        serde_json::json!({"version":1,"widgets":[{"id":"a","kind":"reading","field":"motorCurrentA","presentation":"bar","size":"large","range":{"min":100,"max":-100}}]}),
    ] {
        assert_eq!(
            store
                .update_profile(
                    id,
                    0,
                    &serde_json::json!({"customDashboard":invalid}).to_string(),
                    1
                )
                .unwrap_err(),
            Error::InvalidInput
        );
        assert_eq!(store.profile(id).unwrap().revision, 0);
    }
    let saved = store
        .update_profile(
            id,
            0,
            &serde_json::json!({"customDashboard":dashboard,"motor":"test"}).to_string(),
            1,
        )
        .unwrap();
    assert_eq!(saved.values["customDashboard"], dashboard);
    assert!(
        !store
            .profile(&second.saved_device_id)
            .unwrap()
            .values
            .contains_key("customDashboard")
    );
    assert!(matches!(
        store.update_profile(id, 0, r#"{"customDashboard":null}"#, 2),
        Err(Error::Conflict { .. })
    ));
    drop(store);
    let mut store = root.open();
    assert_eq!(
        store.profile(id).unwrap().values["customDashboard"],
        dashboard
    );
    let cleared = store
        .update_profile(id, saved.revision, r#"{"customDashboard":null}"#, 2)
        .unwrap();
    assert_eq!(cleared.values["motor"], "test");
    let empty = store
        .update_profile(
            id,
            cleared.revision,
            r#"{"customDashboard":{"version":1,"widgets":[]}}"#,
            3,
        )
        .unwrap();
    assert_eq!(
        empty.values["customDashboard"]["widgets"],
        serde_json::json!([])
    );
}

#[test]
fn dashboard_profile_limit_and_unreadable_data_preserve_accepted_storage() {
    let root = Root::new();
    let mut store = root.open();
    let board = store
        .ensure_board("dash", Some("Dashboard"), Some(&[1; 12]), 0)
        .unwrap();
    let id = &board.saved_device_id;
    let padding = serde_json::json!({"extension": "x".repeat(16300)});
    let accepted = store
        .update_profile(id, 0, &padding.to_string(), 1)
        .unwrap();
    let widgets = (0..24).map(|i| serde_json::json!({"id":format!("w{i}"),"kind":"visual","visual":"battery","size":"compact"})).collect::<Vec<_>>();
    assert_eq!(
        store
            .update_profile(
                id,
                accepted.revision,
                &serde_json::json!({"customDashboard":{"version":1,"widgets":widgets}}).to_string(),
                2
            )
            .unwrap_err(),
        Error::InvalidInput
    );
    assert_eq!(store.profile(id).unwrap().values, accepted.values);
    drop(store);
    let db = Connection::open(root.0.join("catalog.sqlite")).unwrap();
    let corrupt = r#"{"customDashboard":{"version":999,"widgets":[]}}"#;
    db.execute(
        "UPDATE board_profile SET json=? WHERE saved_device_id=?",
        [corrupt, id],
    )
    .unwrap();
    drop(db);
    let store = root.open();
    assert_eq!(store.profile(id).unwrap_err(), Error::Corrupt);
    drop(store);
    let db = Connection::open(root.0.join("catalog.sqlite")).unwrap();
    let retained: String = db
        .query_row(
            "SELECT json FROM board_profile WHERE saved_device_id=?",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(retained, corrupt);
}

#[test]
fn session_display_options_are_validated_and_persisted() {
    let root = Root::new();
    let mut store = root.open();
    assert!(
        !store
            .settings()
            .unwrap()
            .session_display_options
            .both_footpads_off
    );
    for invalid in [
        "null",
        "{}",
        r#"{"bothFootpadsOff":true}"#,
        r#"{"bothFootpadsOff":true,"oneFootpadOff":1}"#,
        r#"{"bothFootpadsOff":true,"oneFootpadOff":false,"extra":true}"#,
    ] {
        assert!(matches!(
            store.update_settings(0, &format!(r#"{{"sessionDisplayOptions":{invalid}}}"#)),
            Err(Error::InvalidInput)
        ));
    }
    let updated = store
        .update_settings(
            0,
            r#"{"sessionDisplayOptions":{"bothFootpadsOff":true,"oneFootpadOff":false}}"#,
        )
        .unwrap();
    assert!(updated.session_display_options.both_footpads_off);
    assert!(!updated.session_display_options.one_footpad_off);
    drop(store);
    assert_eq!(root.open().settings().unwrap(), updated);
}

#[test]
fn board_live_widget_layouts_are_independent_validated_and_persisted() {
    let root = Root::new();
    let mut store = root.open();
    let first = store
        .ensure_board("first", Some("First"), Some(&[1; 12]), 0)
        .unwrap();
    let second = store
        .ensure_board("second", Some("Second"), Some(&[2; 12]), 0)
        .unwrap();
    let id = &first.saved_device_id;
    for invalid in [
        "null",
        "[]",
        r#"["empty","empty","empty","unknown","empty"]"#,
        r#"["empty","empty","empty","empty",4]"#,
    ] {
        assert!(matches!(
            store.update_profile(id, 0, &format!(r#"{{"liveWidgetSlots":{invalid}}}"#), 1),
            Err(Error::InvalidInput)
        ));
    }
    let updated = store.update_profile(id, 0, r#"{"liveWidgetSlots":["highestTempC","bmsStateOfCharge","bmsHighestCellTempC","bmsCellVoltageSpreadV","highestTempC"]}"#, 1).unwrap();
    assert_eq!(
        updated.live_widget_slots(),
        [
            "highestTempC",
            "bmsStateOfCharge",
            "bmsHighestCellTempC",
            "bmsCellVoltageSpreadV",
            "highestTempC"
        ]
    );
    assert_eq!(
        store
            .profile(&second.saved_device_id)
            .unwrap()
            .live_widget_slots(),
        store.settings().unwrap().live_widget_slots
    );
    assert!(matches!(
        store.update_profile(id, 0, "{}", 2),
        Err(Error::Conflict { .. })
    ));
    drop(store);
    let store = root.open();
    assert_eq!(store.profile(id).unwrap(), updated);
    assert_eq!(store.profile(&second.saved_device_id).unwrap().revision, 0);
}

#[test]
fn announcement_preferences_validate_atomically_and_reopen() {
    let root = Root::new();
    let mut store = root.open();
    let mut a = Settings::default().announcements;
    a.speed_enabled = true;
    a.load_enabled = true;
    a.footpad_enabled = true;
    a.footpad_delay_seconds = 3;
    a.battery_charge_enabled = false;
    a.volume_percent = 42;
    let updated = store
        .update_settings(0, &serde_json::json!({"announcements":a}).to_string())
        .unwrap();
    drop(store);
    let mut store = root.open();
    assert_eq!(store.settings().unwrap(), updated);
    for invalid in [
        serde_json::json!({"footpadDelaySeconds":0}),
        serde_json::json!({"footpadDelaySeconds":6}),
        serde_json::json!({"footpadDelaySeconds":1.5}),
        serde_json::json!({"footpadDelaySeconds":null}),
        serde_json::json!({"footpadEnabled":"true"}),
        serde_json::json!({"batteryChargeEnabled":"true"}),
        serde_json::json!({"batteryChargeEnabled":null}),
        serde_json::json!({"volumePercent":101}),
        serde_json::json!({"repeatIntervalSeconds":0}),
        serde_json::json!({"speedThresholdKph":0}),
        serde_json::json!({"loadThresholdPercent":101}),
        serde_json::json!({"volumePercent":1.5}),
    ] {
        let mut bad = serde_json::to_value(&a).unwrap();
        for (k, v) in invalid.as_object().unwrap() {
            bad[k] = v.clone();
        }
        assert_eq!(
            store.update_settings(
                1,
                &serde_json::json!({"announcements":bad,"unitPreference":"imperial"}).to_string()
            ),
            Err(Error::InvalidInput)
        );
        assert_eq!(store.settings().unwrap(), updated);
    }
    assert_eq!(
        store.update_settings(1, "{\"announcements\":{}}"),
        Err(Error::InvalidInput)
    );
}

#[test]
fn auto_connect_selection_is_local_validated_atomic_and_durable() {
    let root = Root::new();
    let mut store = root.open();
    let a = store
        .ensure_board("local-a", Some("A"), Some(&[1; 12]), 100)
        .unwrap();
    let b = store
        .ensure_board("local-b", Some("B"), Some(&[2; 12]), 101)
        .unwrap();
    assert_eq!(store.settings().unwrap().auto_connect_saved_device_id, None);
    for id in [&a.saved_device_id, &b.saved_device_id] {
        let revision = store.settings().unwrap().revision;
        let patch = serde_json::json!({"autoConnectSavedDeviceId":id}).to_string();
        let selected = store.update_settings(revision, &patch).unwrap();
        assert_eq!(selected.auto_connect_saved_device_id.as_ref(), Some(id));
        drop(store);
        store = root.open();
        assert_eq!(store.settings().unwrap(), selected);
    }
    let before = store.settings().unwrap();
    assert_eq!(
        store.update_settings(
            before.revision,
            r#"{"autoConnectSavedDeviceId":"missing","unitPreference":"imperial"}"#
        ),
        Err(Error::NotFound)
    );
    assert_eq!(
        store.update_settings(
            before.revision,
            r#"{"autoConnectSavedDeviceId":42,"unitPreference":"imperial"}"#
        ),
        Err(Error::InvalidInput)
    );
    assert!(matches!(
        store.update_settings(0, r#"{"autoConnectSavedDeviceId":null}"#),
        Err(Error::Conflict { .. })
    ));
    assert_eq!(store.settings().unwrap(), before);
    let db = Connection::open(root.0.join("catalog.sqlite")).unwrap();
    db.execute(
        "UPDATE saved_device SET opaque_platform_id=NULL WHERE saved_device_id=?",
        [&a.saved_device_id],
    )
    .unwrap();
    assert_eq!(store.update_settings(before.revision,
        &serde_json::json!({"autoConnectSavedDeviceId":a.saved_device_id,"unitPreference":"imperial"}).to_string()), Err(Error::UnassociatedBoard));
    db.execute_batch("CREATE TRIGGER reject_settings BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
    assert!(
        store
            .update_settings(before.revision, r#"{"autoConnectSavedDeviceId":null}"#)
            .is_err()
    );
    assert_eq!(store.settings().unwrap(), before);
    db.execute_batch("DROP TRIGGER reject_settings;").unwrap();
    assert_eq!(
        store
            .update_settings(before.revision, r#"{"autoConnectSavedDeviceId":null}"#)
            .unwrap()
            .auto_connect_saved_device_id,
        None
    );
}

#[test]
fn forgetting_selected_board_clears_selection_in_the_same_transaction() {
    let root = Root::new();
    let mut store = root.open();
    let board = store
        .ensure_board("local", None, Some(&[1; 12]), 1)
        .unwrap();
    let selected = store
        .update_settings(
            0,
            &serde_json::json!({"autoConnectSavedDeviceId":board.saved_device_id}).to_string(),
        )
        .unwrap();
    let db = Connection::open(root.0.join("catalog.sqlite")).unwrap();
    db.execute_batch("CREATE TRIGGER reject_delete BEFORE DELETE ON saved_device BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
    assert!(store.forget_board(&board.saved_device_id).is_err());
    assert_eq!(store.settings().unwrap(), selected);
    assert!(store.board(&board.saved_device_id).is_ok());
    db.execute_batch("DROP TRIGGER reject_delete;").unwrap();
    store.forget_board(&board.saved_device_id).unwrap();
    let settings = store.settings().unwrap();
    assert_eq!(settings.revision, selected.revision + 1);
    assert_eq!(settings.auto_connect_saved_device_id, None);
}

#[test]
fn committed_baseline_upgrade_retries_marker_publication_without_data_loss() {
    let root = Root::new();
    let mut store = root.open();
    let settings = store
        .update_settings(0, r#"{"minimumSessionDistance":73}"#)
        .unwrap();
    drop(store);
    // The catalog transaction committed, then the process stopped before marker rename.
    for previous in ["100", "101"] {
        fs::write(root.0.join(".schema-version"), previous).unwrap();
        assert_eq!(root.open().settings().unwrap(), settings);
        assert_eq!(
            fs::read_to_string(root.0.join(".schema-version")).unwrap(),
            float_view_product_store::STORAGE_VERSION
        );
    }
}

#[test]
fn tune_library_pages_all_versions_and_preserves_incompatible_values_on_rename() {
    use float_view_product_store::*;
    let root = Root::new();
    let mut store = root.open();
    let (identity, values, schema) = tune_fixture();
    let older = TuneIdentity {
        package_version: "1.2.3".into(),
        ..identity.clone()
    };
    let old = store
        .create_tune("Old", None, &older, &values, &schema, 1)
        .unwrap();
    let new = store
        .create_tune("New", None, &identity, &values, &schema, 2)
        .unwrap();
    assert_eq!(
        store.tunes(&identity, 50, None).unwrap().items,
        vec![new.clone()]
    );
    let first = store.tunes_filtered(None, 1, None).unwrap();
    assert_eq!(first.items, vec![new]);
    let cursor = first.next_cursor.as_deref().unwrap();
    assert_eq!(
        store.tunes_filtered(None, 1, Some(cursor)).unwrap().items,
        vec![old.clone()]
    );
    assert_eq!(
        store.tunes(&identity, 1, Some(cursor)),
        Err(Error::InvalidInput)
    );
    let filtered_cursor = {
        store
            .create_tune("Second", None, &identity, &values, &schema, 3)
            .unwrap();
        store
            .tunes(&identity, 1, None)
            .unwrap()
            .next_cursor
            .unwrap()
    };
    assert_eq!(
        store.tunes_filtered(None, 1, Some(&filtered_cursor)),
        Err(Error::InvalidInput)
    );
    let mut different_schema = schema.clone();
    different_schema.fingerprint = "b".repeat(64);
    let renamed = store
        .update_tune(
            &old.configuration_id,
            1,
            "Renamed old",
            Some("Preserved"),
            &values,
            &different_schema,
            4,
        )
        .unwrap();
    assert_eq!(renamed.identity, older);
    assert_eq!(renamed.values, values);
    assert_eq!(renamed.revision, 2);
    let mut changed = values;
    changed.insert("gain".into(), TuneValue::Integer(3));
    assert_eq!(
        store.update_tune(
            &old.configuration_id,
            2,
            "Changed",
            None,
            &changed,
            &different_schema,
            5
        ),
        Err(Error::InvalidInput)
    );
    assert_eq!(
        store.update_tune(
            &old.configuration_id,
            1,
            "Stale",
            None,
            &renamed.values,
            &different_schema,
            5
        ),
        Err(Error::Conflict { revision: 2 })
    );
    store.delete_tune(&old.configuration_id, 2).unwrap();
    assert_eq!(store.tune(&old.configuration_id), Err(Error::NotFound));
}

#[test]
fn last_live_view_is_validated_independent_and_survives_reopen() {
    let root = Root::new();
    let mut store = root.open();
    let a = store
        .ensure_board("view-a", Some("A"), Some(&[1; 12]), 0)
        .unwrap();
    let b = store
        .ensure_board("view-b", Some("B"), Some(&[2; 12]), 0)
        .unwrap();
    let id = &a.saved_device_id;
    for value in [
        serde_json::json!("unknown"),
        serde_json::json!(1),
        serde_json::json!({}),
        serde_json::json!(["normal"]),
    ] {
        assert_eq!(
            store
                .update_profile(
                    id,
                    0,
                    &serde_json::json!({"lastLiveView": value}).to_string(),
                    1
                )
                .unwrap_err(),
            Error::InvalidInput
        );
        assert_eq!(store.profile(id).unwrap().revision, 0);
    }
    let saved = store
        .update_profile(
            id,
            0,
            r#"{"lastLiveView":"custom","customDashboard":{"version":1,"widgets":[]}}"#,
            1,
        )
        .unwrap();
    assert!(
        !store
            .profile(&b.saved_device_id)
            .unwrap()
            .values
            .contains_key("lastLiveView")
    );
    drop(store);
    let mut store = root.open();
    assert_eq!(store.profile(id).unwrap(), saved);
    let detailed = store
        .update_profile(id, saved.revision, r#"{"lastLiveView":"detailed"}"#, 2)
        .unwrap();
    assert_eq!(
        detailed.values["customDashboard"],
        saved.values["customDashboard"]
    );
    let normal = store
        .update_profile(id, detailed.revision, r#"{"lastLiveView":"normal"}"#, 3)
        .unwrap();
    assert_eq!(normal.values["lastLiveView"], "normal");
    assert!(
        store
            .update_profile(id, normal.revision, r#"{"lastLiveView":null}"#, 4)
            .unwrap()
            .values["lastLiveView"]
            .is_null()
    );
}

#[test]
fn dashboard_explicit_spans_are_bounded_and_preserve_existing_named_sizes() {
    let root = Root::new();
    let mut store = root.open();
    let board = store
        .ensure_board("spans", Some("Spans"), Some(&[1; 12]), 0)
        .unwrap();
    let id = &board.saved_device_id;
    for size in [
        serde_json::json!({}),
        serde_json::json!({"columns":1}),
        serde_json::json!({"columns":0,"rows":1}),
        serde_json::json!({"columns":5,"rows":1}),
        serde_json::json!({"columns":1,"rows":0}),
        serde_json::json!({"columns":1,"rows":5}),
        serde_json::json!({"columns":1.5,"rows":1}),
        serde_json::json!({"columns":"1","rows":1}),
        serde_json::json!({"columns":1,"rows":1,"extra":true}),
    ] {
        let patch = serde_json::json!({"customDashboard":{"version":1,"widgets":[{"id":"bad","kind":"control","control":"leds","size":size}]}});
        assert_eq!(
            store
                .update_profile(id, 0, &patch.to_string(), 0)
                .unwrap_err(),
            Error::InvalidInput
        );
        assert_eq!(store.profile(id).unwrap().revision, 0);
    }
    let mut widgets = Vec::new();
    for columns in 1..=4 {
        for rows in 1..=4 {
            widgets.push(serde_json::json!({"id":format!("w{columns}-{rows}"),"kind":"control","control":"leds","size":{"columns":columns,"rows":rows}}));
        }
    }
    for size in ["compact", "medium", "large"] {
        widgets.push(serde_json::json!({"id":size,"kind":"visual","visual":"battery","size":size}));
    }
    let patch =
        serde_json::json!({"customDashboard":{"version":1,"widgets":widgets},"motor":"preserved"});
    let saved = store.update_profile(id, 0, &patch.to_string(), 0).unwrap();
    drop(store);
    let reopened = root.open().profile(id).unwrap();
    assert_eq!(reopened.values, saved.values);
    assert_eq!(
        reopened.values["customDashboard"]["widgets"][16]["size"],
        "compact"
    );
}

#[test]
fn old_announcement_settings_default_only_absent_fields_and_preserve_preferences() {
    let root = Root::new();
    let store = root.open();
    let mut expected = store.settings().unwrap();
    expected.announcements.speed_enabled = true;
    expected.announcements.load_enabled = true;
    expected.announcements.speed_threshold_kph = 33.;
    expected.announcements.load_threshold_percent = 77.;
    expected.announcements.volume_percent = 42;
    expected.announcements.repeat_interval_seconds = 9;
    let mut old = serde_json::to_value(&expected).unwrap();
    let a = old["announcements"].as_object_mut().unwrap();
    a.remove("batteryChargeEnabled");
    a.remove("footpadEnabled");
    a.remove("footpadDelaySeconds");
    drop(store);
    let db = Connection::open(root.0.join("catalog.sqlite")).unwrap();
    db.execute("UPDATE settings SET json=?", [old.to_string()])
        .unwrap();
    let mut store = root.open();
    assert_eq!(store.settings().unwrap(), expected);
    for delay in 1..=5 {
        let mut a = expected.announcements.clone();
        a.footpad_enabled = true;
        a.footpad_delay_seconds = delay;
        expected = store
            .update_settings(
                expected.revision,
                &serde_json::json!({"announcements":a}).to_string(),
            )
            .unwrap();
    }
    assert!(matches!(
        store.update_settings(0, "{}"),
        Err(Error::Conflict { .. })
    ));
    drop(store);
    assert_eq!(root.open().settings().unwrap(), expected);
    // A present invalid value is corruption, never a request to reset or default.
    for bad in [
        serde_json::json!(null),
        serde_json::json!(0),
        serde_json::json!(6),
        serde_json::json!(1.5),
        serde_json::json!("1"),
    ] {
        let mut value = old.clone();
        value["announcements"]["footpadDelaySeconds"] = bad;
        db.execute("UPDATE settings SET json=?", [value.to_string()])
            .unwrap();
        assert!(matches!(ProductStore::open(&root.0), Err(Error::Corrupt)));
        let stored: String = db
            .query_row("SELECT json FROM settings", [], |row| row.get(0))
            .unwrap();
        assert_eq!(stored, value.to_string());
    }
}

#[test]
fn invalid_present_battery_charge_setting_preserves_supported_storage() {
    let root = Root::new();
    let store = root.open();
    let original = serde_json::to_value(store.settings().unwrap()).unwrap();
    drop(store);
    let db = Connection::open(root.0.join("catalog.sqlite")).unwrap();
    for bad in [
        serde_json::json!(null),
        serde_json::json!(1),
        serde_json::json!("true"),
    ] {
        let mut value = original.clone();
        value["announcements"]["batteryChargeEnabled"] = bad;
        db.execute("UPDATE settings SET json=?", [value.to_string()])
            .unwrap();
        assert!(matches!(ProductStore::open(&root.0), Err(Error::Corrupt)));
        let stored: String = db
            .query_row("SELECT json FROM settings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, value.to_string());
    }
}

#[test]
fn stable_and_beta_tunes_share_existing_rows_pagination_and_durable_identity() {
    let root = Root::new();
    let (mut identity, values, schema) = tune_fixture();
    let versions = ["1.3.1-beta2", "1.3.1-beta3", "1.3.1"];
    let mut store = root.open();
    let mut created = Vec::new();
    for (index, version) in versions.iter().enumerate() {
        identity.package_version = (*version).into();
        let tune = store
            .create_tune(version, None, &identity, &values, &schema, index as i64 + 1)
            .unwrap();
        assert_eq!(tune.identity.package_version, "1.3.1");
        // Recreate previously supported beta-labelled rows without rewriting them on open.
        Connection::open(root.0.join("catalog.sqlite"))
            .unwrap()
            .execute(
                "UPDATE refloat_configuration SET package_version=? WHERE configuration_id=?",
                rusqlite::params![version, tune.configuration_id],
            )
            .unwrap();
        created.push(tune);
    }
    drop(store);
    let mut store = root.open();
    let mut cursor = None;
    let mut ids = Vec::new();
    for version in versions {
        identity.package_version = version.into();
        assert_eq!(store.tunes(&identity, 50, None).unwrap().items.len(), 3);
        let page = store.tunes(&identity, 1, cursor.as_deref()).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].identity.package_version, "1.3.1");
        ids.push(page.items[0].configuration_id.clone());
        cursor = page.next_cursor;
    }
    assert!(cursor.is_none());
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 3);
    for tune in &created {
        assert_eq!(store.tune(&tune.configuration_id).unwrap(), *tune);
    }
    for version in [
        "1.3.1-beta1",
        "1.3.1-beta4",
        "1.2.3",
        "1.4.0",
        "1.3.256",
        "1.3.01",
    ] {
        identity.package_version = version.into();
        assert!(store.tunes(&identity, 50, None).unwrap().items.is_empty());
        assert!(!identity.compatible_with(&created[0].identity));
    }
    identity.package_version = "1.3.1".into();
    for version in [
        "1.3.0",
        "1.3.1-beta2",
        "1.3.1-beta3",
        "1.3.1",
        "1.3.2",
        "1.3.255",
    ] {
        let mut target = identity.clone();
        target.package_version = version.into();
        assert!(identity.compatible_with(&target));
        target.schema_fingerprint = "b".repeat(64);
        assert!(!identity.compatible_with(&target));
        target.schema_fingerprint = identity.schema_fingerprint.clone();
        target.wire_signature += 1;
        assert!(!identity.compatible_with(&target));
    }
    let old = &created[0];
    let updated = store
        .update_tune(
            &old.configuration_id,
            old.revision,
            "Updated",
            None,
            &values,
            &schema,
            4,
        )
        .unwrap();
    assert_eq!(updated.identity.package_version, "1.3.1");
    assert_eq!(updated.revision, 2);
    let raw: String = Connection::open(root.0.join("catalog.sqlite"))
        .unwrap()
        .query_row(
            "SELECT package_version FROM refloat_configuration WHERE configuration_id=?",
            [&old.configuration_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        raw, "1.3.1-beta2",
        "reads and edits preserve existing storage"
    );
}

#[test]
fn verified_controller_moves_only_the_transport_and_preserves_both_profiles() {
    let root = Root::new();
    let mut store = root.open();
    let a = store
        .ensure_board("shared-transport", Some("Original"), Some(&[1; 12]), 1)
        .unwrap();
    let a = store
        .update_board(&a.saved_device_id, 0, Some("My original board"))
        .unwrap();
    let profile_a = store
        .update_profile(
            &a.saved_device_id,
            0,
            r#"{"motor":"hub","seriesCount":16,"parallelCount":2}"#,
            1,
        )
        .unwrap();
    let b = store
        .ensure_board(
            "shared-transport",
            Some("Different controller"),
            Some(&[2; 12]),
            2,
        )
        .unwrap();
    assert_ne!(a.saved_device_id, b.saved_device_id);
    assert_eq!(b.device_history_id, board_identity(Some(&[2; 12])).unwrap());
    let mut detached_a = a.clone();
    detached_a.local_identifier = None;
    assert_eq!(store.board(&a.saved_device_id).unwrap(), detached_a);
    assert_eq!(store.profile(&a.saved_device_id).unwrap(), profile_a);
    assert_eq!(
        store.profile(&b.saved_device_id).unwrap().missing_fields(),
        ["seriesCount", "parallelCount", "motor"]
    );
    let profile_b = store
        .update_profile(
            &b.saved_device_id,
            0,
            r#"{"motor":"hub","seriesCount":20,"parallelCount":2}"#,
            2,
        )
        .unwrap();
    // Returning to an already-known controller must move the hint without a conflict.
    let returned = store
        .ensure_board(
            "shared-transport",
            Some("Original again"),
            Some(&[1; 12]),
            3,
        )
        .unwrap();
    assert_eq!(returned.saved_device_id, a.saved_device_id);
    assert_eq!(returned.custom_display_name, a.custom_display_name);
    assert_eq!(store.profile(&a.saved_device_id).unwrap(), profile_a);
    assert_eq!(
        store.board(&b.saved_device_id).unwrap().local_identifier,
        None
    );
    assert_eq!(store.profile(&b.saved_device_id).unwrap(), profile_b);
    let relocated = store
        .ensure_board("another-platform-transport", None, Some(&[1; 12]), 4)
        .unwrap();
    assert_eq!(relocated.saved_device_id, a.saved_device_id);
    assert_eq!(
        relocated.local_identifier.as_deref(),
        Some("another-platform-transport")
    );
    assert_eq!(store.boards().unwrap().len(), 2);
    drop(store);
    let reopened = root.open();
    assert_eq!(reopened.board(&a.saved_device_id).unwrap(), relocated);
    assert_eq!(reopened.profile(&b.saved_device_id).unwrap(), profile_b);
}

#[test]
fn verified_imported_board_replaces_another_boards_local_association() {
    let root = Root::new();
    let mut store = root.open();
    let old = store
        .ensure_board("shared-transport", Some("Old"), Some(&[1; 12]), 1)
        .unwrap();
    let imported = store
        .import_board(
            &board_identity(Some(&[2; 12])).unwrap(),
            Some("Imported"),
            r#"{"motor":"hub","seriesCount":18,"parallelCount":2}"#,
            1,
        )
        .unwrap();
    let profile = store.profile(&imported.saved_device_id).unwrap();
    let connected = store
        .ensure_board("shared-transport", Some("BLE"), Some(&[2; 12]), 2)
        .unwrap();
    assert_eq!(connected.saved_device_id, imported.saved_device_id);
    assert_eq!(store.profile(&connected.saved_device_id).unwrap(), profile);
    assert_eq!(
        store.board(&old.saved_device_id).unwrap().local_identifier,
        None
    );
    assert_eq!(store.boards().unwrap().len(), 2);
}

#[test]
fn invalid_controller_identification_never_falls_back_to_a_local_association() {
    let root = Root::new();
    let mut store = root.open();
    let original = store
        .ensure_board("local", Some("Original"), Some(&[1; 12]), 1)
        .unwrap();
    for uuid in [
        None,
        Some([0u8; 12].as_slice()),
        Some([255u8; 12].as_slice()),
        Some([1u8; 11].as_slice()),
        Some([1u8; 13].as_slice()),
    ] {
        for local in ["local", "new-local"] {
            assert_eq!(
                store.ensure_board(local, Some("Unverified"), uuid, 2),
                Err(Error::InvalidInput)
            );
            assert_eq!(store.boards().unwrap(), vec![original.clone()]);
        }
    }
    // Existing supported opaque identities stay intact; a new UUID never adopts them.
    let opaque = store
        .import_board("supported-opaque-history", Some("Offline"), "{}", 1)
        .unwrap();
    store
        .ensure_board("local", None, Some(&[2; 12]), 3)
        .unwrap();
    assert_eq!(store.board(&opaque.saved_device_id).unwrap(), opaque);
}

#[test]
fn reassociation_rolls_back_if_insertion_fails_or_board_capacity_is_full() {
    let root = Root::new();
    let mut store = root.open();
    let original = store
        .ensure_board("local-0", Some("Original"), Some(&[1; 12]), 1)
        .unwrap();
    let db = Connection::open(root.0.join("catalog.sqlite")).unwrap();
    db.execute_batch("CREATE TRIGGER reject_new_board BEFORE INSERT ON saved_device BEGIN SELECT RAISE(FAIL, 'test insertion failure'); END;").unwrap();
    assert!(
        store
            .ensure_board("local-0", None, Some(&[2; 12]), 2)
            .is_err()
    );
    assert_eq!(store.board(&original.saved_device_id).unwrap(), original);
    db.execute_batch("DROP TRIGGER reject_new_board;").unwrap();
    for i in 1..limits::MAX_BOARDS {
        store
            .ensure_board(&format!("local-{i}"), None, Some(&[i as u8 + 1; 12]), 1)
            .unwrap();
    }
    assert_eq!(
        store.ensure_board("local-0", None, Some(&[254; 12]), 3),
        Err(Error::Capacity)
    );
    assert_eq!(store.board(&original.saved_device_id).unwrap(), original);
    assert_eq!(store.boards().unwrap().len(), limits::MAX_BOARDS);
    let existing = store
        .ensure_board("local-0", None, Some(&[2; 12]), 4)
        .unwrap();
    assert_eq!(
        existing.device_history_id,
        board_identity(Some(&[2; 12])).unwrap()
    );
    assert_eq!(
        store
            .board(&original.saved_device_id)
            .unwrap()
            .local_identifier,
        None
    );
    assert_eq!(store.boards().unwrap().len(), limits::MAX_BOARDS);
}

#[test]
fn stable_patch_tunes_share_audited_schemas_without_rewriting_source_identities() {
    use float_view_product_store::{TuneIdentity, TuneValue, is_tune_field, validate_tune_values};
    use float_view_refloat_configuration_codec::{ConfigurationValue, decode_qt_compressed};
    let root = Root::new();
    let mut store = root.open();
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/refloat-configuration/schemas");
    let sources = [
        "1.0.0",
        "1.0.1",
        "1.1.0",
        "1.1.1",
        "1.1.2",
        "1.2.0",
        "1.2.1",
        "1.2.2",
        "1.2.3",
        "1.3.0",
        "1.3.1-beta2",
    ];
    let mut records = Vec::new();
    for (index, source) in sources.iter().enumerate() {
        let schema = decode_qt_compressed(
            &std::fs::read(fixtures.join(format!("{source}.qcompress"))).unwrap(),
        )
        .unwrap();
        let identity = TuneIdentity {
            package_name: "refloat".into(),
            package_version: (*source).into(),
            schema_fingerprint: schema.fingerprint.clone(),
            wire_signature: schema.wire_signature,
        };
        let values = schema
            .fields
            .iter()
            .filter(|field| is_tune_field(&field.name, &schema))
            .map(|field| {
                (
                    field.name.clone(),
                    match &field.default_value {
                        ConfigurationValue::Decimal(v) => TuneValue::Double(*v),
                        ConfigurationValue::Integer(v) => TuneValue::Integer(*v),
                        ConfigurationValue::Boolean(v) => TuneValue::Boolean(*v),
                        ConfigurationValue::String(v) => TuneValue::String(v.clone()),
                    },
                )
            })
            .collect();
        let tune = store
            .create_tune(source, None, &identity, &values, &schema, index as i64 + 1)
            .unwrap();
        records.push((tune, schema));
    }
    for (source, _) in &records {
        for (target, schema) in &records {
            let same_minor =
                source.identity.package_version[..3] == target.identity.package_version[..3];
            assert_eq!(
                source.identity.compatible_with(&target.identity),
                same_minor
            );
            if same_minor {
                validate_tune_values(&source.identity, &source.values, schema).unwrap();
                let mut invalid = source.values.clone();
                invalid.remove("kp");
                assert!(validate_tune_values(&source.identity, &invalid, schema).is_err());
            }
        }
    }
    drop(store);
    let mut store = root.open();
    for minor in ["1.0", "1.1", "1.2", "1.3"] {
        let expected: Vec<_> = records
            .iter()
            .filter(|(t, _)| t.identity.package_version.starts_with(minor))
            .collect();
        let mut target = expected[0].0.identity.clone();
        target.package_version = format!("{minor}.255");
        let mut cursor = None;
        let mut ids = std::collections::BTreeSet::new();
        loop {
            let page = store.tunes(&target, 1, cursor.as_deref()).unwrap();
            for item in page.items {
                assert!(ids.insert(item.configuration_id));
            }
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
            // A compatible patch/schema may continue the same query cursor.
            target = expected.last().unwrap().0.identity.clone();
        }
        assert_eq!(ids.len(), expected.len());
    }
    let (original, _) = records
        .iter()
        .find(|(t, _)| t.identity.package_version == "1.3.0")
        .unwrap();
    let (_, target_schema) = records.last().unwrap();
    let mut replacement = original.values.clone();
    replacement.insert("kp".into(), TuneValue::Double(21.0));
    let updated = store
        .update_tune(
            &original.configuration_id,
            original.revision,
            &original.name,
            None,
            &replacement,
            target_schema,
            20,
        )
        .unwrap();
    assert_eq!(updated.identity, original.identity);
    for (tune, _) in &records {
        if tune.configuration_id != original.configuration_id {
            assert_eq!(store.tune(&tune.configuration_id).unwrap(), *tune);
        }
    }
}
