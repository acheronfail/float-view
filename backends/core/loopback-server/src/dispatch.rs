//! Authenticated control validation, native operation selection and wire results.
use crate::{
    backend::Backend,
    facts::*,
    projection,
    protocol::{Failure, Operation},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Map, Value, json};

pub(crate) struct Params<'a>(pub &'a Map<String, Value>);
impl Params<'_> {
    pub fn export_operation(&self, board: bool) -> Result<Option<String>, Failure> {
        match self.0.get("operationId") {
            None => Ok(None),
            Some(Value::String(id))
                if board
                    && !id.is_empty()
                    && id.len() <= 128
                    && id.bytes().all(|v| v.is_ascii_alphanumeric() || v == b'-') =>
            {
                Ok(Some(id.clone()))
            }
            _ => Err(Failure::InvalidRequest),
        }
    }
    pub fn export_selector(&self) -> Result<(String, bool), Failure> {
        match (
            self.0.contains_key("sessionId"),
            self.0.contains_key("savedDeviceId"),
        ) {
            (true, false) => Ok((self.text("sessionId")?, false)),
            (false, true) => Ok((self.text("savedDeviceId")?, true)),
            _ => Err(Failure::InvalidRequest),
        }
    }
    pub fn text(&self, key: &str) -> Result<String, Failure> {
        self.0
            .get(key)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.len() <= 4096)
            .map(str::to_owned)
            .ok_or(Failure::InvalidRequest)
    }
    pub fn number(&self, key: &str) -> Result<u64, Failure> {
        self.0
            .get(key)
            .and_then(Value::as_u64)
            .filter(|v| *v <= 9_007_199_254_740_991)
            .ok_or(Failure::InvalidRequest)
    }
    pub fn boolean(&self, key: &str) -> Result<bool, Failure> {
        self.0
            .get(key)
            .and_then(Value::as_bool)
            .ok_or(Failure::InvalidRequest)
    }
    pub fn nullable(&self, key: &str) -> Result<Option<String>, Failure> {
        match self.0.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(s)) if !s.is_empty() => Ok(Some(s.clone())),
            _ => Err(Failure::InvalidRequest),
        }
    }
    pub fn only(&self, keys: &[&str]) -> Result<(), Failure> {
        if self.0.keys().all(|k| keys.contains(&k.as_str())) {
            Ok(())
        } else {
            Err(Failure::InvalidRequest)
        }
    }
    fn patch(&self) -> Result<String, Failure> {
        let v = self
            .0
            .get("patch")
            .filter(|v| v.is_object())
            .ok_or(Failure::InvalidRequest)?;
        serde_json::to_string(v).map_err(|_| Failure::InvalidRequest)
    }
    fn values(&self) -> Result<std::collections::BTreeMap<String, ConfigurationValue>, Failure> {
        let raw = self.0.get("values").ok_or(Failure::InvalidRequest)?;
        let encoded = serde_json::to_vec(raw).map_err(|_| Failure::InvalidRequest)?;
        if encoded.len() > 49152 {
            return Err(Failure::InvalidRequest);
        }
        let values: std::collections::BTreeMap<String, ConfigurationValue> =
            serde_json::from_slice(&encoded).map_err(|_| Failure::InvalidRequest)?;
        if values.len() > 512
            || values.iter().any(|(k, v)| {
                k.is_empty()
                    || k.len() > 128
                    || matches!(v,ConfigurationValue::String(s) if s.len()>4096)
            })
        {
            return Err(Failure::InvalidRequest);
        }
        Ok(values)
    }
    fn identity(&self) -> Result<ConfigurationIdentity, Failure> {
        let v: ConfigurationIdentity = serde_json::from_value(
            self.0
                .get("identity")
                .cloned()
                .ok_or(Failure::InvalidRequest)?,
        )
        .map_err(|_| Failure::InvalidRequest)?;
        validate_identity(&v)?;
        Ok(v)
    }
    fn revision(&self) -> Result<u64, Failure> {
        self.number("expectedRevision").and_then(|v| {
            if v > 0 {
                Ok(v)
            } else {
                Err(Failure::InvalidRequest)
            }
        })
    }
    fn name(&self) -> Result<String, Failure> {
        let s = self.text("name")?.trim().to_owned();
        if s.is_empty() || s.len() > 128 {
            Err(Failure::InvalidRequest)
        } else {
            Ok(s)
        }
    }
    fn description(&self) -> Result<Option<String>, Failure> {
        if !self.0.contains_key("description") {
            return Err(Failure::InvalidRequest);
        }
        let s = self.nullable("description")?.map(|s| s.trim().to_owned());
        if s.as_ref().is_some_and(|s| s.is_empty() || s.len() > 1024) {
            Err(Failure::InvalidRequest)
        } else {
            Ok(s)
        }
    }
}
fn validate_identity(v: &ConfigurationIdentity) -> Result<(), Failure> {
    if v.package_name != "refloat"
        || v.package_version.is_empty()
        || v.package_version.len() > 128
        || v.schema_fingerprint.len() != 64
        || !v
            .schema_fingerprint
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Err(Failure::InvalidRequest)
    } else {
        Ok(())
    }
}
pub fn cursor(value: &Value) -> Result<String, Failure> {
    Ok(STANDARD.encode(serde_json::to_vec(value).map_err(|_| Failure::Internal)?))
}
pub fn decode_cursor(value: &str, limit: usize) -> Result<Value, Failure> {
    if value.is_empty() || value.len() > limit {
        return Err(Failure::InvalidRequest);
    }
    serde_json::from_slice(
        &STANDARD
            .decode(value)
            .map_err(|_| Failure::InvalidRequest)?,
    )
    .map_err(|_| Failure::InvalidRequest)
}
impl Backend {
    pub async fn request(&self, client: u64, request: Value) -> Value {
        let id = request
            .get("id")
            .and_then(Value::as_u64)
            .filter(|v| *v <= 9_007_199_254_740_991);
        let result = match (
            id,
            request.get("method").and_then(Value::as_str),
            request.get("params").and_then(Value::as_object),
        ) {
            (Some(_), Some(method), Some(params)) => {
                self.dispatch(client, method, Params(params)).await
            }
            _ => Err(Failure::InvalidRequest),
        };
        let result = result.and_then(|result| {
            if serde_json::to_vec(&result)
                .is_ok_and(|bytes| bytes.len() + 64 <= crate::limits::MAX_MESSAGE_BYTES)
            {
                Ok(result)
            } else {
                Err(Failure::Unavailable)
            }
        });
        match result {
            Ok(result) => json!({"id":id.unwrap_or(0),"result":result}),
            Err(failure) => {
                if let Ok(mut service) = self.service.lock() {
                    service.record_operation_failure(
                        request
                            .get("method")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown"),
                        &failure,
                    );
                }
                json!({"id":id.unwrap_or(0),"error":projection::error(&failure)})
            }
        }
    }

