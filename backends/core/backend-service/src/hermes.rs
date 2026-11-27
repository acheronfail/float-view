//! Ride Hermes policy. Native hosts present credentials, protect the account and execute HTTPS.
use crate::{
    BackendService,
    operations::Failure,
    os::{Effect, HermesAction},
    store_failure,
};
use float_view_product_store::{Session, SessionLease};
use float_view_session_sqlite::{
    LocationPage, PublishedBoundary, RecordingBreak, SampleKey, SessionReader,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::PathBuf;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

const ORGANIZATION: Option<&str> = option_env!("FLOAT_VIEW_HERMES_ORGANIZATION");
const AUTH_KEY: Option<&str> = option_env!("FLOAT_VIEW_HERMES_AUTH_API_KEY");
const RIDES_KEY: Option<&str> = option_env!("FLOAT_VIEW_HERMES_RIDES_API_KEY");
const PLACEHOLDER: &str = "pending-hermes-registration";
const MAX_POINTS: usize = 2_000;
const MAX_BYTES: usize = 384 * 1024;
const FRESHNESS_MS: u64 = 1_000;
const MAX_SAMPLES: usize = 200_000;
const TOO_LARGE: &str = "This route exceeds the Ride Hermes upload limit.";

pub(super) struct Hermes {
    path: PathBuf,
    registration: Option<Registration>,
    account: Option<Account>,
    generation: u64,
    pending: Option<(u64, u64, Work)>,
    status: &'static str,
    message: Option<&'static str>,
}

#[derive(Clone, Copy)]
struct Registration {
    organization: &'static str,
    auth_key: &'static str,
    rides_key: &'static str,
}

enum Route {
    Auth,
    Rides,
}

#[derive(Deserialize, Serialize)]
struct Account {
    id: String,
    name: String,
    token: String,
}

enum Work {
    Read,
    Prompt,
    Authenticate(String),
    Store(Account),
    Clear,
    Upload {
        account: String,
        session: String,
        previous: String,
    },
}

impl Hermes {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            registration: Self::registration(),
            account: None,
            generation: 0,
            pending: None,
            status: "unavailable",
            message: None,
        }
    }

    fn registration() -> Option<Registration> {
        let registration = Registration {
            organization: ORGANIZATION.unwrap_or(PLACEHOLDER),
            auth_key: AUTH_KEY.unwrap_or(PLACEHOLDER),
            rides_key: RIDES_KEY.unwrap_or(PLACEHOLDER),
        };
        [
            registration.organization,
            registration.auth_key,
            registration.rides_key,
        ]
        .into_iter()
        .all(|value| {
            value != PLACEHOLDER
                && !value.is_empty()
                && value.len() <= 256
                && value.bytes().all(|byte| byte.is_ascii_graphic())
        })
        .then_some(registration)
    }

    fn receipts(&self) -> Result<Connection, Failure> {
        let connection = Connection::open(&self.path).map_err(|_| Failure::Internal)?;
        connection.execute_batch("CREATE TABLE IF NOT EXISTS uploads (account TEXT NOT NULL, session TEXT NOT NULL, status TEXT NOT NULL, ride TEXT, PRIMARY KEY (account, session)) STRICT;")
            .map_err(|_| Failure::Internal)?;
        Ok(connection)
    }

    fn receipt(&self, account: &str, session: &str) -> Result<(String, Option<String>), Failure> {
        self.receipts()?
            .query_row(
                "SELECT status, ride FROM uploads WHERE account=?1 AND session=?2",
                params![account, session],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map(|v| v.unwrap_or_else(|| ("ready".into(), None)))
            .map_err(|_| Failure::Internal)
    }

    fn save(
        &self,
        account: &str,
        session: &str,
        status: &str,
        ride: Option<&str>,
    ) -> Result<(), Failure> {
        let connection = self.receipts()?;
        let changed = connection.execute(
            "INSERT INTO uploads(account, session, status, ride)
             SELECT ?1, ?2, ?3, ?4 WHERE EXISTS(SELECT 1 FROM uploads WHERE account=?1 AND session=?2)
               OR (SELECT count(*) FROM uploads)<100000
             ON CONFLICT(account, session) DO UPDATE SET status=excluded.status, ride=excluded.ride",
            params![account, session, status, ride]).map_err(|_| Failure::Internal)?;
        if changed == 1 {
            Ok(())
        } else {
            Err(Failure::Unavailable)
        }
    }

    fn account_from_response(body: &str, email: String) -> Option<Account> {
        let value: Value = serde_json::from_str(body).ok()?;
        let user = value.get("user")?;
        let account = Account {
            id: wire_id(user.get("id")?)?,
            token: value.get("auth_token")?.as_str()?.into(),
            name: user
                .get("username")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .or_else(|| user.get("email").and_then(Value::as_str))
                .unwrap_or(&email)
                .chars()
                .take(120)
                .collect(),
        };
        account.valid().then_some(account)
    }
}

