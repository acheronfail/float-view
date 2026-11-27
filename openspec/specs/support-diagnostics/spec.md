# Support Diagnostics Specification

## Purpose

Let users preserve useful local failure context and deliberately share a bounded, sanitized diagnostic report through public GitHub issues.

## Requirements

### Requirement: Collection independent of recording

The process-owned service SHALL collect structured diagnostics before discovery and connection, independently of recording, tracking mode and disposable frontend lifetime. Diagnostic collection SHALL NOT create a saved board, ride, location record or session catalog entry.

#### Scenario: Initial identification fails

- **WHEN** a connection fails before firmware identification or session creation
- **THEN** its setup timeline and bounded failure reason are available for incident capture and export without a recording

#### Scenario: Guest or discarded provisional session

- **WHEN** a guest connection fails or an unretained saved-mode session is deleted
- **THEN** diagnostic incidents remain available under their own retention policy without retaining guest telemetry or the deleted ride

#### Scenario: Frontend recreation

- **WHEN** a WebView is recreated during a connection or capture
- **THEN** collection continues where OS execution is permitted and the replacement frontend can list existing incidents

### Requirement: Structured failure context

Reports SHALL include available app/build/channel, platform/OS/model, compatibility and configuration-schema facts, connection stages, request outcomes/timings, protocol failure categories, lifecycle/permission states, queue/loss metrics and storage/UI failure codes. Unknown facts SHALL remain unknown. Every event SHALL identify its process run, connection generation and operation when applicable.

#### Scenario: Unsupported firmware

- **WHEN** discovery observes unsupported firmware or an unaudited schema
- **THEN** the report includes bounded validated version/schema facts, the discovery stage and rejection category without fabricating motor or battery identity

#### Scenario: Reconnect and stale callback

- **WHEN** an old callback arrives after a replacement connection starts
- **THEN** diagnostics distinguish generations and identify the ignored callback without attributing it to the replacement controller

#### Scenario: Decode failure

- **WHEN** a response fails framing, CRC, extent, layout or value validation
- **THEN** diagnostics include available command kind, byte count and closed failure category without retaining response bytes or rejected values

#### Scenario: Candidate build identity

- **WHEN** a store archive is built from a numbered release candidate
- **THEN** its diagnostic report retains the full candidate tag and candidate channel while Apple's marketing version remains numeric

#### Scenario: Small timing samples and scheduler outcomes

- **WHEN** timing summaries have one or two observations or a request completes without a response
- **THEN** nearest-rank p50/p95 remain ordered within the maximum and every closed scheduler outcome, including sent-only/queue-full/stale, is preserved

#### Scenario: Independent connection generation namespaces

- **WHEN** the controller protocol generation changes within a transport connection
- **THEN** request and activation records retain distinct transport and application generation fields, independently rebased for export, without conflating equal numeric values across namespaces

### Requirement: Automatic and manual incidents

The service SHALL capture up to 30 seconds of available recent events and up to 10 seconds of subsequent events around detected connection, protocol, configuration, storage or UI failures and a manual problem mark. Reports SHALL disclose clipping, coalescing and interrupted capture. Repeated automatic failures SHALL be coalesced within 60 seconds; manual capture SHALL admit at most one new incident per 10 seconds.

#### Scenario: Undetected visible problem

- **WHEN** the backend receives a manual capture request without a detected error
- **THEN** the service captures current bounded context and returns an incident identifier without requiring an error or active controller

#### Scenario: Error storm

- **WHEN** repeated failures occur within the automatic coalescing interval
- **THEN** occurrence counts and the latest reason are retained within bounds without allocating another incident for every failure

#### Scenario: Background or process interruption

- **WHEN** background suspension, shutdown or process death prevents completion of the subsequent-event window
- **THEN** committed context remains readable after restart and the incident reports its incomplete window without starting background execution solely to finish diagnostics

### Requirement: Bounded retention and nonblocking failure

Diagnostic journal and incident files SHALL occupy at most 8 MiB, retain at most ten incidents of at most 1 MiB each, and expire records after seven days. In-memory recent context SHALL contain at most 256 events of at most 1,024 bytes each. Work queues, retries and waits SHALL have numeric limits. Saturation or diagnostic I/O failure SHALL NOT block Bluetooth, telemetry or product persistence.