    async fn dispatch(&self, client: u64, method: &str, p: Params<'_>) -> Result<Value, Failure> {
        let operation = match method {
            "diagnostics.list" => {
                p.only(&[])?;
                return Ok(self
                    .service
                    .lock()
                    .map_err(|_| Failure::Internal)?
                    .diagnostic_list());
            }
            "diagnostics.capture" => {
                p.only(&[])?;
                return self
                    .service
                    .lock()
                    .map_err(|_| Failure::Internal)?
                    .diagnostic_capture();
            }
            "diagnostics.uiError" => {
                let error = serde_json::from_value(
                    serde_json::to_value(p.0).map_err(|_| Failure::InvalidRequest)?,
                )
                .map_err(|_| Failure::InvalidRequest)?;
                self.service
                    .lock()
                    .map_err(|_| Failure::Internal)?
                    .diagnostic_ui_error(client, error)?;
                return Ok(json!({"accepted":true}));
            }
            "diagnostics.prepare" => {
                p.only(&["incidentId", "replaceReportId"])?;
                if !p.0.contains_key("incidentId") {
                    return Err(Failure::InvalidRequest);
                }
                let id = p.nullable("incidentId")?;
                if let Some(replace) = p.0.get("replaceReportId") {
                    let id = replace.as_str().ok_or(Failure::InvalidRequest)?;
                    self.service
                        .lock()
                        .map_err(|_| Failure::Internal)?
                        .replace_diagnostic_report(client, id)?;
                }
                let work = self
                    .service
                    .lock()
                    .map_err(|_| Failure::Internal)?
                    .begin_diagnostic_report(client, id.as_deref())?;
                let completed = tokio::task::spawn_blocking(move || work.run())
                    .await
                    .map_err(|_| Failure::Internal)??;
                let preview = self
                    .service
                    .lock()
                    .map_err(|_| Failure::Internal)?
                    .complete_diagnostic_report(completed)?;
                return serde_json::to_value(preview).map_err(|_| Failure::Internal);
            }
            "diagnostics.export" => {
                p.only(&["reportId"])?;
                let (transfer, name, reply) = {
                    let mut s = self.service.lock().map_err(|_| Failure::Internal)?;
                    let (transfer, name) = s.diagnostic_export(client, &p.text("reportId")?)?;
                    let reply = s
                        .present_file(client, transfer, &name)
                        .map_err(|_| Failure::Unavailable)?;
                    (transfer, name, reply)
                };
                let presented = tokio::time::timeout(crate::limits::IO_TIMEOUT, reply)
                    .await
                    .map_err(|_| Failure::Unavailable)?
                    .map_err(|_| Failure::Unavailable)?;
                if !presented {
                    let _ = self
                        .service
                        .lock()
                        .map_err(|_| Failure::Internal)?
                        .cancel_file_transfer(client, transfer);
                    return Err(Failure::Unavailable);
                }
                return Ok(json!({"fileName":name,"delivery":"presented"}));
            }
            "diagnostics.clear" => {
                p.only(&[])?;
                let reply = self
                    .service
                    .lock()
                    .map_err(|_| Failure::Internal)?
                    .diagnostic_clear()?;
                let ok = tokio::task::spawn_blocking(move || {
                    reply
                        .recv_timeout(std::time::Duration::from_secs(2))
                        .unwrap_or(false)
                })
                .await
                .map_err(|_| Failure::Unavailable)?;
                if !ok {
                    return Err(Failure::Unavailable);
                }
                return Ok(json!({"accepted":true}));
            }
            "diagnostics.report" => {
                p.only(&[
                    "snapshots",
                    "max_sample_age_ms",
                    "max_delivery_gap_ms",
                    "max_handler_ms",
                ])?;
                let report =
                    serde_json::from_value::<float_view_backend_service::diagnostics::UiReport>(
                        serde_json::to_value(p.0).map_err(|_| Failure::InvalidRequest)?,
                    )
                    .map_err(|_| Failure::InvalidRequest)?;
                self.service
                    .lock()
                    .map_err(|_| Failure::Internal)?
                    .report_ui_diagnostics(report)?;
                return Ok(json!({"accepted":true}));
            }
            "uiState.get" => {
                p.only(&[])?;
                let service = self.service.lock().map_err(|_| Failure::Internal)?;
                return serde_json::to_value(service.ui_checkpoint())
                    .map_err(|_| Failure::Internal);
            }
            "uiState.set" => {
                p.only(&["checkpoint"])?;
                let value = p.0.get("checkpoint").ok_or(Failure::InvalidRequest)?;
                self.service
                    .lock()
                    .map_err(|_| Failure::Internal)?
                    .set_ui_checkpoint(value.clone())?;
                return Ok(json!({"accepted":true}));
            }
            "state.get" => {
                p.only(&[])?;
                return self.snapshot();
            }
            "hermes.signIn" | "hermes.disconnect" => {
                p.only(&[])?;
                let mut service = self.service.lock().map_err(|_| Failure::Internal)?;
                if method == "hermes.signIn" {
                    service.hermes_sign_in()?;
                } else {
                    service.hermes_disconnect()?;
                }
                drop(service);
                self.sync_service()?;
                return Ok(json!({"accepted":true}));
            }
            "hermes.ride" => {
                p.only(&["sessionId"])?;
                return self
                    .service
                    .lock()
                    .map_err(|_| Failure::Internal)?
                    .hermes_ride(&p.text("sessionId")?);
            }
            "hermes.upload" => {
                p.only(&["sessionId", "revision", "generation", "retry"])?;
                let id = p.text("sessionId")?;
                let revision = p.number("revision")?;
                let generation = p.number("generation")?;
                let retry = p.boolean("retry")?;
                let _permit = self
                    .history
                    .try_acquire()
                    .map_err(|_| Failure::Unavailable)?;
                let (session, lease) = self
                    .service
                    .lock()
                    .map_err(|_| Failure::Internal)?
                    .hermes_source(&id, revision, generation)?;
                let prepared = tokio::task::spawn_blocking(move || {
                    float_view_backend_service::hermes::prepare_ride(session, lease)
                })
                .await
                .map_err(|_| Failure::Internal)??;
                let body = match prepared {
                    Ok(body) => body,
                    Err(reason) => return Ok(json!({"accepted":false,"reason":reason})),
                };
                self.service
                    .lock()
                    .map_err(|_| Failure::Internal)?
                    .hermes_upload(&id, revision, generation, retry, body)?;
                self.sync_service()?;
                return Ok(json!({"accepted":true}));
            }
            "refloat.configuration.draft.get" => {
                p.only(&["deviceId"])?;
                let service = self.service.lock().map_err(|_| Failure::Internal)?;
                return serde_json::to_value(service.refloat_editor_draft(&p.text("deviceId")?)?)
                    .map_err(|_| Failure::Internal);
            }
            "refloat.configuration.draft.set" => {
                p.only(&["deviceId", "baseRevision", "draft"])?;
                let raw = p.0.get("draft").ok_or(Failure::InvalidRequest)?;
                if serde_json::to_vec(raw)
                    .map_err(|_| Failure::InvalidRequest)?
                    .len()
                    > 60_000
                {
                    return Err(Failure::InvalidRequest);
                }
                let draft =
                    serde_json::from_value(raw.clone()).map_err(|_| Failure::InvalidRequest)?;
                self.service
                    .lock()
                    .map_err(|_| Failure::Internal)?
                    .set_refloat_editor_draft(
                        &p.text("deviceId")?,
                        p.number("baseRevision")?,
                        draft,
                    )?;
                return Ok(json!({"accepted":true}));
            }
            "refloat.configuration.open" => {
                p.only(&[])?;
                return self
                    .publisher
                    .lock()
                    .map_err(|_| Failure::Internal)?
                    .facts
                    .as_ref()
                    .map(|f| projection::value(&f.configuration))
                    .ok_or(Failure::Unavailable);
            }
            "permissions.recover" => {
                p.only(&["permission", "action"])?;
                Operation::RecoverPermission {
                    permission: serde_json::from_value(json!(p.text("permission")?))
                        .map_err(|_| Failure::InvalidRequest)?,
                    action: serde_json::from_value(json!(p.text("action")?))
                        .map_err(|_| Failure::InvalidRequest)?,
                }
            }
            "bluetooth.requestPermission" => {
                p.only(&[])?;
                Operation::RequestBluetoothPermission
            }
            "location.requestPermission" => {
                p.only(&[])?;
                Operation::RequestLocationPermission
            }
            "location.openSettings" => {
                p.only(&[])?;
                Operation::OpenLocationSettings
            }
            "bluetooth.scan" => {
                p.only(&["timeoutMs"])?;
                Operation::Scan {
                    timeout_ms: if p.0.contains_key("timeoutMs") {
                        p.number("timeoutMs")?.clamp(1, 60000) as u32
                    } else {
                        5000
                    },
                }
            }
            "device.connect" => {
                p.only(&["deviceId", "trackingMode"])?;
                let mode = p.text("trackingMode")?;
                if mode != "saved" && mode != "guest" {
                    return Err(Failure::InvalidRequest);
                }
                let device_id = p.text("deviceId")?;
                let publisher = self.publisher.lock().map_err(|_| Failure::Internal)?;
                if let Some(active) = publisher.facts.as_ref().and_then(|f| f.active.as_ref())
                    && (active.device_id != device_id
                        || active.state != "failed"
                        || active.tracking_mode != mode)
                {
                    return Err(Failure::InvalidState);
                }
                Operation::Connect {
                    device_id,
                    saved: mode == "saved",
                }
            }
            "device.selectController" => {
                p.only(&["deviceId", "canId"])?;
                let id = p.number("canId")?;
                if id > 253 {
                    return Err(Failure::InvalidRequest);
                }
                Operation::SelectController {
                    device_id: p.text("deviceId")?,
                    can_id: id as u8,
                }
            }
            "session.extendPause" => {
                p.only(&["sessionId"])?;
                Operation::ExtendRidePause {
                    session_id: p.text("sessionId")?,
                }
            }
            "session.end" => {
                p.only(&["sessionId"])?;
                Operation::EndRide {
                    session_id: p.text("sessionId")?,
                }
            }
            "device.disconnect" => {
                p.only(&[])?;
                Operation::Disconnect
            }
            "controller.shutdown" => {
                p.only(&[])?;
                Operation::ShutdownController
            }
            "refloat.control.set" => {
                p.only(&["control", "enabled"])?;
                let control = p.text("control")?;
                if !["package", "flywheel", "leds", "headlights"].contains(&control.as_str()) {
                    return Err(Failure::InvalidRequest);
                }
                Operation::SetControl {
                    control,
                    enabled: p.boolean("enabled")?,
                }
            }
            "refloat.fatalError.clear" => {
                p.only(&[])?;
                Operation::ClearFatalError
            }
            "speedCalibration.start" => {
                p.only(&["diameterMm"])?;
                let diameter_mm =
                    p.0.get("diameterMm")
                        .and_then(Value::as_f64)
                        .filter(|v| v.is_finite())
                        .ok_or(Failure::InvalidRequest)?;
                Operation::StartSpeedCalibration { diameter_mm }
            }
            "speedCalibration.finish" => {
                p.only(&[])?;
                Operation::FinishSpeedCalibration
            }
            "speedCalibration.cancel" => {
                p.only(&[])?;
                Operation::CancelSpeedCalibration
            }
            "speedCalibration.apply" => {
                p.only(&[])?;
                Operation::ApplySpeedCalibration
            }
            "refloat.configuration.schema" => {
                p.only(&["cursor"])?;
                let next = p.nullable("cursor")?;
                return self.schema_page(client, next.as_deref()).await;
            }
            "refloat.configuration.read" => {
                p.only(&["source", "refresh"])?;
                let source = p.text("source")?;
                if source != "current" && source != "default" {
                    return Err(Failure::InvalidRequest);
                }
                Operation::ReadConfiguration {
                    defaults: source == "default",
                    refresh: if p.0.contains_key("refresh") {
                        p.boolean("refresh")?
                    } else {
                        true
                    },
                }
            }
            "refloat.configuration.write" => {
                p.only(&[
                    "packageVersion",
                    "schemaFingerprint",
                    "wireSignature",
                    "baseRevision",
                    "values",
                ])?;
                let identity = ConfigurationIdentity {
                    package_name: "refloat".into(),
                    package_version: p.text("packageVersion")?,
                    schema_fingerprint: p.text("schemaFingerprint")?,
                    wire_signature: u32::try_from(p.number("wireSignature")?)
                        .map_err(|_| Failure::InvalidRequest)?,
                };
                validate_identity(&identity)?;
                Operation::WriteConfiguration {
                    package_version: identity.package_version,
                    fingerprint: identity.schema_fingerprint,
                    signature: identity.wire_signature,
                    revision: p.number("baseRevision")?,
                    values: p.values()?,
                }
            }
            "refloat.tune.list" => {
                p.only(&["identity", "limit", "cursor"])?;
                let limit = p.number("limit")?;
                let cursor = p.nullable("cursor")?;
                if !(1..=50).contains(&limit) || cursor.as_ref().is_some_and(|s| s.len() > 512) {
                    return Err(Failure::InvalidRequest);
                }
                Operation::ListTunes {
                    identity: if p.0.get("identity") == Some(&Value::Null) {
                        None
                    } else {
                        Some(p.identity()?)
                    },
                    limit: limit as usize,
                    cursor,
                }
            }
            "refloat.tune.get" => {
                p.only(&["tuneId"])?;
                Operation::GetTune {
                    id: p.text("tuneId")?,
                }
            }
            "refloat.tune.create" => {
                p.only(&[
                    "name",
                    "description",
                    "identity",
                    "sourceRevision",
                    "values",
                ])?;
                Operation::CreateTune {
                    name: p.name()?,
                    description: p.description()?,
                    identity: p.identity()?,
                    revision: p.number("sourceRevision")?,
                    values: p.values()?,
                }
            }
            "refloat.tune.update" => {
                p.only(&[
                    "tuneId",
                    "expectedRevision",
                    "name",
                    "description",
                    "values",
                ])?;
                Operation::UpdateTune {
                    id: p.text("tuneId")?,
                    revision: p.revision()?,
                    name: p.name()?,
                    description: p.description()?,
                    values: p.values()?,
                }
            }
            "refloat.tune.delete" => {
                p.only(&["tuneId", "expectedRevision"])?;
                Operation::DeleteTune {
                    id: p.text("tuneId")?,
                    revision: p.revision()?,
                }
            }
            "refloat.tune.apply" => {
                p.only(&["tuneId", "expectedRevision", "baseRevision"])?;
                Operation::ApplyTune {
                    id: p.text("tuneId")?,
                    revision: p.revision()?,
                    base_revision: p.number("baseRevision")?,
                }
            }
            "savedDevice.update" => {
                p.only(&["savedDeviceId", "expectedRevision", "customDisplayName"])?;
                if !p.0.contains_key("customDisplayName") {
                    return Err(Failure::InvalidRequest);
                }
                Operation::UpdateSavedBoard {
                    id: p.text("savedDeviceId")?,
                    revision: p.number("expectedRevision")?,
                    name: p.nullable("customDisplayName")?,
                }
            }
            "savedDevice.delete" => {
                p.only(&["savedDeviceId"])?;
                Operation::DeleteSavedBoard {
                    id: p.text("savedDeviceId")?,
                }
            }
            "announcements.openVoiceSettings" => {
                p.only(&[])?;
                Operation::OpenVoiceSettings
            }
            "announcements.test" => {
                p.only(&["kind"])?;
                Operation::TestAnnouncement {
                    kind: serde_json::from_value(json!(p.text("kind")?))
                        .map_err(|_| Failure::InvalidRequest)?,
                }
            }
            "settings.update" => {
                p.only(&["expectedRevision", "patch"])?;
                Operation::UpdateSettings {
                    revision: p.number("expectedRevision")?,
                    patch_json: p.patch()?,
                }
            }
            "boardProfile.get" => {
                p.only(&["savedDeviceId"])?;
                Operation::GetProfile {
                    id: p.text("savedDeviceId")?,
                }
            }
            "boardProfile.update" => {
                p.only(&["savedDeviceId", "expectedRevision", "patch"])?;
                Operation::UpdateProfile {
                    id: p.text("savedDeviceId")?,
                    revision: p.number("expectedRevision")?,
                    patch_json: p.patch()?,
                }
            }
            "session.list" => {
                p.only(&["savedDeviceId", "limit", "cursor"])?;
                return self.session_list(client, p).await;
            }
            "session.marker.add" => {
                p.only(&["sessionId", "operationId"])?;
                Operation::AddRideMarker {
                    session_id: p.text("sessionId")?,
                    operation_id: p.text("operationId")?,
                }
            }
            "session.get" => {
                p.only(&["sessionId"])?;
                Operation::GetSession {
                    id: p.text("sessionId")?,
                }
            }
            "app.clear" => {
                p.only(&[])?;
                Operation::ClearAppData
            }
            "app.export" => {
                p.only(&["operationId"])?;
                Operation::ExportSession {
                    target: crate::protocol::ExportTarget::App,
                    operation_id: p.export_operation(true)?,
                    format: "float-view-archive".into(),
                    present: true,
                    transfer_id: 0,
                }
            }
            "session.export.status" | "session.export.cancel" => {
                p.only(&["operationId"])?;
                let id = p.export_operation(true)?.ok_or(Failure::InvalidRequest)?;
                let progress = self
                    .service
                    .lock()
                    .map_err(|_| Failure::Internal)?
                    .export_progress(&id, method.ends_with("cancel"))
                    .map_err(|_| Failure::NotFound)?;
                return Ok(projection::value(&progress));
            }
            "session.export" => {
                p.only(&["sessionId", "savedDeviceId", "format", "operationId"])?;
                let (id, board) = p.export_selector()?;
                let format = p.text("format")?;
                if format != "csv" && format != "float-view-archive" {
                    return Err(Failure::InvalidRequest);
                }
                Operation::ExportSession {
                    operation_id: p.export_operation(board)?,
                    target: if board {
                        crate::protocol::ExportTarget::Board { id }
                    } else {
                        crate::protocol::ExportTarget::Session { id }
                    },
                    format,
                    present: true,
                    transfer_id: 0,
                }
            }
            "session.delete" => {
                p.only(&["sessionId"])?;
                Operation::DeleteSession {
                    id: p.text("sessionId")?,
                }
            }
            "session.delete.cancel" => {
                p.only(&["operationId"])?;
                let id = p.text("operationId")?;
                let Completion::CancelDelete(cancelled) = self
                    .call(client, Operation::CancelDelete { id: id.clone() })
                    .await?
                else {
                    return Err(Failure::Internal);
                };
                return Ok(
                    json!({"operationId":id,"kind":"delete","status":if cancelled{"cancelled"}else{"completed"},"sessionId":if cancelled{Some(&id)}else{None},"scope":if cancelled{"one"}else{"all"},"targetResolutionSeconds":null,"completedSessions":if cancelled{0}else{1},"eligibleSessions":1,"error":null}),
                );
            }
            "session.prune.cancel" => {
                p.only(&["operationId"])?;
                Operation::CancelMaintenance {
                    id: p.text("operationId")?,
                }
            }
            "session.prune.preview" | "session.prune.start" => {
                p.only(&["scope", "sessionId", "targetResolutionSeconds"])?;
                return self.prune(client, p, method.ends_with("preview")).await;
            }
            _ => return Err(Failure::InvalidRequest),
        };
        match self.call(client, operation).await? {
            Completion::Permissions(rows) => Ok(projection::value(&rows)),
            Completion::Announcement { outcome } => Ok(json!({"outcome":outcome})),
            Completion::Unit => Ok(json!({"accepted":true})),
            Completion::Bluetooth(f) => Ok(projection::bluetooth(&f, false)),
            Completion::Location(f) => {
                let enabled = self
                    .publisher
                    .lock()
                    .map_err(|_| Failure::Internal)?
                    .facts
                    .as_ref()
                    .is_some_and(|f| f.settings.location_recording_enabled);
                Ok(projection::location(&f, enabled))
            }
            Completion::Settings(f) => Ok(projection::value(&f)),
            Completion::RideMarker { marker, boundary } => {
                Ok(json!({"marker":marker,"snapshot":projection::boundary(&boundary)}))
            }
            Completion::SavedBoard(f) => Ok(projection::value(&f)),
            Completion::Profile(f) => Ok(
                json!({"savedDeviceId":f.saved_device_id,"revision":f.revision,"missingFields":f.missing_fields,"values":serde_json::from_str::<Value>(&f.values_json).map_err(|_|Failure::Internal)?}),
            ),
            Completion::Controls(f) => Ok(projection::value(&f)),
            Completion::ConfigurationSummary(f) => Ok(projection::value(&f)),
            Completion::ConfigurationValues(f) => {
                let mut result = projection::value(&f);
                let publisher = self.publisher.lock().map_err(|_| Failure::Internal)?;
                result["identity"] = publisher
                    .facts
                    .as_ref()
                    .and_then(|f| projection::identity(&f.configuration))
                    .ok_or(Failure::Unavailable)?;
                Ok(result)
            }
            Completion::Tune(f) => projection::tune(&f, true),
            Completion::Tunes(f) => Ok(
                json!({"items":f.items.iter().map(|t|projection::tune(t,false)).collect::<Result<Vec<_>,_>>()?,"nextCursor":f.next_cursor}),
            ),
            Completion::Session(f) => {
                let permit = self
                    .history
                    .clone()
                    .try_acquire_owned()
                    .map_err(|_| Failure::Unavailable)?;
                Ok(projection::metadata(
                    &crate::reading::metadata(
                        f.clone(),
                        self.service_lease(&f.summary.session_id)?,
                        std::sync::Arc::new(permit),
                    )
                    .await?,
                ))
            }
            Completion::Export {
                file_name,
                presented,
                ..
            } => {
                Ok(json!({"fileName":file_name,"delivery":if presented{"presented"}else{"staged"}}))
            }
            Completion::Maintenance(Some(job)) => Ok(projection::maintenance(&job)),
            _ => Err(Failure::Internal),
        }
    }
    async fn session_list(&self, client: u64, p: Params<'_>) -> Result<Value, Failure> {
        let id = p.text("savedDeviceId")?;
        let limit = p.number("limit")?;
        if !(1..=100).contains(&limit) {
            return Err(Failure::InvalidRequest);
        }
        let history_id = self
            .publisher
            .lock()
            .map_err(|_| Failure::Internal)?
            .facts
            .as_ref()
            .and_then(|f| f.saved_boards.iter().find(|b| b.saved_device_id == id))
            .map(|b| b.device_history_id.clone())
            .ok_or(Failure::NotFound)?;
        let revision = self.catalog_revision()?;
        let outer = p.nullable("cursor")?;
        let inner = if let Some(raw) = outer {
            let c = decode_cursor(&raw, 1024)?;
            if c["version"] != 1
                || c["deviceHistoryId"] != history_id
                || c["query"] != "startedAt.desc.sessionId.desc"
            {
                return Err(Failure::InvalidRequest);
            }
            if c["catalogRevision"] != revision {
                return Err(Failure::Conflict);
            }
            Some(
                c["innerCursor"]
                    .as_str()
                    .ok_or(Failure::InvalidRequest)?
                    .to_owned(),
            )
        } else {
            None
        };
        let Completion::Sessions(page) = self
            .call(
                client,
                Operation::ListSessions {
                    history_id: Some(history_id.clone()),
                    limit: limit as usize,
                    cursor: inner,
                    completed_only: false,
                },
            )
            .await?
        else {
            return Err(Failure::Internal);
        };
        if self.catalog_revision()? != revision {
            return Err(Failure::Conflict);
        }
        let next=page.next_cursor.map(|inner|cursor(&json!({"version":1,"query":"startedAt.desc.sessionId.desc","deviceHistoryId":history_id,"catalogRevision":revision,"innerCursor":inner}))).transpose()?;
        if next.as_ref().is_some_and(|s| s.len() > 1024) {
            return Err(Failure::Internal);
        }
        Ok(json!({"items":page.items,"catalogRevision":revision,"nextCursor":next}))
    }
    async fn schema_page(&self, client: u64, raw: Option<&str>) -> Result<Value, Failure> {
        let Completion::ConfigurationSchema(schema) =
            self.call(client, Operation::ConfigurationSchema).await?
        else {
            return Err(Failure::Unavailable);
        };
        if schema.fields.len() > 512 || schema.groups.len() > 16 {
            return Err(Failure::Internal);
        }
        let index = if let Some(raw) = raw {
            let c = decode_cursor(raw, 512)?;
            if c["fingerprint"] != schema.fingerprint {
                return Err(Failure::InvalidRequest);
            }
            c["page"].as_u64().ok_or(Failure::InvalidRequest)? as usize
        } else {
            0
        };
        let by_name: std::collections::BTreeMap<_, _> =
            schema.fields.iter().map(|f| (&f.name, f)).collect();
        let mut pages = Vec::new();
        for group in &schema.groups {
            for subgroup in &group.subgroups {
                // Attach context before chunking so every page retains its heading.
                let mut heading = None;
                let fields: Vec<_> = subgroup
                    .fields
                    .iter()
                    .filter_map(|name| {
                        if let Some(label) = name.strip_prefix("::sep::") {
                            heading = Some(label.trim());
                            None
                        } else {
                            by_name.get(name).map(|field| (*field, heading))
                        }
                    })
                    .collect();
                for chunk in fields.chunks(32) {
                    pages.push((&group.name, &subgroup.name, chunk.to_vec()));
                }
            }
        }
        let (group, subgroup, fields) = pages.get(index).ok_or(Failure::InvalidRequest)?;
        let fields:Vec<_>=fields.iter().map(|(f, heading)|json!({"heading":heading,"name":f.name,"label":f.long_name,"type":match f.field_type{1=>"double",2=>"integer",3=>"string",4=>"enum",5=>"boolean",_=>"bitfield"},"defaultValue":f.default_value,"minimum":f.minimum,"maximum":f.maximum,"step":f.step,"precision":f.precision,"wireMinimum":f.wire_minimum,"wireMaximum":f.wire_maximum,"editorScale":f.editor_scale,"editAsPercentage":f.edit_as_percentage,"suffix":f.suffix,"choices":f.choices,"description":f.description,"tunable":f.tunable})).collect();
        let identity = self
            .publisher
            .lock()
            .map_err(|_| Failure::Internal)?
            .facts
            .as_ref()
            .and_then(|f| projection::identity(&f.configuration))
            .ok_or(Failure::Unavailable)?;
        Ok(
            json!({"identity":identity,"group":group,"subgroup":subgroup,"fields":fields,"nextCursor":if index+1<pages.len(){Some(cursor(&json!({"fingerprint":schema.fingerprint,"page":index+1}))?)}else{None}}),
        )
    }
}