impl Account {
    fn valid(&self) -> bool {
        !self.id.is_empty()
            && self.id.len() <= 128
            && !self.name.is_empty()
            && self.name.len() <= 480
            && !self.token.is_empty()
            && self.token.len() <= 2048
            && self.token.bytes().all(|byte| byte.is_ascii_graphic())
    }
}

fn wire_id(value: &Value) -> Option<String> {
    let identifier = value
        .as_u64()
        .filter(|n| *n > 0)
        .map(|n| n.to_string())
        .or_else(|| value.as_str().map(str::to_owned))?;
    (!identifier.is_empty()
        && identifier.len() <= 128
        && identifier
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_')))
    .then_some(identifier)
}

impl BackendService {
    pub(crate) fn initialize_hermes(&mut self) -> Result<(), Failure> {
        if self.hermes.registration.is_some() {
            self.hermes.status = "loading";
            self.hermes_effect(HermesAction::Read, None, Work::Read, 15_000)?;
            self.changed()?;
        }
        Ok(())
    }

    pub fn hermes_state(&self) -> Value {
        json!({"status":self.hermes.status, "account":self.hermes.account.as_ref().map(|a| &a.name),
            "generation":self.hermes.generation, "message":self.hermes.message})
    }

    fn hermes_effect(
        &mut self,
        action: HermesAction,
        body: Option<String>,
        work: Work,
        timeout: u64,
    ) -> Result<(), Failure> {
        let id = self.policy.exchange.id()?;
        self.policy.exchange.push(Effect::Hermes {
            id,
            action,
            data: body.map(crate::os::PrivateText),
        })?;
        self.hermes.pending = Some((id, self.monotonic_ms().saturating_add(timeout), work));
        Ok(())
    }

    fn hermes_request(&mut self, route: Route, body: String, work: Work) -> Result<(), Failure> {
        let registration = self.hermes.registration.ok_or(Failure::Unavailable)?;
        let (route, key) = match route {
            Route::Auth => ("auth", registration.auth_key),
            Route::Rides => ("rides", registration.rides_key),
        };
        let data = json!({"route":route, "organization":registration.organization, "api_key":key,
            "token":self.hermes.account.as_ref().map(|a| &a.token), "body":body});
        self.hermes_effect(HermesAction::Request, Some(data.to_string()), work, 30_000)
    }

    pub fn hermes_sign_in(&mut self) -> Result<(), Failure> {
        self.hermes.registration.ok_or(Failure::Unavailable)?;
        if self.hermes.pending.is_some() || self.hermes.account.is_some() {
            return Err(Failure::Conflict);
        }
        self.hermes_effect(HermesAction::Prompt, None, Work::Prompt, 120_000)?;
        self.hermes.status = "signingIn";
        self.hermes.message = None;
        self.changed()
    }

    pub fn hermes_disconnect(&mut self) -> Result<(), Failure> {
        if self.hermes.account.is_none() {
            return Err(Failure::InvalidState);
        }
        if let Some((
            id,
            _,
            Work::Upload {
                account,
                session,
                previous,
            },
        )) = self.hermes.pending.as_ref()
        {
            if self.policy.exchange.cancel_hermes(*id) {
                self.hermes.save(account, session, previous, None)?;
            }
        } else if self.hermes.pending.is_some() {
            return Err(Failure::Conflict);
        }
        self.clear_hermes(None)?;
        self.changed()
    }

    fn clear_hermes(&mut self, message: Option<&'static str>) -> Result<(), Failure> {
        self.hermes_effect(HermesAction::Clear, None, Work::Clear, 15_000)?;
        self.hermes.generation += 1;
        self.hermes.account = None;
        self.hermes.status = "loading";
        self.hermes.message = message;
        Ok(())
    }

    pub(crate) fn expire_hermes(&mut self) -> Result<(), Failure> {
        if let Some((id, deadline, _)) = &self.hermes.pending
            && *deadline <= self.monotonic_ms()
        {
            self.complete_hermes(*id, 0, None)?;
            self.changed()?;
        }
        Ok(())
    }

    pub(crate) fn complete_hermes(
        &mut self,
        id: u64,
        code: u16,
        data: Option<String>,
    ) -> Result<(), Failure> {
        let Some((_, _, work)) = self
            .hermes
            .pending
            .take_if(|(expected, _, _)| *expected == id)
        else {
            return Ok(());
        };
        let data = data.filter(|text| text.len() <= 32 * 1024);
        match work {
            Work::Read if code != 200 => {
                self.hermes.status = "unavailable";
                self.hermes.message = Some(
                    "Could not read the saved Ride Hermes sign-in. Restart the app to try again.",
                );
            }
            Work::Read => {
                self.hermes.account = data
                    .as_deref()
                    .and_then(|v| serde_json::from_str::<Account>(v).ok())
                    .filter(Account::valid);
                self.hermes.status = if self.hermes.account.is_some() {
                    "linked"
                } else {
                    "signedOut"
                };
                if self.hermes.account.is_some() {
                    self.hermes.generation += 1;
                }
            }
            Work::Prompt => {
                #[derive(Deserialize)]
                struct SignIn {
                    email: String,
                    password: String,
                }
                let credentials = data
                    .as_deref()
                    .and_then(|data| serde_json::from_str::<SignIn>(data).ok());
                match credentials {
                    Some(SignIn { email, password })
                        if !email.trim().is_empty()
                            && email.len() <= 320
                            && !password.is_empty()
                            && password.len() <= 1024 =>
                    {
                        let email = email.trim().to_owned();
                        let body = json!({"email":email, "password":password}).to_string();
                        if self
                            .hermes_request(Route::Auth, body, Work::Authenticate(email))
                            .is_ok()
                        {
                            return Ok(());
                        }
                        self.hermes.message = Some("Could not start sign-in. Please try again.");
                    }
                    _ if code == 0 => {
                        self.hermes.message = Some("Could not open Ride Hermes sign-in.")
                    }
                    _ if code == 200 => {
                        self.hermes.message = Some("Enter a valid email and password.")
                    }
                    _ => {}
                }
                self.hermes.status = "signedOut";
            }
            Work::Authenticate(email) => {
                let account = (200..300)
                    .contains(&code)
                    .then(|| {
                        data.as_deref()
                            .and_then(|v| Hermes::account_from_response(v, email))
                    })
                    .flatten();
                if let Some(account) = account {
                    let body = serde_json::to_string(&account).map_err(|_| Failure::Internal)?;
                    if self
                        .hermes_effect(
                            HermesAction::Store,
                            Some(body),
                            Work::Store(account),
                            15_000,
                        )
                        .is_ok()
                    {
                        return Ok(());
                    }
                }
                self.hermes.status = "signedOut";
                self.hermes.message = Some(
                    "Ride Hermes could not sign you in. Check your credentials and connection.",
                );
            }
            Work::Store(account) => {
                if code == 200 {
                    self.hermes.account = Some(account);
                    self.hermes.generation += 1;
                    self.hermes.status = "linked";
                } else {
                    self.hermes.status = "signedOut";
                    self.hermes.message = Some("Could not save your Ride Hermes sign-in securely.");
                }
            }
            Work::Clear => {
                self.hermes.status = if code == 200 {
                    "signedOut"
                } else {
                    "unavailable"
                };
                if code != 200 {
                    self.hermes.message = Some("Could not remove the saved Ride Hermes sign-in.");
                }
            }
            Work::Upload {
                account, session, ..
            } => {
                let ride = (200..300)
                    .contains(&code)
                    .then(|| {
                        let response: Value = serde_json::from_str(data.as_deref()?).ok()?;
                        wire_id(response.get("ride")?.get("id")?)
                    })
                    .flatten();
                let status = if ride.is_some() {
                    "confirmed"
                } else if (400..500).contains(&code) && code != 408 {
                    "failed"
                } else {
                    "uncertain"
                };
                self.hermes
                    .save(&account, &session, status, ride.as_deref())?;
                if matches!(code, 401 | 403) {
                    self.clear_hermes(Some(
                        "Your Ride Hermes sign-in has expired. Sign in again.",
                    ))?;
                }
            }
        }
        Ok(())
    }

    pub fn hermes_ride(&self, id: &str) -> Result<Value, Failure> {
        let account = self.hermes.account.as_ref().ok_or(Failure::InvalidState)?;
        let session = self.store.session(id).map_err(store_failure)?;
        let (mut status, ride) = self.hermes.receipt(&account.id, id)?;
        if matches!(&self.hermes.pending, Some((_, _, Work::Upload { account: owner, session, .. })) if owner == &account.id && session == id)
        {
            status = "sending".into();
        }
        let reason = if self
            .policy
            .ride
            .as_ref()
            .is_some_and(|ride| ride.session_id == id)
        {
            Some("Finish this ride before uploading.")
        } else {
            basic_eligibility(&session)
        };
        Ok(
            json!({"status":status, "rideId":ride, "revision":session.history_revision,
            "generation":self.hermes.generation, "reason":reason}),
        )
    }

    pub fn hermes_source(
        &self,
        id: &str,
        revision: u64,
        generation: u64,
    ) -> Result<(Session, SessionLease), Failure> {
        if self.hermes.account.is_none() || self.hermes.generation != generation {
            return Err(Failure::Conflict);
        }
        let session = self.store.session(id).map_err(store_failure)?;
        if session.history_revision != revision
            || self
                .policy
                .ride
                .as_ref()
                .is_some_and(|ride| ride.session_id == id)
        {
            return Err(Failure::Conflict);
        }
        Ok((
            session,
            self.store.lease_session(id).map_err(store_failure)?,
        ))
    }

    pub fn hermes_upload(
        &mut self,
        id: &str,
        revision: u64,
        generation: u64,
        retry: bool,
        body: String,
    ) -> Result<(), Failure> {
        let _source = self.hermes_source(id, revision, generation)?;
        let account = self
            .hermes
            .account
            .as_ref()
            .ok_or(Failure::InvalidState)?
            .id
            .clone();
        if self.hermes.pending.is_some() {
            return Err(Failure::Conflict);
        }
        let (status, _) = self.hermes.receipt(&account, id)?;
        if status == "confirmed" || (status == "uncertain" && !retry) {
            return Err(Failure::Conflict);
        }
        self.hermes.save(&account, id, "uncertain", None)?;
        if let Err(error) = self.hermes_request(
            Route::Rides,
            body,
            Work::Upload {
                account: account.clone(),
                session: id.into(),
                previous: status.clone(),
            },
        ) {
            self.hermes.save(&account, id, &status, None)?;
            return Err(error);
        }
        self.changed()
    }
}

fn basic_eligibility(session: &Session) -> Option<&'static str> {
    if session.state == "active" || session.ended_at_ms.is_none() || session.integrity == "corrupt"
    {
        Some("Finish this ride before uploading.")
    } else if session.stored_location_count < 3 {
        Some("This ride needs at least three recorded GPS points.")
    } else if session
        .distance_m
        .is_none_or(|distance| !distance.is_finite() || distance < 100.)
    {
        Some("This ride needs at least 100 metres of recorded distance.")
    } else {
        None
    }
}

