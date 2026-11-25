## 1. Temporary Android JNI bridge

- [x] 1.1 Add `refloat-dynamic-telemetry-android-jni` to the locked workspace with the exact three-symbol ABI, fixed statuses, bounded primitive-array validation/publication, canonical safe-record delegation, shared JNI support, and panic containment.
- [x] 1.2 Add focused Rust bridge tests for exact layout/sample records, every safe failure mapping, null/exception/reference/array/capacity/distinctness bounds, initialized outputs, and contained failures.

## 2. Android build and ownership integration

- [x] 2.1 Complete the shared bridge catalogue entry with exact Android package, library, JNI-prefix, and three-symbol metadata while preserving every Apple field and artifact unchanged.
- [x] 2.2 Add an eighth typed Android Gradle bridge entry, host and four-ABI Debug/Release tasks, generated JNI merge inputs, host-JVM property, and exact task/input/output audits.
- [x] 2.3 Extend root dependency, workspace-layout, exact-symbol, record-ownership, generated-artifact, source-selection, and Apple-isolation audits for the temporary bridge.
- [x] 2.4 Update Android/core ownership documentation to identify Rust as the selected command-31/32 decoder and both per-platform bridges as planned deletions with the unified Rust runtime.

## 3. Kotlin adapter and production selection

- [x] 3.1 Add the narrow Kotlin JNI loader and strict canonical layout/sample-record adapter while preserving `RefloatDynamicTelemetryDecoder`, normalized models, established errors, and payload-safe diagnostics.
- [x] 3.2 Add focused host-JVM tests for source-derived layouts and realtime forms, every semantic/optional/extension mapping, complete record validation, reset/replacement lifetime, ABI/status mapping, and adversarial malformed-record rejection.
- [x] 3.3 Select the Rust adapter from Android production, delete every superseded Kotlin command-31/32 wire algorithm, telemetry mapping file, and fallback, and prove compatibility, routing, polling, application, persistence, and frontend ownership remain unchanged.

## 4. Software verification

- [x] 4.1 Run formatting, warnings-denied Rust tests/lints, focused host-JVM tests, dependency/symbol/source audits, and strict change validation.
- [x] 4.2 Run clean Android host and four-ABI Debug/Release packaging plus macOS, iOS simulator, and unsigned iOS device regression packaging.
- [x] 4.3 Run the complete `just verify` software gate after production selection and Kotlin parser deletion.

## 5. Physical regression

- [x] 5.1 Run focused identity, direct/CAN control, applicable BMS, dynamic/legacy telemetry, ride, unexpected-disconnect, and background/session scenarios on the connected Android device against the ESP32 fixture through production Rust dynamic decoding.
- [x] 5.2 Run the same applicable focused scenarios on the connected iOS device through its unchanged selected Rust decoder.
- [x] 5.3 Run focused identity, direct/CAN control, applicable BMS, dynamic/legacy telemetry, ride, and unexpected-disconnect scenarios on the macOS host through its unchanged selected Rust decoder.
- [x] 5.4 Record only bounded location-sample absence as deferred manual coverage; require every non-location assertion and cleanup to pass, then rerun `just verify` and strict OpenSpec validation in the final implementation state.

## Verification evidence


Android/iOS canonical and applicable macOS fixture checkpoints passed; background BLE/session continuity passed.
Android acquired no new background location sample; that location coverage remains deferred. iOS persisted background samples.

Detailed execution history and device records are retained locally under
`.local/physical-testing/`. This summary applies only to the archived change.

Recorded change revision: [fae1e112](https://github.com/acheronfail/float-view/commit/fae1e112f69edd9fe4db17530ba2de75617c923b)
(historical record, not a verified binary hash).
