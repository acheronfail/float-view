## ADDED Requirements

### Requirement: Nullable altitude in historical location points

Every point in an authenticated `locations` result SHALL expose `altitudeM` as a finite number in metres above the WGS84 ellipsoid or `null`. Its availability SHALL follow the same published snapshot boundary as the point.

#### Scenario: Page includes mixed altitude availability

- **WHEN** a bounded page includes points with and without recorded altitude
- **THEN** each point returns its recorded altitude or `null` alongside its existing timestamp and coordinates

### Requirement: Nullable altitude on the current route fix

The current connection's latest accepted live route fix SHALL expose `altitudeM` in metres above the WGS84 ellipsoid or `null`. The live snapshot SHALL expose only the latest fix's altitude. The fix SHALL clear when route capture stops or is replaced.

#### Scenario: Route fix changes or recording stops

- **WHEN** a route observation is accepted with valid or unavailable altitude
- **THEN** the snapshot publishes the matching number or `null`
- **AND** pausing, ending, disabling, or losing authorization for route recording clears that connection's current fix

## MODIFIED Requirements

### Requirement: Location setting and permission state

The authenticated contract SHALL include `locationRecordingEnabled` and `includeGpsLocationWhenExporting` in the complete persisted settings shape and expose bounded location authorization, status and action availability through authoritative state. Both settings SHALL default to `false`. Location status SHALL contain only capability and boundary metadata. The current route fix SHALL be separate from location status.

#### Scenario: Settings round trip

- **WHEN** the frontend updates `locationRecordingEnabled` at the current settings revision
- **THEN** the backend persists and returns the boolean at a newer revision on every supported target

#### Scenario: State status

- **WHEN** location authorization or recording eligibility changes
- **THEN** the backend publishes a newer complete state containing bounded status/action information without a location track