pub fn prepare_ride(
    session: Session,
    lease: SessionLease,
) -> Result<Result<String, &'static str>, Failure> {
    if let Some(reason) = basic_eligibility(&session) {
        return Ok(Err(reason));
    }
    let boundary = PublishedBoundary {
        history_revision: session.history_revision,
        sample_sequence: session.committed_sequence,
        event_sequence: session.committed_event_sequence,
        location_sequence: session.committed_location_sequence,
    };
    let mut reader = SessionReader::open(lease.path()).map_err(|_| Failure::Internal)?;
    let limit = session
        .committed_elapsed_ms
        .max(session.committed_location_elapsed_ms);
    let locations = reader
        .location_page(0, limit, MAX_POINTS, None, boundary)
        .map_err(|_| Failure::Internal)?;
    if locations.next_location_sequence.is_some() {
        return Ok(Err(TOO_LARGE));
    }
    let breaks = reader
        .recording_breaks(boundary)
        .map_err(|_| Failure::Internal)?;
    let mut speeds = Vec::new();
    let mut after = None;
    let mut sample_count = 0;
    let field = ["speedKph".to_owned()];
    loop {
        let page = reader
            .sample_page(&field, 0, limit, 2_000, after, boundary)
            .map_err(|_| Failure::Internal)?;
        sample_count += page.rows.len();
        if sample_count > MAX_SAMPLES || (sample_count == MAX_SAMPLES && page.next.is_some()) {
            return Ok(Err(TOO_LARGE));
        }
        speeds.extend(page.rows.into_iter().filter_map(|row| {
            row.values
                .first()
                .copied()
                .flatten()
                .filter(|speed| speed.is_finite())
                .map(|speed| (row.key, speed))
        }));
        if page.next.is_none() {
            break;
        }
        after = page.next;
    }
    build_payload(
        locations,
        &speeds,
        &breaks,
        session.distance_m.ok_or(Failure::InvalidState)?,
    )
}

