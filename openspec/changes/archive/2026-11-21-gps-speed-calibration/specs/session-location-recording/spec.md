# Location recording delta

## MODIFIED Requirements

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

### Requirement: Battery-conscious provider policy

The backend SHALL use native low-power/balanced provider configuration, an accuracy ceiling, and a minimum movement threshold where supported. It SHALL avoid duplicate observations, batch durable writes within bounds, and stop the provider promptly outside an enabled authorized active session or explicit bounded speed calibration. Calibration SHALL permit a temporary higher-accuracy provider request. The first version SHALL not expose a user-configurable polling interval.

#### Scenario: Idle or post-ride connection

- **WHEN** a board is connected but the authoritative ride state is not `riding`
- **THEN** the location provider is stopped unless explicit calibration is active, and no location updates are persisted

#### Scenario: Update accounting

- **WHEN** conformance or diagnostic instrumentation measures location delivery
- **THEN** it can observe bounded provider/update counts without logging coordinates or making the interval a user setting