#### Scenario: Retention limit

- **WHEN** a new incident exceeds the retained count or byte budget
- **THEN** oldest eligible diagnostic data is evicted deterministically and losses are disclosed without deleting product records or user-exported files

#### Scenario: Saturated or unavailable writer

- **WHEN** diagnostic storage is full, locked, protected or unavailable, or the queue fills
- **THEN** collection degrades boundedly, reports its availability/loss counters where possible, and does not recursively log its own failure

#### Scenario: Diagnostic corruption

- **WHEN** a diagnostic file is malformed or has an unsupported version
- **THEN** supported product data and the unrecognized file remain untouched, collection/export reports the limitation, and no compatibility reset occurs

#### Scenario: Ten incident retention across restarts

- **WHEN** ten incidents fit within the existing byte budget and the app restarts
- **THEN** all ten remain available until expiry or eviction, and an eleventh evicts the oldest eligible incident

### Requirement: Privacy by construction

Stored and exported diagnostics SHALL contain only bounded structured fields and classified diagnostic content. Configuration contents, telemetry values, schema fingerprints/signatures and sanitized protocol bytes SHALL be permitted. Coordinates, travelled routes, device identities, nicknames, credentials, paths and arbitrary firmware/error text SHALL remain excluded. Exports SHALL use report-local correlation and relative event times. Nothing SHALL be uploaded automatically.

#### Scenario: Adversarial private values

- **WHEN** device names, firmware text, OS errors, frontend errors or identity/location-bearing protocol responses contain private sentinel strings, coordinates, credentials or control characters
- **THEN** neither local diagnostic records, prepared summary, ZIP, filename nor GitHub URL contains those values

#### Scenario: Useful hardware model

- **WHEN** a device or firmware reports arbitrary model text
- **THEN** only a recognized normalized model/version or bounded structural facts are retained; unrecognized text is represented as unknown

#### Scenario: Uncorrelated reports

- **WHEN** reports are prepared separately for the same controller
- **THEN** they contain no stable device alias or digest allowing device matching across reports

#### Scenario: Authorized technical content

- **WHEN** configuration work or telemetry exchanges are captured
- **THEN** configuration values and actual schema identities, decoded non-location telemetry and classified packet bytes are available within unchanged event/report bounds with explicit fragment offsets and truncation disclosure

#### Scenario: Packet privacy boundary

- **WHEN** packets contain routing wrappers, firmware identities, location fields or unclassified contents
- **THEN** excluded fields are redacted or that raw packet is omitted with a closed reason; arbitrary unknown bytes are never dumped, and available decoded non-location telemetry remains eligible

### Requirement: Immutable report preparation and export

The export flow SHALL automatically prepare an immutable sanitized report for the newest retained incident or current context when none exists, then export exactly that report as a ZIP of at most 5 MiB. The ZIP SHALL contain only `report.md`, `events.jsonl` and `manifest.json`, including diagnostic format version, report ID, capture bounds, omissions, loss counts and completeness. Full recording archives SHALL NOT be embedded.

#### Scenario: Context changes after preparation

- **WHEN** new failures occur after a report is prepared
- **THEN** export uses the prepared report without silently adding subsequent events or another controller's context

#### Scenario: Report expired or cleared

- **WHEN** export names an expired, cleared or foreign prepared-report identifier
- **THEN** it fails with a stable bounded error and requires fresh preparation rather than substituting current context

#### Scenario: Export with product storage failure

- **WHEN** the service is running but session creation, catalog work or ride export fails
- **THEN** diagnostic preparation and staging can proceed through independent diagnostic storage if that storage is available

#### Scenario: Partial export or frontend loss

- **WHEN** preparation/export fails, is cancelled or loses its requesting frontend
- **THEN** partial staging is reclaimed within bounded limits; an already presented file remains valid until native completion or bounded abandonment

#### Scenario: Current context contains configuration contents

- **WHEN** a current-context export is prepared while configuration is available and no error incident was captured
- **THEN** the immutable report includes the current permitted configuration contents and schema identity without creating an incident or changing product state

### Requirement: Single-button reporting

