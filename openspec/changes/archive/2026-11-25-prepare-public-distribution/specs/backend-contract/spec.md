## MODIFIED Requirements

### Requirement: Supported current storage schema

The shared service SHALL use canonical SQLite schemas, WAL recovery and integrity handling while preserving baseline 100 and subsequent supported data. Incompatible supported transitions require incremented storage markers and explicit crash-safe tested upgrades. Only recognised pre-baseline markers and validated owned layouts permit bounded restartable development reset; unsupported or damaged storage fails without deletion.

#### Scenario: Persist complete session evidence

- **WHEN** the service commits telemetry or updates session history
- **THEN** it retains dedicated nullable stable numeric columns, bounded negotiated extension JSON and write-time field presence, ordered source-linked transition rows, elapsed indexes, incremental auto-vacuum, session-captured riding/idle intervals and history/prune metadata
- **AND** one atomic authoritative marker records sample/event boundaries, recorded/stored counts, history revision, elapsed coverage and the bounded riding/distance/maximum/source-sequence/last-value projection needed for catalog recovery; the catalog retains bounded prune-job progress
- **AND** denormalized catalog metadata is reconciled from that marker before an interrupted or dirty session is published or appended again

#### Scenario: Storage admission

- **WHEN** existing storage is opened
- **THEN** baseline and subsequent supported data are preserved; unknown/newer/malformed markers, missing markers on nonempty roots, corruption and operational failures preserve files and fail actionably
- **AND** any recognized pre-baseline reset is limited to validated owned development files, excludes exports and never introduces legacy readers, backfill or identity aliases solely to recover development data

#### Scenario: Interrupted session recovery

- **WHEN** the backend starts with an interrupted active session whose session marker is newer than its catalog row
- **THEN** it performs bounded integrity recovery, reconciles published boundaries and counts from the session database, and only then exposes the recovered result

#### Scenario: Catalog update fails after session commit

- **WHEN** a session transaction commits but its denormalized catalog update fails in the running process
- **THEN** the backend marks that session dirty, publishes no newer boundary, and reconciles from the marker before accepting another append or metadata read

#### Scenario: Late extension field

- **WHEN** a valid extension field first appears after the first 2,000 committed samples
- **THEN** snapshot metadata includes it through write-time field presence without scanning or sampling the ride
