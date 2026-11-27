# Tasks

## 1. Recording and compatibility

- [x] 1.1 Map valid ellipsoidal altitude through Apple and Android and persist it on eligible GPS points in the shared service.
- [x] 1.2 Read nullable altitude through bounded session history and update the frontend contract, validation and mock.
- [x] 1.3 Preserve altitude through portable archives and app-data transfer, retain format-4 and baseline coverage, and guard owned storage with marker 102.
- [x] 1.4 Show a gap-aware elevation chart in session review using the existing viewport, map filter, and elapsed-time selection.
- [x] 1.5 Publish altitude on the current route fix and offer Elevation in Live View and Custom View.

## 2. Verification

- [x] 2.1 Verify missing, invalid, zero and negative altitude, storage recovery and compatibility, and archive round trips with focused Rust tests and lint.
- [x] 2.2 Run frontend checks, chart browser coverage, affected contract/conformance coverage, and Apple and Android adapter or native-boundary checks with deterministic location inputs.
- [x] 2.3 Verify live altitude availability and widget selection, formatting and persistence across both views, including client/mock and direct conformance.
- [x] 2.4 Sync and validate canonical specs and archive the change once the required checks pass.

### Evidence

- Frontend type checks, build, focused lint and 26 unit tests passed. The current ride, fault history, footpad faults and map-filter browser suites passed all 10 Chromium and WebKit cases.
- Direct and mock conformance and conformance type checks passed for the recording and historical chart scope. The direct target verified a recorded negative altitude in bounded history.
- The Apple location and storage suites passed seven tests. The Android host compiled and its four JNI runtime tests passed.
- The application runtime, shared service, product store, session SQLite and loopback tests passed, including the frozen archive, format-5 round trip, marker upgrade and reader continuation cases. Warnings-denied Clippy passed for the affected crates.
- Expanded live coverage passed direct and mock conformance, the Rust location and saved-slot checks, frontend type checks and lint, and the affected widget, trend, layout and mock unit suites. Chromium and WebKit verified both widget pickers, persisted board layouts, imperial units and the unavailable state when recording is disabled.
