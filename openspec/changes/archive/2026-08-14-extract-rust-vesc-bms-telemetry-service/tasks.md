## 1. Candidate Model and Composition Boundary

- [x] 1.1 Add `float-view-vesc-bms-telemetry-service` to the locked workspace with unsafe code forbidden and only auxiliary discovery, BMS values, and request scheduler as production dependencies.
- [x] 1.2 Define validated service configuration, request/timer identities, complete owned/redacted BMS observations, commands, snapshots, failures, diagnostics, and ordered effects.
- [x] 1.3 Implement exhaustive bounded conversion from borrowed command-96 values and exact read-only direct/CAN scan, firmware, and values scheduler facts.

## 2. BMS Application Lifecycle

- [x] 2.1 Compose auxiliary begin, reusable/preferred/enumerated discovery, CAN results, firmware results, probe/scan failure, selected route, and initial values work without host execution.
- [x] 2.2 Implement one current values poll, completion-driven 1,000 ms timer replacement, exact context/route/generation attribution, cancellation, reset, and stale/repeated event rejection.
- [x] 2.3 Implement single-failure accounting for timeout, queue-full, enqueue rejection, and malformed response; capped three-failure unavailability; retained observation; valid-response reset and recovery.
- [x] 2.4 Preserve standalone direct-BMS behavior, controller independence, read-only command safety, deterministic effect order, atomic validation, and explicit wrapping counter semantics.

## 3. Parity, Adversarial, and Isolation Evidence

- [x] 3.1 Add committed shared source-derived lifecycle vectors covering controller-attached and standalone direct/preferred/reused/enumerated discovery, polling, failure, recovery, and reset.
- [x] 3.2 Add focused tests for exact scheduler facts/bytes, every command-96 field, maximum collections/status, all scheduler completions, three-failure boundaries, stale/mismatched orders, invalid routes and observation-time boundaries, timer and generation rollover, privacy, and no mutation commands.
- [x] 3.3 Update workspace locks, core ownership documentation, focused root recipes, and repository audits to require the exact three-dependency unselected candidate and forbid host selection, bridges, callbacks, executors, persistence, sockets, or packaged artifacts.

## 4. Verification

- [x] 4.1 Run focused tests/audits, formatting, warnings-denied locked workspace linting, strict OpenSpec validation, and `git diff --check`.
- [x] 4.2 Run `just verify` with both selected native BMS lifecycle owners unchanged.
- [x] 4.3 Run the canonical ESP32 physical matrix on the connected Android device, connected iOS device, and macOS host; require every non-location product checkpoint and defer only bounded location acquisition per the agreed manual follow-up.

## Verification Evidence


Applicable macOS/Android fixture checkpoints and iOS foreground scenarios passed; iOS background BLE/session observations passed.
Mobile location acquisition remained deferred. Where the iOS XCTest passed but its parent process timed out, the parent run is not recorded as a clean pass.

Detailed execution history and device records are retained locally under
`.local/physical-testing/`. This summary applies only to the archived change.

Recorded change revision: [fae18c7d](https://github.com/acheronfail/float-view/commit/fae18c7d10fb0556015b48d886655c8c46246d6e)
(historical record, not a verified binary hash).
