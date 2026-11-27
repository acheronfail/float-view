# Backend Contract Delta

## ADDED Requirements

### Requirement: Mandatory Ride Hermes controls and status

The mandatory backend contract SHALL expose platform-neutral Hermes sign-in, disconnect, session eligibility, upload, and recovery actions with stable result and error envelopes. It SHALL expose bounded account identity in authoritative state and bounded per-session status through authenticated reads. A build without partner configuration SHALL expose the same contract and report Hermes as unavailable.

#### Scenario: Sign-in action

- **WHEN** the frontend requests Hermes sign-in on a configured native host
- **THEN** the backend starts native credential entry and reports only bounded operation status and display identity

#### Scenario: Session status after frontend recreation

- **WHEN** an authenticated frontend reopens a session during or after an upload
- **THEN** the backend reports the account-scoped state of that upload through the same read contract

#### Scenario: Partner configuration absent

- **WHEN** the frontend requests Hermes status or an action on a build without partner configuration
- **THEN** the same contract reports Hermes unavailable without initiating a sign-in or network request

### Requirement: Hermes credential isolation

The authenticated loopback contract, state snapshots, routine diagnostics, and portable exports SHALL exclude Hermes passwords, rider tokens, and partner credentials.

#### Scenario: Authentication or upload error

- **WHEN** a Hermes request fails and the backend emits an error, state transition, or diagnostic
- **THEN** it uses bounded, actionable information without including credentials or the uploaded route
