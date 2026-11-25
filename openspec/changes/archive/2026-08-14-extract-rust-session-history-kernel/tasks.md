## 1. Candidate boundary and shared evidence

- [x] 1.1 Add `session-history-kernel` to the locked Rust workspace with a standard-library-only manifest and document its unselected future-persistence ownership.
- [x] 1.2 Add literal shared series and prune fixtures covering canonical edge/tie/gap/phase/protection/eight-cap behavior without importing frontend or native implementations.
- [x] 1.3 Extend the root verification audit to require the candidate/fixtures and reject host selection, bridge crates, copied runtime sources, SQLite/network/runtime dependencies, and native-file changes.

## 2. Historical series reduction

- [x] 2.1 Implement bounded field/range/bucket/gap/cadence configuration and stable payload-free errors with checked allocation/arithmetic.
- [x] 2.2 Implement ordered incremental first/minimum/maximum/last reduction, chronological tie resolution, role deduplication, null/gap generations, and finite 65,536-observation output.
- [x] 2.3 Add shared-vector tests for explicit/automatic gaps, phase cadence, retained resolution, late fields, ties, dense buckets, and deterministic final column order.
- [x] 2.4 Add adversarial tests for every configuration/input bound, descending/duplicate keys, arity, non-finite values, overflow, generation exhaustion, and partial-publication rejection.

## 3. Prune selection

- [x] 3.1 Implement ordered elapsed-zero-aligned bucket selection with protected endpoints, first field sources, riding transitions, and caller-protected semantic sources.
- [x] 3.2 Implement deterministic ordinary first/last/extrema maximum coverage, chronological ties, uncovered-role reporting, and the eight-row cap.
- [x] 3.3 Return finalized bucket selections incrementally and release raw bucket state before accepting later unbounded history.
- [x] 3.4 Add shared-vector and adversarial tests for protection, ties, multi-role/dense coverage, bucket transitions, repeated aligned coarser selection, invalid ordering/resolution, and bounded memory state.

## 4. Focused and repository verification

- [x] 4.1 Run candidate unit/integration tests, the ownership/dependency audit, `cargo fmt --check`, and warnings-denied offline locked workspace linting.
- [x] 4.2 Run strict change validation, `git diff --check`, and the complete `just verify` software gate.

## 5. Physical regression and completion

- [x] 5.1 Run the canonical ESP32 fixture matrix on the macOS host and record every non-location checkpoint.
- [x] 5.2 Run the canonical ESP32 fixture matrix on the connected Android device, including background continuity; defer only bounded location acquisition.
- [x] 5.3 Run the canonical ESP32 fixture matrix on the connected iOS device, including background continuity; defer only bounded location acquisition.
- [x] 5.4 Confirm no production Apple/Android/frontend/SQL source or package input changed, record verification evidence, and mark the change ready for implementation commit, spec sync, and archive.

## Verification evidence


Software verification passed. Applicable macOS/Android fixture checkpoints and iOS foreground scenarios passed; iOS background BLE/session observations passed.
Mobile location acquisition remained deferred. Where the iOS XCTest passed but its parent process timed out, the parent run is not recorded as a clean pass.

Detailed execution history and device records are retained locally under
`.local/physical-testing/`. This summary applies only to the archived change.

Recorded change revision: [fae1678f](https://github.com/acheronfail/float-view/commit/fae1678f8755795a2b2d5ef4862318eaf6a3f9ac)
(historical record, not a verified binary hash).
