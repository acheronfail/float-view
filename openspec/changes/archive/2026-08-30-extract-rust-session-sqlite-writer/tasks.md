## 1. Candidate boundary and locked evidence

- [x] 1.1 Add `session-sqlite-writer` to the locked Rust workspace with direct `refloat-telemetry-service`, maintained bundled SQLite, and deterministic JSON dependencies only.
- [x] 1.2 Add literal sample/location input and expected database-state fixtures covering canonical creation, nulls, extensions, transitions, duplicate replay, extrema ties, multiple batches, and reopen.
- [x] 1.3 Extend root verification to require the crate/fixtures, exact schema inclusion and dependency allowlist, and reject host selection, bridge crates, copied native sources, catalog/server/runtime ownership, generated bindings, and production native/frontend/SQL changes.

## 2. Canonical session file lifecycle

- [x] 2.1 Implement stable payload-free errors, bounded public metadata/location/marker values, redacted debug output, checked SQLite integer conversion, and candidate-owned temporary path cleanup.
- [x] 2.2 Implement new-file creation from byte-exact `backends/sql/session.sql`, metadata/marker initialization, checkpoint/close, and atomic target publication without overwrite.
- [x] 2.3 Implement compatible-file open and validation for integrity, required canonical tables/indexes/singletons, positive cadence metadata, and incompatible/corrupt rejection without mutation.
- [x] 2.4 Add independent tests for exact schema/pragmas/initial rows, existing-target preservation, failed-create cleanup, compatible reopen, and malformed/corrupt database rejection.

## 3. Atomic telemetry writer

- [x] 3.1 Validate 1–1,024 strictly ordered samples, durable integer extents, finite optional numerics, closed wire mappings, and 32-name/64-byte/16,384-byte deterministic extension JSON bounds before mutation.
- [x] 3.2 Implement one immediate transaction for canonical sample insertion/replay, first stable/extension numeric-field sources, changed transition events, and durable event sequencing.
- [x] 3.3 Stream ordered durable rows in Rust to recompute and atomically publish exact marker sequences/counts/time, riding elapsed, trapezoidal distance, absolute extrema with earliest source ties, and last speed/state.
- [x] 3.4 Add fixture and adversarial tests for null/extension values, transitions, duplicates, tie sources, missing prior speed, multi-batch/reopen equivalence, every input bound, and deterministic redacted failures.

## 4. Atomic location writer and transaction recovery

- [x] 4.1 Validate and deterministically order 1–1,024 location observations with durable time/elapsed, coordinate, accuracy, and numeric bounds.
- [x] 4.2 Implement one immediate transaction for elapsed/coordinate deduplication, consecutive location sequences, and exact committed/recorded/stored/status marker updates.
- [x] 4.3 Add fixture/adversarial tests for unordered input, boundary coordinates, nullable accuracy, duplicate-only batches, multi-batch/reopen continuation, and invalid location rollback.
- [x] 4.4 Inject mid-sample and mid-location SQLite failures and prove each entire batch rolls back while prior durable rows, fields, events, counts, and marker state remain unchanged.

## 5. Focused and repository verification

- [x] 5.1 Run locked offline writer unit/integration tests, schema/dependency/ownership audits, formatting, and warnings-denied workspace linting.
- [x] 5.2 Run strict change validation, `git diff --check`, and the complete `just verify` software gate.

## 6. Physical regression and completion

- [x] 6.1 Run the canonical ESP32 fixture matrix on the macOS host and record every non-location checkpoint.
- [x] 6.2 Run the canonical ESP32 fixture matrix on the connected Android device, including background BLE/session persistence; defer only bounded location acquisition.
- [x] 6.3 Run the canonical ESP32 fixture matrix on the connected iOS device, including background BLE/session persistence; defer only bounded location acquisition.
- [x] 6.4 Confirm no production Apple/Android/frontend/SQL source or package input changed, record exact verification evidence, and mark the change ready for implementation commit, canonical spec sync, and archive.

## Verification Evidence


Software verification passed. Applicable macOS and mobile fixture matrices passed, including background BLE/session continuity.
Mobile timed location acquisition remained deferred; these checks do not establish a new background GPS fix.

Detailed execution history and device records are retained locally under
`.local/physical-testing/`. This summary applies only to the archived change.

Recorded change revision: [fae1a175](https://github.com/acheronfail/float-view/commit/fae1a1752633323233745e1e043ad0f45aa7a9f6)
(historical record, not a verified binary hash).
