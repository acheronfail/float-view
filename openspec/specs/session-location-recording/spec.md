# Session Location Recording Specification

## Purpose

Define optional native-owned location capture, persistence, lifecycle, privacy, battery, and export behavior for board sessions.

## Requirements

### Requirement: Optional location recording

The backend SHALL expose persisted `locationRecordingEnabled` and `includeGpsLocationWhenExporting` settings. Both SHALL default to `false`; the export setting SHALL affect only CSV output, and a disabled recording setting SHALL leave connection, board telemetry persistence, live review, and session history operating exactly as board-only behavior.

#### Scenario: Default board-only behavior

- **WHEN** a new backend is started with default settings
- **THEN** location recording is disabled and a connected board still creates and persists the normal board session

#### Scenario: Disable during a session

- **WHEN** the user disables location recording while a board session is active
- **THEN** the backend stops requesting new location observations, preserves already accepted location rows, and continues board logging

#### Scenario: Export option disabled

- **WHEN** a user exports a session while `includeGpsLocationWhenExporting` is false
- **THEN** the CSV contains the existing telemetry columns without GPS columns

#### Scenario: Adjacent export option

- **WHEN** the settings UI presents the location-recording control
- **THEN** it presents `includeGpsLocationWhenExporting` next to it, disabled by default and independently configurable

### Requirement: Cross-platform location authorization

The backend SHALL report a bounded location authorization state and SHALL provide an action to request the next supported permission or open platform settings when an OS re-prompt is unavailable. Permission resolution SHALL be native-owned and SHALL not block Bluetooth connection or board logging.

#### Scenario: Permission not determined

- **WHEN** the user enables location recording and the OS has not yet resolved location authorization
- **THEN** the backend immediately requests permission, authoritative state reports `notDetermined` until the OS responds, and the frontend remains non-blocking

#### Scenario: Permission denied

- **WHEN** the OS denies location authorization
- **THEN** authoritative state reports `denied`, board logging remains usable, and the retry action requests permission again or opens platform settings according to the OS capability

#### Scenario: Location unavailable

- **WHEN** the platform cannot provide location services
- **THEN** authoritative state reports `unavailable`, no capture job is started, and the active board session remains healthy

### Requirement: Native ride-scoped background capture

Native services SHALL own authorized capture across frontend destruction and supported mobile backgrounding. Route recording SHALL start only when an enabled board session enters `riding` and stop when riding ends, recording is disabled or authorization is lost. Explicit calibration SHALL independently permit bounded temporary capture while connected and authorized; calibration-only coordinates SHALL NOT be persisted.

#### Scenario: Riding starts

- **WHEN** an active board session enters `riding`, recording is enabled, and authorization permits capture
- **THEN** the native recorder starts a session-scoped provider stream without a frontend logging command

#### Scenario: Frontend recreation

- **WHEN** the WebView is destroyed while an authorized session is active
- **THEN** native capture and persistence continue where the OS permits and a replacement frontend recovers the status and location boundary

#### Scenario: Mobile background

- **WHEN** an iOS or Android application with the required background capability is sent to the background during an active `riding` state
- **THEN** the native recorder remains eligible to receive location updates and persists accepted observations without requiring the WebView

#### Scenario: Foreground-only authorization

- **WHEN** an active ride has foreground-only authorization and the application is backgrounded
- **THEN** capture is unavailable in the background, the backend publishes the bounded capability state, and board logging continues

#### Scenario: Calibration without route recording

- **WHEN** the rider explicitly starts speed calibration with route recording disabled
- **THEN** temporary location observations support calibration without saving coordinates or changing recording settings

### Requirement: Time-aligned location persistence

Each accepted location observation SHALL be persisted in the active session's location track with an independent monotonic sequence, session-relative monotonic `elapsedMs`, latitude, longitude, nullable horizontal accuracy, and an observation timestamp. Location rows SHALL be bounded, valid, and ordered by the native session clock rather than by frontend arrival order.

#### Scenario: Accepted observation

- **WHEN** the provider delivers a valid observation for the active session
- **THEN** the backend appends one location row with a strictly increasing location sequence and the native elapsed time at receipt

#### Scenario: Invalid observation

- **WHEN** a provider observation has an invalid coordinate or malformed payload beyond the documented storage bound
- **THEN** the backend rejects it without writing a row or publishing a location boundary beyond the last durable row

#### Scenario: Poor accuracy

