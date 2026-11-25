## 1. Consolidated package and immutable evidence

- [x] 1.1 Rename the unselected crate/package from `session-sqlite-writer` to `session-sqlite`, retain the complete `SessionWriter` API and tests, and remove every superseded writer-only workspace/recipe/path reference.
- [x] 1.2 Rename the writer fixtures to `backends/fixtures/session-sqlite` and add literal reader requests/expected projections for metadata, fields, stable/extension/null series, sample/event/location pages, gaps, published boundaries, and continuation keys.
- [x] 1.3 Replace the writer-only root test/audit recipes with consolidated session SQLite recipes that require the exact dependency graph and reject old paths, host selection, reader/writer bridges, generated bindings, arbitrary public SQL, copied native code, and production source/schema changes.

## 2. Read-only lifecycle, schema, and boundary ownership

- [x] 2.1 Add stable payload-free reader errors and bounded owned metadata, marker, field descriptor, published boundary, range, continuation key, page, event, location, and reduction values with redacted debug output.
- [x] 2.2 Implement independent read-only/no-mutex open, short busy handling, integrity and exact canonical table/index/singleton/cadence/marker/field validation, and close/drop behavior without mutation or filesystem discovery.
- [x] 2.3 Implement one deferred read transaction per query that validates equal history revision plus nonfuture sample/event/location boundaries inside the snapshot and releases on every exit.
- [x] 2.4 Expose a safe cloneable interrupter around SQLite cancellation, map interruption to the closed cancelled error, and prove the reader remains reusable after cancellation.

## 3. Bounded fields, samples, and series reduction

- [x] 3.1 Add the closed 36-field stable catalogue, admit bounded unique extension names only from durable field evidence, parameter-bind extension JSON paths, and reject unsupported/malformed/nonfinite values without caller-controlled SQL identifiers.
- [x] 3.2 Implement lossless 1–2,000-row sample pages ordered by `(elapsed_ms, sequence)`, capped by range/published sequence and optional continuation key, with exact nullable values and has-more key behavior.
- [x] 3.3 Implement streaming 1–16-field series scans capped at 200,000 source rows and feed exact ride phases, cadences, retained resolution, and gap policy directly into `session-history-kernel::SeriesAccumulator` for 1–1,024 buckets and bounded columns.
- [x] 3.4 Add exact and adversarial tests for every field/range/bucket/source/page/integer bound, stable/extension/null/tie/gap behavior, unsafe names/JSON, malformed values, boundary mismatches, continuation order, and no partial results.

## 4. Bounded event and location pages

- [x] 4.1 Implement 1–500-row supported transition-event pages ordered by `(elapsed_ms, sequence)`, capped by the published event boundary and optional continuation key, with exact details JSON and nullable source sequence.
- [x] 4.2 Implement 1–2,000-row location pages ordered by `(elapsed_ms, location_sequence)`, capped by the published boundary and optional prior sequence, with exact observations, greater-than-ten-second `noFix` gaps, boundary, and has-more sequence.
- [x] 4.3 Add exact/adversarial tests for all supported and excluded event kinds, malformed details/source facts, location boundaries/order/coordinates/accuracy, page edges, gap edges, stale/future boundaries, and transaction cleanup.

## 5. WAL concurrency and repository verification

- [x] 5.1 Add active-WAL tests proving an older published reader snapshot remains stable while `SessionWriter` commits newer samples/locations, writer progress is not obstructed, and a later read observes the newer marker.
- [x] 5.2 Exercise cancellation during a maximum bounded scan plus corrupt/incompatible/busy/locked databases and prove prompt resource release, reader reuse, payload-free diagnostics, and no file mutation/checkpoint.
- [x] 5.3 Run locked offline session SQLite tests/audits, existing writer parity, schema/dependency/ownership audits, formatting, and warnings-denied workspace linting.
- [x] 5.4 Run strict OpenSpec validation, `git diff --check`, and the complete `just verify` software gate.

## 6. Physical regression and completion

- [x] 6.1 Run the canonical ESP32 fixture matrix on the macOS host and record every non-location checkpoint.
- [x] 6.2 Run the canonical ESP32 fixture matrix on the connected Android device, including background BLE/session persistence; defer only bounded location acquisition.
- [x] 6.3 Run the canonical ESP32 fixture matrix on the connected iOS device, including background BLE/session persistence; defer only bounded location acquisition.
- [x] 6.4 Confirm the implementation commit contains no production Apple/Android/frontend/SQL source or package input, record exact verification evidence, and mark the change ready for canonical spec sync and archive.

## Verification Evidence


Software verification passed. Applicable macOS and mobile fixture matrices passed, including background BLE/session continuity.
Mobile timed location acquisition remained deferred; these checks do not establish a new background GPS fix.

Detailed execution history and device records are retained locally under
`.local/physical-testing/`. This summary applies only to the archived change.

Recorded change revision: [fae1c832](https://github.com/acheronfail/float-view/commit/fae1c8326c73176176caf338d5a287c7517f9792)
(historical record, not a verified binary hash).
