//! Generate synthetic baseline evidence in a new disposable output directory.
use float_view_product_store::{ExportFormat, FileCancellation, ProductStore};
use float_view_session_sqlite::{LocationObservation, SessionWriter};
use std::{fs, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = PathBuf::from(
        std::env::args_os()
            .nth(1)
            .ok_or("Supply a new output directory")?,
    );
    fs::create_dir(&output)?; // Refuse existing output; never open live app storage.
    let output = output.canonicalize()?;
    let catalog_root = output.join("catalog-root");
    let mut catalog = ProductStore::open(&catalog_root)?;
    catalog.ensure_board(
        "baseline-fixture",
        Some("Synthetic baseline board"),
        Some(&[1; 12]),
        1,
    )?;
    catalog.update_settings(
        0,
        r#"{"minimumSessionDistance":42,"safetyDisclaimerAccepted":true}"#,
    )?;
    drop(catalog);
    fs::copy(
        catalog_root.join("catalog.sqlite"),
        output.join("catalog.sqlite"),
    )?;

    let root = output.join("archive-root");
    let mut store = ProductStore::open(&root)?;
    let board = store.ensure_board("synthetic-route", None, Some(&[2; 12]), 1)?;
    let session = store.create_session(&board.saved_device_id, 1, u64::MAX)?;
    let mut writer = SessionWriter::open(store.session_path(&session.session_id)?)?;
    writer.append_locations(&[LocationObservation {
        elapsed_ms: 0,
        observed_at_epoch_ms: 1,
        latitude: 2.,
        longitude: 3.,
        accuracy_m: Some(4.),
        altitude_m: None,
    }])?;
    writer.append_ride_marker("00000000-0000-4000-8000-000000000001", 500, 501, true)?;
    writer.close()?;
    drop(store);
    // Exercise actual interruption recovery before exporting the frozen archive.
    let store = ProductStore::open(&root)?;
    let file = store
        .prepare_export(&session.session_id, ExportFormat::Archive)?
        .run(&FileCancellation::default())?;
    fs::copy(file.path(), output.join("recording.floatview"))?;
    Ok(())
}