- **WHEN** a provider delivers a valid coordinate with poor or missing horizontal accuracy
- **THEN** the backend persists the coordinate and preserves the reported accuracy value or null without applying a quality threshold

#### Scenario: Burst delivery

- **WHEN** the provider delivers multiple observations in one callback
- **THEN** the backend persists them in deterministic sequence order using bounded batching and publishes only after the durable append succeeds

### Requirement: Explicit gaps and no fabricated coordinates

Location readers and archive exports SHALL preserve accepted points and explicit unavailable/gap information. The backend MUST NOT create `(0,0)` placeholders, duplicate the last point as a new observation, or interpolate across an identified provider gap.

#### Scenario: Provider outage

- **WHEN** no accepted location fix exists for a bounded interval between two persisted observations
- **THEN** the location result includes a gap marker and no synthetic point for that interval

#### Scenario: No location at session start

- **WHEN** a session has board telemetry but no accepted location point
- **THEN** the session remains valid as board-only history and exposes no fabricated location track

### Requirement: Location lifecycle and retention parity

Location rows SHALL participate in the same provisional-session retention, interruption recovery, deletion, pruning, integrity checks, and export lifecycle as the containing board session. Location storage SHALL follow the supported-storage requirement in [backend-contract](../backend-contract/spec.md#requirement-supported-current-storage-schema); version mismatch alone never authorizes deletion.

#### Scenario: Rejected provisional session

- **WHEN** a provisional session closes without satisfying the existing minimum ride retention rule
- **THEN** its location rows and catalog entry are deleted together with its board rows

#### Scenario: Recovered active session

- **WHEN** native startup finds an interrupted session with durable location rows
- **THEN** recovery validates and exposes the last complete location boundary without exposing rows beyond that boundary

#### Scenario: Pruning

- **WHEN** a user confirms session pruning
- **THEN** the backend accounts for and removes location storage with the selected sessions and returns updated bounded metadata

### Requirement: Battery-conscious provider policy

The backend SHALL use native low-power/balanced provider configuration, an accuracy ceiling, and a minimum movement threshold where supported. It SHALL avoid duplicate observations, batch durable writes within bounds, and stop the provider promptly outside an enabled authorized active session or explicit bounded speed calibration. Calibration SHALL permit a temporary higher-accuracy provider request. The first version SHALL not expose a user-configurable polling interval.

#### Scenario: Idle or post-ride connection

- **WHEN** a board is connected but the authoritative ride state is not `riding`
- **THEN** the location provider is stopped unless explicit calibration is active, and no location updates are persisted

#### Scenario: Update accounting

- **WHEN** conformance or diagnostic instrumentation measures location delivery
- **THEN** it can observe bounded provider/update counts without logging coordinates or making the interval a user setting

### Requirement: Privacy-preserving location handling

Default native logs and routine diagnostics SHALL omit coordinates and altitude. Authoritative application state SHALL limit live position data to the latest accepted route fix. Recorded location tracks SHALL remain accessible through bounded authenticated session reads and explicit user-requested export.

#### Scenario: State event

- **WHEN** a location row is durably appended and state changes are published
- **THEN** the state event can advance location status, boundary metadata and the latest live fix without including a recorded location track

#### Scenario: Export request

- **WHEN** the user explicitly requests a session export with GPS export enabled
- **THEN** the backend presents the CSV with GPS columns through the existing native save/share flow and does not emit coordinates to default logs

### Requirement: Optional altitude on recorded route points

Each accepted route point SHALL preserve valid provider altitude in metres above the WGS84 ellipsoid when available. Missing or invalid altitude SHALL be stored as absent without dropping the point. Altitude SHALL follow the containing route point's retention, pruning and privacy rules.

#### Scenario: Provider reports valid altitude

- **WHEN** an authorized route observation is accepted with valid altitude, including zero or a negative value
- **THEN** the recorded point includes that altitude on its existing location sequence and timestamp

#### Scenario: Provider has no valid altitude

- **WHEN** a valid horizontal observation has no valid altitude
- **THEN** the route point remains available with absent altitude

#### Scenario: Calibration or disabled recording

- **WHEN** a location observation arrives outside eligible route recording
- **THEN** no route altitude is persisted

#### Scenario: Live fix and diagnostics

- **WHEN** a location point with altitude is recorded
- **THEN** authoritative state exposes altitude on the latest accepted live fix, and default logs and routine diagnostics omit it