Settings and relevant error surfaces SHALL offer the same single-button export flow on desktop and touch, without a visible preview, incident picker or additional diagnostic controls. Concise text SHALL explain privacy exclusions, manual GitHub attachment and public visibility. Capture limitations SHALL remain in the exported report. The backend clear operation SHALL remain supported without deleting product data, revoking active native file presentation or deleting external copies.

#### Scenario: Primary pointer and keyboard activation

- **WHEN** a user activates a reporting control with a primary pointer or keyboard
- **THEN** the action occurs once; non-primary activation and cancelled gestures do not trigger it

#### Scenario: Clear while recording

- **WHEN** the user clears diagnostics during a ride
- **THEN** retained journal/incidents and unpresented prepared reports are cleared while recording, connections and product revisions remain unchanged; later events can begin new diagnostics

### Requirement: Manual GitHub reporting instructions

After export, the flow SHALL explain where and how users can manually report a reproducible bug and attach the ZIP on the repository's GitHub Issues page. It SHALL explain public visibility and checking existing issues. It SHALL NOT prefill issues, launch an issue composer, upload files, submit issues or require app-held GitHub credentials.

#### Scenario: Manual bug report

- **WHEN** a user finishes exporting diagnostics
- **THEN** instructions identify the public repository Issues page and explain checking duplicates, writing reproduction steps and expected/actual behavior, adding optional hardware details and manually attaching the ZIP; any link opens only the Issues list

#### Scenario: Browser or sign-in unavailable

- **WHEN** the browser cannot open GitHub or the user cannot sign in
- **THEN** the exported ZIP remains usable and no diagnostic upload is attempted

### Requirement: Supported data compatibility

Diagnostic storage and report versions SHALL be independent of owned product storage and portable session archive versions. New collection SHALL NOT rewrite supported catalogs, session schemas, historical diagnostic rows or archives. Frozen baseline fixtures and existing imports SHALL remain supported without a reset or pre-baseline recovery path.

#### Scenario: Upgrade and reopen

- **WHEN** this feature opens a supported baseline catalog and imports a baseline recording
- **THEN** product records and historical diagnostic rows retain their existing semantics and independently owned diagnostic storage remains separate from product records

#### Scenario: Restartable diagnostic format upgrade

- **WHEN** supported version-1 diagnostics are opened by the version-2 collector or an upgrade is interrupted
- **THEN** existing incident and journal contents are preserved through an explicit restartable marker transition; unknown markers, corrupt data and operational errors preserve files and fail actionably

### Requirement: Explain configuration operation failures

Configuration and control diagnostics SHALL retain admission, completion and rejection context: failure layer/category, authoritative write blocker, readiness, pending work, revision and identity match facts, and transport/application correlation when available. Context SHALL be captured at the operation boundary with permitted technical contents, excluding device identities and raw errors. Public error behavior and mutation authorization SHALL remain unchanged.

#### Scenario: Rejected configuration write

- **WHEN** a write is rejected by readiness, safety, pending work, identity or revision checks
- **THEN** diagnostics distinguish those conditions using closed codes and structural facts from that attempt, including missing or unknown facts

#### Scenario: Accepted operation fails later

- **WHEN** admitted configuration work fails during scheduling, acknowledgement, readback, timeout or connection replacement
- **THEN** diagnostics retain its bounded correlation, available failure category and completion outcome so rejection can be distinguished from a failed accepted operation

#### Scenario: Coalesced late rejection

- **WHEN** a rejection joins an incident after its subsequent-event window closes
- **THEN** its failure context remains in the exported incident within existing event and byte bounds, without reopening the window

#### Scenario: Private request inputs

- **WHEN** device identities, credentials or unrelated unrecognized input fields contain private text
- **THEN** failure records and exported ZIPs retain permitted technical content while preserving the remaining privacy exclusions

#### Scenario: Audited prerelease context

- **WHEN** a connected controller reports an audited stable, beta2 or beta3 Refloat release
- **THEN** diagnostic compatibility context retains numeric version components and its closed release suffix without accepting arbitrary firmware text

#### Scenario: Observed schema rejected for admission

- **WHEN** a structurally valid schema fails audited configuration admission
- **THEN** diagnostics retain its observed fingerprint and wire signature without granting write authority or retaining untrusted schema text
