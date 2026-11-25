## 1. Temporary Android compatibility bridge

- [x] 1.1 Add `refloat-compatibility-android-jni` to the locked workspace with the exact four-symbol ABI, fixed statuses, bounded primitive-array validation/publication, canonical safe-record delegation, shared JNI support, and panic containment.
- [x] 1.2 Add focused Rust bridge tests for exact INFO request/records, every safe failure mapping, layout admission, null/exception/reference/array/capacity/distinctness bounds, initialized outputs, and contained failures.

## 2. Android build and ownership integration

- [x] 2.1 Complete the shared compatibility bridge catalogue entry with exact Android package, library, JNI-prefix, and four-symbol metadata while preserving every Apple field and artifact unchanged.
- [x] 2.2 Add a ninth typed Android Gradle bridge entry, host and four-ABI Debug/Release tasks, generated JNI merge inputs, host-JVM property, and exact task/input/output audits.
- [x] 2.3 Extend root dependency, workspace-layout, exact-symbol, record-ownership, generated-artifact, source-selection, and Apple-isolation audits for the temporary bridge.
- [x] 2.4 Update Android/core ownership documentation to identify Rust as the selected INFO/catalogue/layout-admission owner and both compatibility bridges as planned deletions with the unified Rust runtime.

## 3. Kotlin adapter and production selection

- [x] 3.1 Add the narrow Kotlin JNI loader and strict canonical compatibility-record adapter while preserving existing normalized models and established protocol errors.
- [x] 3.2 Reuse the exact current-generation canonical dynamic-layout record for Rust admission and preserve reset, invalid-replacement, field-list publication, and realtime-selection behavior.
- [x] 3.3 Carry one accepted compatibility decision through protocol messages, controller discovery, control setup, supported-state publication, and tests without a Kotlin string catalogue lookup.
- [x] 3.4 Add focused host-JVM tests for exact requests and every INFO/profile/layout decision, ABI/status/record mapping, discovery/control propagation, reset/replacement, and exhaustive malformed-record rejection.
- [x] 3.5 Select Rust from Android production, delete superseded Kotlin INFO offsets, release catalogue/profile derivation, required identifiers, set admission, and every fallback, and prove higher-level ownership remains unchanged.

## 4. Software verification

- [x] 4.1 Run formatting, warnings-denied Rust tests/lints, focused host-JVM tests, dependency/symbol/source audits, and strict change validation.
- [x] 4.2 Run clean Android host and four-ABI Debug/Release packaging plus macOS, iOS simulator, and unsigned iOS device regression packaging.
- [x] 4.3 Run the complete `just verify` software gate after production selection and Kotlin algorithm deletion.

## 5. Physical regression and final gate

- [x] 5.1 Run focused identity, direct/CAN control, applicable BMS, dynamic/legacy telemetry, ride, unexpected-disconnect, and background/session scenarios on the connected Android device against the ESP32 fixture through production Rust compatibility decisions.
- [x] 5.2 Run the same applicable focused scenarios on the connected iOS device through its unchanged selected compatibility bridge.
- [x] 5.3 Run focused identity, direct/CAN control, applicable BMS, dynamic/legacy telemetry, ride, and unexpected-disconnect scenarios on the macOS host through its unchanged selected compatibility bridge.
- [x] 5.4 Record only bounded location-sample absence as deferred manual coverage; require every non-location assertion and cleanup to pass, then rerun focused checks, `just verify`, and strict OpenSpec validation in the final implementation state.

## Physical evidence


Android canonical and focused iOS/macOS fixture checkpoints passed; background BLE/session continuity passed.
Android acquired no new background location sample; that location coverage remains deferred. iOS persisted background samples.

Detailed execution history and device records are retained locally under
`.local/physical-testing/`. This summary applies only to the archived change.

Recorded change revision: [fae19a90](https://github.com/acheronfail/float-view/commit/fae19a906b17cdc2f0ca4682ae7b1c3643b0e0b7)
(historical record, not a verified binary hash).