fn build_payload(
    locations: LocationPage,
    speeds: &[(SampleKey, f64)],
    breaks: &[RecordingBreak],
    distance_m: f64,
) -> Result<Result<String, &'static str>, Failure> {
    let speed_at = |t| {
        nearest_board_speed(speeds, t, |start, end| {
            breaks
                .iter()
                .any(|g| g.start_elapsed_ms < end && start < g.end_elapsed_ms)
                || locations
                    .gaps
                    .iter()
                    .any(|g| g.start_elapsed_ms < end && start < g.end_elapsed_ms)
        })
    };
    let mut points = Vec::new();
    let mut coordinates = Vec::new();
    let mut first = None;
    let mut last = None;
    for location in locations.rows {
        let t = location.elapsed_ms;
        let Some(speed) = speed_at(t) else {
            continue;
        };
        let timestamp = hermes_date(location.observed_at_epoch_ms)?;
        first.get_or_insert((t, timestamp.clone()));
        last = Some((t, timestamp.clone()));
        coordinates.push((location.latitude, location.longitude));
        points.push(json!({"lat":location.latitude, "lng":location.longitude, "timestamp":timestamp,
            "speed":speed / 1.609_344, "altitude":location.altitude_m.unwrap_or(0.), "accuracy":location.accuracy_m.unwrap_or(0.)}));
    }
    let Some(((start, start_time), (end, end_time))) = first
        .zip(last)
        .filter(|((start, _), (end, _))| end.saturating_sub(*start) >= 60_000 && points.len() >= 3)
    else {
        return Ok(Err(
            "This ride needs at least three GPS points with matching board speed over 60 seconds.",
        ));
    };
    let payload = json!({"title":"Float View ride", "desc":"Recorded by Float View", "polyline":polyline(coordinates),
        "distance":distance_m, "elapsed_time":(end-start)/1000, "start_time":start_time, "end_time":end_time,
        "user_vehicle_id":null, "locations_attributes":points}).to_string();
    Ok(if payload.len() <= MAX_BYTES {
        Ok(payload)
    } else {
        Err(TOO_LARGE)
    })
}

