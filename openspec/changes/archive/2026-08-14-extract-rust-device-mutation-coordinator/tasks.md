## 1. Candidate Model and Exact Dependencies

- [x] 1.1 Add `float-view-device-mutation-coordinator` to the locked workspace with unsafe code forbidden and only the six named safe Rust components as production dependencies.
- [x] 1.2 Define checked configure facts, authoritative control snapshots, closed mutation kinds, generation/sequence-qualified tokens, commands, outcomes, stable errors/diagnostics, and bounded ordered effects.
- [x] 1.3 Implement exact route/profile conversions and direct/once-forwarded scheduler request facts for package, flywheel, lighting, fatal clear, and controller shutdown without bridge records or host execution.

## 2. Authorization, Serialization, and Confirmation

- [x] 2.1 Implement atomic configure/reset with Rust-derived writable and shutdown capability, prior-generation invalidation, loading state, and no emitted mutation work.
- [x] 2.2 Apply current monotonic normalized telemetry and exact profile-matched lighting observations to package, flywheel, fatal, LED, and headlight state in source-equivalent confirmation order.
- [x] 2.3 Implement package, flywheel, lighting, fatal-clear, and shutdown authorization across the complete readiness/access/ride/package/footpad/fault/flywheel matrix, including no-request idempotence.
- [x] 2.4 Implement one configuration/Tune lease sharing the sole pending slot with controls and shutdown, with exact-token finish/failure/cancel/reset handling.
- [x] 2.5 Preserve flywheel enable/disable confirmation semantics, the active-running disable exception, telemetry-before-exclusion ordering, and failure of newly prohibited competing work.

## 3. Parity, Adversarial, and Isolation Evidence

- [x] 3.1 Add committed source-derived mutation lifecycle vectors covering every control family, configuration/Tune lease, direct/CAN shutdown, idempotence, confirmation, failure, cancellation, reconnect, and reset.
- [x] 3.2 Add exhaustive and adversarial tests for every compatibility/state combination, stale/mismatched/non-monotonic input, malformed lighting payload, competing work, exact request facts, maximum bounds, counter rollover, deterministic order, privacy, and panic-free rejection.
- [x] 3.3 Update workspace locks, core ownership documentation, focused root recipes, and repository audits to require the exact dependency set and forbid host selection, bridges, callbacks, executors, persistence, sockets, or packaged artifacts.

## 4. Software Verification

- [x] 4.1 Run focused mutation tests/audits, formatting, warnings-denied locked workspace linting, strict OpenSpec validation, and `git diff --check`.
- [x] 4.2 Run `just verify` with both selected native mutation/application owners unchanged.

## 5. Physical Regression

- [x] 5.1 Run the canonical ESP32 physical matrix on the macOS host and require every non-location product checkpoint.
- [x] 5.2 Run the canonical ESP32 physical matrix on the connected Android device and require every non-location product checkpoint, deferring only bounded location acquisition.
- [x] 5.3 Run the canonical ESP32 physical matrix on the connected iOS device and require every non-location product checkpoint, accepting the documented passed-XCTest plus continuous-background-traffic evidence if the parent `xcodebuild` exit hang recurs.

## Verification Evidence


Software verification passed. Applicable macOS/Android fixture checkpoints and iOS foreground scenarios passed; iOS background BLE/session observations passed.
Mobile location acquisition remained deferred. Where the iOS XCTest passed but its parent process timed out, the parent run is not recorded as a clean pass.

Detailed execution history and device records are retained locally under
`.local/physical-testing/`. This summary applies only to the archived change.

Recorded change revision: [fae1582e](https://github.com/acheronfail/float-view/commit/fae1582e2cd5875672a868109b38af8b51b5ada1)
(historical record, not a verified binary hash).
