## 1. Dependency and State Model

- [x] 1.1 Add the existing protocol-neutral VESC controller-data crate as the coordinator's only new dependency, without adding a host bridge or runtime dependency.
- [x] 1.2 Extend coordinator state and snapshots with optional current limits while keeping debug output presence-only and telemetry values private.
- [x] 1.3 Add route-correct current-limit request and completion adapters that reuse the controller-data decoder and request scheduler context.

## 2. Application Lifecycle Composition

- [x] 2.1 Clear current-limit state on connection start, reset, and generation replacement so stale values cannot cross sessions.
- [x] 2.2 Enqueue exactly one command-14 controller-work request after configuration activation and before telemetry or BMS startup, preserving direct and CAN routes and the native timeout.
- [x] 2.3 Exclude the controller current-limit request from standalone-BMS activation.
- [x] 2.4 Decode and publish only an exactly attributed successful current-limit response while leaving malformed, failed, timed-out, cancelled, stale, or repeated completions nonfatal and absent.

## 3. Evidence and Integration

- [x] 3.1 Add source-derived direct, CAN, standalone-BMS, ordering, valid-response, unknown-signature, and optional-cell current-limit fixtures and tests.
- [x] 3.2 Add adversarial tests for truncation, malformed numeric fields, incorrect attribution, completion failures, reset isolation, and privacy-safe debug output.
- [x] 3.3 Add focused repository verification and ownership audits that reject copied controller decoding, host-package integration, and new bridge dependencies.
- [x] 3.4 Confirm the production Swift and Kotlin application services and every `*-apple-ffi` and `*-android-jni` package remain unchanged by this candidate-only composition.

## 4. Verification

- [x] 4.1 Run focused Rust tests, formatting, linting, dependency/ownership audits, strict OpenSpec validation, and `git diff --check`.
- [x] 4.2 Run the complete `just verify` software gate.
- [x] 4.3 Run the ESP32 fixture regression on the macOS host and connected Android and iOS devices, deferring only bounded location acquisition and documenting any harness-only timeout separately from application behavior.
- [x] 4.4 Record exact software and physical evidence in the change artifacts and leave all tasks complete before sync and archive.

## Verification Evidence


Software verification passed. Applicable macOS/Android fixture checkpoints and iOS foreground scenarios passed; iOS background BLE/session observations passed.
Mobile location acquisition remained deferred. Where the iOS XCTest passed but its parent process timed out, the parent run is not recorded as a clean pass.

Detailed execution history and device records are retained locally under
`.local/physical-testing/`. This summary applies only to the archived change.

Recorded change revision: [fae14a95](https://github.com/acheronfail/float-view/commit/fae14a95dd6699f495ee7ae18ba4068fcb4e2a6a)
(historical record, not a verified binary hash).
