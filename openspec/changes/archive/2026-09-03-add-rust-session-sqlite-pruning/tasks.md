## 1. Pruning contract and immutable evidence

- [x] 1.1 Add literal prune input/expected fixtures for empty, dense, protected evidence, phase transitions, extrema ties, nearby/orphaned locations, initial, repeated-coarser, and no-op sessions.
- [x] 1.2 Extend the session SQLite audit recipe to require direct history-kernel composition and reject pruning bridges, generated bindings, copied native logic, host selection, schema drift, arbitrary public SQL, and production source changes.

## 2. Safe plan and lifecycle

- [x] 2.1 Add stable payload-free pruning errors and bounded owned preview/plan/result values with redacted diagnostics and private database identity/boundary state.
- [x] 2.2 Add validated session-pruner open/close/drop behavior and a cloneable SQLite interrupter without filesystem discovery, callbacks, threads, async runtime, or host policy.
- [x] 2.3 Validate target resolution, current retained-resolution alignment, schema/marker/data/count bounds, and source-row ceiling before publishing a plan.

## 3. Streaming preview selection

- [x] 3.1 Read numeric-field, event, and marker-summary source sequences inside one deferred snapshot and protect every referenced source row.
- [x] 3.2 Stream canonical samples ordered by elapsed/sequence directly through `session_history_kernel::PruneSelector`, collecting only sorted retained sequences and exact preview summary/boundary facts.
- [x] 3.3 Prove exact preview parity, repeated-coarser source-only behavior, no mutation, bounded live/source state, cancellation cleanup, and stable failures with fixture and adversarial tests.

## 4. Atomic prune commit

- [x] 4.1 Begin one immediate transaction, revalidate plan identity/marker/resolution, and reject stale, foreign, reused, or invalid plans before mutation.
- [x] 4.2 Persist a temporary bound keep set, delete only unretained samples and out-of-neighborhood locations, and atomically update prune metadata, stored counts, commit time, and one history revision while preserving recorded counts and published maxima.
- [x] 4.3 Preserve no-op databases exactly, drop temporary state on every exit, omit checkpoint/vacuum policy, and prove commit/reopen results plus foreign-key evidence preservation.
- [x] 4.4 Add active-WAL, busy/locked, interruption, every injected failure point, stale writer/pruner race, rollback, and post-failure reuse tests.

## 5. Repository verification

- [x] 5.1 Run locked offline session SQLite tests/audits, existing reader/writer/history parity, schema/dependency/ownership audits, formatting, and warnings-denied workspace linting.
- [x] 5.2 Run strict OpenSpec validation, `git diff --check`, and the complete `just verify` software gate.

## 6. Physical regression and completion

- [x] 6.1 Run the canonical ESP32 fixture matrix on the macOS host and record every non-location checkpoint.
- [x] 6.2 Record that no physical Android device is available, do not substitute emulator evidence, and defer its complete ESP32/background matrix to the migration-final gate before Rust runtime selection.
- [x] 6.3 Run the canonical ESP32 fixture matrix on the connected iOS device, including background BLE/session persistence; defer only bounded location acquisition.
- [x] 6.4 Confirm the implementation commit contains no production Apple/Android/frontend/SQL source or package input, record exact verification evidence, and mark the change ready for canonical spec sync and archive.

## Verification Evidence


Software verification passed. Applicable macOS and iOS fixture matrices passed, including iOS background BLE/session continuity.
iOS location acquisition remained deferred. No physical Android handset was available; its matrix remained deferred to migration-final acceptance.

Detailed execution history and device records are retained locally under
`.local/physical-testing/`. This summary applies only to the archived change.

Recorded change revision: [fae1acbc](https://github.com/acheronfail/float-view/commit/fae1acbce600675c87a93a438480cdb639a071bf)
(historical record, not a verified binary hash).