fn nearest_board_speed(
    speeds: &[(SampleKey, f64)],
    elapsed_ms: u64,
    crosses_gap: impl Fn(u64, u64) -> bool,
) -> Option<f64> {
    let lower =
        speeds.partition_point(|(key, _)| key.elapsed_ms < elapsed_ms.saturating_sub(FRESHNESS_MS));
    speeds[lower..]
        .iter()
        .take_while(|(key, _)| key.elapsed_ms <= elapsed_ms.saturating_add(FRESHNESS_MS))
        .filter(|(key, _)| {
            !crosses_gap(
                elapsed_ms.min(key.elapsed_ms),
                elapsed_ms.max(key.elapsed_ms),
            )
        })
        .min_by_key(|(key, _)| (key.elapsed_ms.abs_diff(elapsed_ms), key.sequence))
        .map(|(_, speed)| *speed)
}

fn hermes_date(ms: i64) -> Result<String, Failure> {
    OffsetDateTime::from_unix_timestamp(ms.div_euclid(1000))
        .ok()
        .and_then(|value| value.format(&Rfc3339).ok())
        .ok_or(Failure::InvalidState)
}

fn polyline(points: Vec<(f64, f64)>) -> String {
    let mut encoded = String::new();
    let mut previous = [0i64, 0i64];
    for (lat, lng) in points {
        for (value, previous) in [lat, lng].into_iter().zip(&mut previous) {
            let current = (value * 100_000. + 0.5).floor() as i64;
            let delta = current - *previous;
            *previous = current;
            let mut bits = ((delta << 1) ^ (delta >> 63)) as u64;
            while bits >= 32 {
                encoded.push(((bits & 31) as u8 + 95) as char);
                bits >>= 5;
            }
            encoded.push((bits as u8 + 63) as char);
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        let mut random = [0u8; 8];
        getrandom::fill(&mut random).unwrap();
        let root =
            std::env::temp_dir().join(format!("float-view-hermes-{}", u64::from_ne_bytes(random)));
        std::fs::create_dir(&root).unwrap();
        root
    }

    #[test]
    fn aligns_signed_board_speed_with_deterministic_ties_and_freshness() {
        let speeds = [
            (
                SampleKey {
                    elapsed_ms: 0,
                    sequence: 1,
                },
                20.,
            ),
            (
                SampleKey {
                    elapsed_ms: 1_900,
                    sequence: 2,
                },
                -16.09344,
            ),
            (
                SampleKey {
                    elapsed_ms: 2_100,
                    sequence: 3,
                },
                25.,
            ),
        ];
        assert_eq!(
            nearest_board_speed(&speeds, 2_000, |_, _| false),
            Some(-16.09344)
        );
        assert_eq!(
            nearest_board_speed(&speeds, 2_000, |a, b| a < 1_950 && b > 1_950),
            Some(25.)
        );
        assert_eq!(nearest_board_speed(&speeds, 3_101, |_, _| false), None);
        assert_eq!(
            polyline(vec![(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]),
            "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
        );
        assert_eq!(
            hermes_date(1_700_000_000_123).unwrap(),
            "2023-11-14T22:13:20Z"
        );
    }

    #[test]
    fn encodes_only_matched_locations_and_preserves_real_elevation() {
        use float_view_session_sqlite::{LocationGap, LocationRecord};

        let times = [0, 15_000, 30_000, 60_000];
        let locations = LocationPage {
            rows: times
                .into_iter()
                .enumerate()
                .map(|(index, elapsed_ms)| LocationRecord {
                    location_sequence: index as u64 + 1,
                    elapsed_ms,
                    observed_at_epoch_ms: 1_700_000_000_000 + elapsed_ms as i64,
                    latitude: 40. + index as f64 * 0.001,
                    longitude: -120.,
                    altitude_m: [None, Some(20.), Some(0.), Some(-15.)][index],
                    accuracy_m: [None, Some(1.), Some(2.), Some(3.)][index],
                })
                .collect(),
            gaps: vec![LocationGap {
                start_elapsed_ms: 30_000,
                end_elapsed_ms: 60_000,
            }],
            published_location_sequence: 4,
            next_location_sequence: None,
        };
        let speeds = [0, 30_000, 60_000]
            .into_iter()
            .enumerate()
            .map(|(index, elapsed_ms)| {
                (
                    SampleKey {
                        elapsed_ms,
                        sequence: index as u64 + 1,
                    },
                    -16.09344,
                )
            })
            .collect::<Vec<_>>();
        let encoded = build_payload(locations, &speeds, &[], 101.)
            .unwrap()
            .unwrap();
        let body: Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(body["distance"], 101.);
        assert_eq!(body["elapsed_time"], 60);
        assert_eq!(body["start_time"], "2023-11-14T22:13:20Z");
        assert_eq!(body["end_time"], "2023-11-14T22:14:20Z");
        assert!(body["user_vehicle_id"].is_null());
        let points = body["locations_attributes"].as_array().unwrap();
        assert_eq!(points.len(), 3);
        assert_eq!(points[0]["altitude"], 0.);
        assert_eq!(points[0]["accuracy"], 0.);
        assert_eq!(points[1]["altitude"], 0.);
        assert_eq!(points[2]["altitude"], -15.);
        assert_eq!(points[2]["accuracy"], 3.);
        assert!((points[2]["speed"].as_f64().unwrap() + 10.).abs() < 0.00001);
    }

    #[test]
    fn native_sign_in_keeps_credentials_out_of_public_state() {
        let root = temp_root();
        let mut service = BackendService::open(&root.join("Sessions")).unwrap();
        service.hermes.registration = Some(Registration {
            organization: "test-org",
            auth_key: "test-auth-key",
            rides_key: "test-rides-key",
        });
        service.initialize_hermes().unwrap();
        let (id, _, _) = service.hermes.pending.as_ref().unwrap();
        service.complete_hermes(*id, 200, None).unwrap();
        service.hermes_sign_in().unwrap();
        let (id, _, _) = service.hermes.pending.as_ref().unwrap();
        service
            .complete_hermes(
                *id,
                200,
                Some(
                    json!({"email":"rider@test.invalid","password":"private-password"}).to_string(),
                ),
            )
            .unwrap();
        let (id, _, work) = service.hermes.pending.as_ref().unwrap();
        assert!(matches!(work, Work::Authenticate(_)));
        service
            .complete_hermes(
                *id,
                200,
                Some(
                    json!({"auth_token":"private-token","user":{"id":42,"username":"Rider"}})
                        .to_string(),
                ),
            )
            .unwrap();
        let (id, _, work) = service.hermes.pending.as_ref().unwrap();
        assert!(matches!(work, Work::Store(_)));
        service.complete_hermes(*id, 200, None).unwrap();
        assert_eq!(
            service.hermes_state(),
            json!({"status":"linked","account":"Rider","generation":1,"message":null})
        );
        assert!(!format!("{:?}", service.drain_os()).contains("private-"));
        drop(service);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn receipt_is_durable_and_scoped_to_the_sending_account() {
        let root = temp_root();
        let path = root.join("hermes.sqlite");
        let hermes = Hermes::new(path.clone());
        hermes.save("first", "ride-1", "uncertain", None).unwrap();
        drop(hermes);
        let hermes = Hermes::new(path);
        assert_eq!(
            hermes.receipt("second", "ride-1").unwrap(),
            ("ready".into(), None)
        );
        assert_eq!(
            hermes.receipt("first", "ride-1").unwrap(),
            ("uncertain".into(), None)
        );
        hermes
            .save("first", "ride-1", "confirmed", Some("23"))
            .unwrap();
        assert_eq!(
            hermes.receipt("first", "ride-1").unwrap(),
            ("confirmed".into(), Some("23".into()))
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
