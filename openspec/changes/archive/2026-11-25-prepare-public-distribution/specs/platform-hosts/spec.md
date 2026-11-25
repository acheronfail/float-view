## MODIFIED Requirements

### Requirement: Native standalone session catalog and grouping removal

Apple and Android SHALL expose the same bounded `session.list` control operation over the same shared Rust session catalog.

#### Scenario: Keep catalog work out of telemetry snapshots

- **WHEN** the service lists sessions or publishes live state
- **THEN** the query SHALL use the catalog's `(started_at_ms, session_id)` keyset order, return at most the requested page size, encode the query shape/catalog revision/last-key context in its opaque cursor, and avoid offset scans. Complete state snapshot construction SHALL not query or serialize session summaries during telemetry-driven publication; it SHALL expose only the bounded session-catalog revision marker. The canonical schema, settings store, application service, loopback handlers, and mock SHALL contain no session-group tables, group-member tables, automatic-linking fields, group mutation ports, or linked-ride payloads. Only recognised pre-baseline owned development layouts may be reset; supported data is preserved and unsupported storage fails without deletion.

#### Scenario: Indexed session page

- **WHEN** both hosts serve successive valid `session.list` requests over a catalog larger than one page
- **THEN** both use the checked started-time/session-ID keyset order, return identical standalone summaries and continuation behavior, and do not use offset pagination

#### Scenario: Catalog query absent from telemetry snapshot

- **WHEN** a persisted telemetry sample invalidates application state
- **THEN** neither host queries or serializes a session-summary or group collection for that state event, and the unchanged session-catalog revision remains available

#### Scenario: Grouping removed from native surfaces

- **WHEN** a backend is built from the canonical supported schema and exposes settings or control methods
- **THEN** group tables, linked-ride records, automatic-linking options, and group/unlink operations are absent on Apple and Android

#### Scenario: Cursor context mismatch

- **WHEN** a session-list cursor is malformed, rebound to another query shape, or issued before a newer catalog revision
- **THEN** both hosts reject it with the same bounded error and do not return a mixed page
