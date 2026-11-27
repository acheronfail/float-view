# Session Location Recording Delta

## MODIFIED Requirements

### Requirement: Privacy-preserving location handling

Default native logs and routine diagnostics SHALL omit coordinates and altitude. Authoritative application state SHALL limit live position data to the latest accepted route fix. Recorded location tracks SHALL remain accessible through bounded authenticated session reads, explicit user-requested export, and an individually confirmed submission to Ride Hermes.

#### Scenario: State event

- **WHEN** a location row is durably appended and state changes are published
- **THEN** the state event can advance location status, boundary metadata and the latest live fix without including a recorded location track

#### Scenario: Export request

- **WHEN** the user explicitly requests a session export with GPS export enabled
- **THEN** the backend presents the CSV with GPS columns through the existing native save/share flow and does not emit coordinates to default logs

#### Scenario: Confirmed Ride Hermes submission

- **WHEN** the rider confirms submission of a prepared session to the linked Hermes account
- **THEN** the backend releases only the recorded route and measurements authorized for that submission, independently of the CSV GPS export setting
