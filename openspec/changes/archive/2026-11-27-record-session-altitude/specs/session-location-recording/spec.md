## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Privacy-preserving location handling

Default native logs and routine diagnostics SHALL omit coordinates and altitude. Authoritative application state SHALL limit live position data to the latest accepted route fix. Recorded location tracks SHALL remain accessible through bounded authenticated session reads and explicit user-requested export.

#### Scenario: State event

- **WHEN** a location row is durably appended and state changes are published
- **THEN** the state event can advance location status, boundary metadata and the latest live fix without including a recorded location track

#### Scenario: Export request

- **WHEN** the user explicitly requests a session export with GPS export enabled
- **THEN** the backend presents the CSV with GPS columns through the existing native save/share flow and does not emit coordinates to default logs
