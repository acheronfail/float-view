//! Process-owned composition, independent of listeners and native views.
#![forbid(unsafe_code)]

use float_view_application_runtime::ApplicationRuntime;
use float_view_product_store::{Maintenance, MaintenanceCancellation, ProductStore, Result};
use std::path::Path;
pub mod announcements;
mod auto_connect;
mod battery;
pub mod battery_estimator;
pub mod ble;
pub mod calibration;
pub mod diagnostics;
mod dispatch;
pub mod facts;
pub mod hermes;
pub mod live_activity;
pub mod os;
pub mod permissions;
mod policy;
mod process;
mod projection;
mod refloat_drafts;
pub mod ui_state;
pub use dispatch::Dispatch;
pub use float_view_product_store::{ExportFormat, SessionLease};
pub use process::Process;
mod files;
pub mod operations;
mod ride;
pub use files::{
    FileCompletion, FileResult, FileWork, MaintenanceJobCompletion, MaintenanceJobWork,
};

/// One store and one runtime. Listener handles must borrow this owner, never
/// construct another runtime. OS exchange and command admission live here.
pub struct BackendService {
    hermes: hermes::Hermes,
    calibration: calibration::Calibration,
    diagnostics: diagnostics::Diagnostics,
    runtime: ApplicationRuntime,
    stopping: bool,
    ui_checkpoint: Option<ui_state::Checkpoint>,
    store: ProductStore,
    files: files::Files,
    policy: policy::Policy,
    pending: std::collections::BTreeMap<u64, dispatch::Pending>,
    maintenance_worker: Option<MaintenanceCancellation>,
    notifications: tokio::sync::watch::Sender<u64>,
}
impl BackendService {
    pub fn open(root: &Path) -> Result<Self> {
        let mut store = ProductStore::open(root)?;
        // A new process has no live connection to resume. Listener/WebView
        // recreation borrows this owner and must not clear these checkpoints.
        store.clear_refloat_editor_drafts()?;
        let mut service = Self {
            hermes: hermes::Hermes::new(root.with_extension("hermes.sqlite")),
            calibration: calibration::Calibration::default(),
            diagnostics: diagnostics::Diagnostics::open(&match root
                .file_name()
                .and_then(|n| n.to_str())
            {
                Some("Sessions") => root.with_file_name("Diagnostics"),
                Some("logs") => root.with_file_name("diagnostics"),
                _ => root.with_extension("diagnostics"),
            }),
            runtime: ApplicationRuntime::new(),
            stopping: false,
            ui_checkpoint: None,
            policy: policy::Policy::new(store.settings()?),
            pending: std::collections::BTreeMap::new(),
            store,
            files: files::Files::default(),
            maintenance_worker: None,
            notifications: tokio::sync::watch::channel(0).0,
        };
        service.policy.ride = service.store.ride_checkpoint()?;
        service.refresh_boards()?;
        service
            .changed()
            .map_err(|_| float_view_product_store::Error::Capacity)?;
        Ok(service)
    }
    pub fn begin_maintenance(
        &mut self,
        session_id: Option<&str>,
        resolution: u64,
        preview: bool,
        at_ms: i64,
    ) -> Result<Maintenance> {
        let job = self
            .store
            .begin_maintenance(session_id, resolution, preview, at_ms)?;
        self.changed()
            .map_err(|_| float_view_product_store::Error::Capacity)?;
        Ok(job)
    }
    pub fn maintenance_recorded_samples(&self) -> Result<u64> {
        self.store.maintenance_recorded_samples()
    }
    pub fn maintenance(&self) -> Result<Option<Maintenance>> {
        let mut job = self.store.maintenance()?;
        if let Some(job) = &mut job
            && job.state == "running"
            && self
                .maintenance_worker
                .as_ref()
                .is_some_and(MaintenanceCancellation::reclaiming)
        {
            job.state = "reclaiming".into();
        }
        Ok(job)
    }
    pub fn cancel_maintenance(&mut self, id: &str, at_ms: i64) -> Result<Maintenance> {
        let job = self.store.cancel_maintenance(id, at_ms)?;
        if let Some(worker) = &self.maintenance_worker {
            worker.cancel();
        }
        self.changed()
            .map_err(|_| float_view_product_store::Error::Capacity)?;
        Ok(job)
    }
    pub fn snapshot(&self) -> float_view_application_runtime::Snapshot {
        self.runtime.snapshot()
    }
    pub fn subscribe(&self) -> tokio::sync::watch::Receiver<u64> {
        self.notifications.subscribe()
    }
    pub fn catalog_revision(&self) -> u64 {
        self.store.catalog_revision()
    }
    pub fn monotonic_ms(&self) -> u64 {
        self.policy.exchange.now
    }
    pub fn epoch_ms(&self) -> i64 {
        self.policy.exchange.epoch
    }
    pub fn source(
        &self,
        id: &str,
    ) -> std::result::Result<
        (facts::SessionSource, float_view_product_store::SessionLease),
        operations::Failure,
    > {
        let s = self.store.session(id).map_err(store_failure)?;
        let lease = self.store.lease_session(id).map_err(store_failure)?;
        let source = facts::SessionSource {
            summary: projection::session(&s),
            boundary: projection::boundary(&s),
            path: lease
                .path()
                .to_str()
                .ok_or(operations::Failure::Internal)?
                .into(),
        };
        Ok((source, lease))
    }
    pub fn settings(&self) -> Result<float_view_product_store::Settings> {
        self.store.settings()
    }
}

impl Drop for BackendService {
    fn drop(&mut self) {
        if let Some(worker) = &self.maintenance_worker {
            worker.cancel();
        }
    }
}

fn store_failure(error: float_view_product_store::Error) -> operations::Failure {
    use float_view_product_store::Error as E;
    use operations::Failure as F;
    match error {
        E::InvalidInput => F::InvalidRequest,
        E::NotFound => F::NotFound,
        E::Conflict { .. } => F::Conflict,
        E::ActiveSession | E::UnassociatedBoard => F::InvalidState,
        E::Capacity | E::Busy | E::Full | E::Cancelled => F::Unavailable,
        _ => F::Internal,
    }
}

pub const MAX_APP_TRANSFER_BYTES: u64 = float_view_product_store::limits::MAX_BOARD_EXPORT_BYTES;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    #[test]
    fn shared_handles_retain_one_runtime_and_catalog_owner() {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("float-view-service-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        let owner = Arc::new(Mutex::new(BackendService::open(&root).unwrap()));
        let runtime_address = std::ptr::from_ref(&owner.lock().unwrap().runtime) as usize;
        let listener = owner.clone();
        drop(listener);
        let replacement = owner.clone();
        assert_eq!(
            std::ptr::from_ref(&replacement.lock().unwrap().runtime) as usize,
            runtime_address
        );
        assert!(!replacement.lock().unwrap().snapshot().session_attached);
        assert_eq!(replacement.lock().unwrap().settings().unwrap().revision, 0);
        drop(replacement);
        drop(owner);
        std::fs::remove_dir_all(root).unwrap();
    }
}
