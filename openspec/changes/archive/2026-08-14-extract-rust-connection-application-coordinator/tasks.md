## 1. Candidate Model and Composition Boundary

- [x] 1.1 Add `float-view-connection-application-coordinator` to the locked workspace with unsafe code forbidden and only the eight named safe Rust components as production dependencies.
- [x] 1.2 Define validated begin/activation facts, connection phases, request/deadline/timer identities, commands, snapshots, stable failures/diagnostics, and bounded ordered effects.
- [x] 1.3 Implement exact checked route conversion and read-only discovery request facts for direct/CAN firmware, CAN ping, and Refloat INFO without bridge records or host execution.

## 2. Discovery, Scheduling, and Activation

- [x] 2.1 Compose atomic generation begin/reset with scheduler cancellation, child reset, direct identification, continuity/preferences, and stale-generation rejection.
- [x] 2.2 Translate controller-discovery effects into scheduler work, routing-hint effects, selecting/failure publication, and awaiting-activation facts while preserving source order.
- [x] 2.3 Attribute scheduler response/sent/timeout/queue-full/cancel/stale completions exactly once, decode current firmware/CAN/Refloat/layout results through safe crates, and resume priority/FIFO pumping after child dispatch.
- [x] 2.4 Implement generation-qualified explicit controller selection and prepare/activate readiness so telemetry and attached BMS work cannot start before current host confirmation.

## 3. Child Service Composition

- [x] 3.1 Compose Refloat layout negotiation, admitted generation-scoped dynamic layout, legacy/dynamic response decoding, adaptive polling, normalized sample publication, settings/session facts, and child timer routing.
- [x] 3.2 Compose controller-attached and standalone VESC BMS begin, discovery/probe/value response routing, polling timers, state/observation publication, unavailability, recovery, and reset.
- [x] 3.3 Bound nested effect draining, scheduler/child queues, payloads, collections, times, routes, and counters; preserve deterministic order, atomic invalid-input handling, privacy, and read-only discovery/telemetry safety.

## 4. Parity, Adversarial, and Isolation Evidence

- [x] 4.1 Add committed source-derived lifecycle vectors covering direct, preferred/hinted/enumerated gateway, explicit selection, reconnect continuity, activation, dynamic/legacy telemetry, attached/standalone BMS, failure, and reset.
- [x] 4.2 Add focused tests for exact request/deadline/effect order, scheduler priority and every completion, malformed response families, layout lifetime, activation ordering, child timers, stale/mismatched work, maximum bounds, rollover, privacy, and no mutation commands.
- [x] 4.3 Update workspace locks, core ownership documentation, focused root recipes, and repository audits to require the exact safe dependency set and forbid host selection, bridges, callbacks, executors, persistence, sockets, or packaged artifacts.

## 5. Verification

- [x] 5.1 Run focused tests/audits, formatting, warnings-denied locked workspace linting, strict OpenSpec validation, and `git diff --check`.
- [x] 5.2 Run `just verify` with both selected native connection/application owners unchanged.
- [x] 5.3 Run the canonical ESP32 physical matrix on the connected Android device, connected iOS device, and macOS host; require every non-location product checkpoint and defer only bounded location acquisition per the agreed manual follow-up.

## Verification Evidence


Software verification passed. Applicable macOS/Android fixture checkpoints and iOS foreground scenarios passed; iOS background BLE/session observations passed.
Mobile location acquisition remained deferred. Where the iOS XCTest passed but its parent process timed out, the parent run is not recorded as a clean pass.

Detailed execution history and device records are retained locally under
`.local/physical-testing/`. This summary applies only to the archived change.

Recorded change revision: [fae10028](https://github.com/acheronfail/float-view/commit/fae10028ad5abb26cc2f415d19ad8012470e7e34)
(historical record, not a verified binary hash).
