## MODIFIED Requirements

### Requirement: Durable detailed telemetry lifecycle

The shared service SHALL persist normalized telemetry, discrete events and commit markers atomically before publication, preserve the release-specific slow/fast merge and expose only committed records through live state, history and export. Storage compatibility follows [backend-contract](../backend-contract/spec.md#requirement-supported-current-storage-schema).

#### Scenario: Merge command-31/32 telemetry

- **WHEN** a current commands-31/32 compact response is accepted
- **THEN** it replaces the compact cache and its `slowObservedAt`; the next accepted realtime response merges that cache into one normalized sample

#### Scenario: Commit one normalized observation

- **WHEN** a release-selected fast response merges the latest accepted slow cache
- **THEN** it receives one monotonic session sequence and commits bounded typed details, extensions and deduplicated source-linked discrete transitions atomically
- **AND** live state, history and export derive only from those normalized committed records and events

#### Scenario: Persist and recover detailed sample

- **WHEN** a detailed sample is accepted and the frontend is recreated
- **THEN** the live snapshot and session metadata/data recover the same committed values and sequence without requiring the WebView to have observed the original event

#### Scenario: Selectable slow merge

- **WHEN** an accepted Refloat 1.3.0 slow response is followed by a current-generation fast response
- **THEN** the resulting sample contains the latest slow typed and extension values with their `slowObservedAt` and one new monotonic sample sequence

#### Scenario: Device counter decreases

- **WHEN** a compact or selectable slow response reports an odometer or energy total lower than the latest cached value
- **THEN** the backend accepts the new finite protocol-valid value, records its new `slowObservedAt`, and does not clamp or reconstruct the old value

#### Scenario: Partial storage failure

- **WHEN** durable storage cannot commit a detailed sample
- **THEN** no partially populated sample is exposed as committed and the existing bounded failure and session-integrity rules apply

#### Scenario: Detailed export

- **WHEN** a session containing detailed and extension telemetry is exported
- **THEN** the export contains stable typed names, bounded extension values, nulls for unavailable fields, and no private Bluetooth or controller identifier
