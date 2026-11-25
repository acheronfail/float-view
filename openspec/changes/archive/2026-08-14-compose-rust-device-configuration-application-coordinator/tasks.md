## 1. Composition Contract and Dependencies

- [x] 1.1 Add only the safe mutation, configuration-service, configuration-value, and custom-configuration codec dependencies required by `connection-application-coordinator`, keeping every host-support/bridge/runtime dependency absent.
- [x] 1.2 Extend the coordinator command, snapshot, effect, error, and diagnostic models with bounded activation-cache, semantic mutation, configuration read/write/Tune, child state, cache intent, and failure values.
- [x] 1.3 Add checked private adapters for route, generation, firmware/package facts, configuration request/context/response values, and once-only direct/CAN routing without copying child policy or codec logic.

## 2. Lifecycle Composition

- [x] 2.1 Own and atomically reset the mutation and configuration children with the existing scheduler/discovery/telemetry/BMS generation.
- [x] 2.2 Configure both children only during exact current controller activation, use supplied exact-cache bytes, preserve source-equivalent child startup order, and exclude standalone BMS.
- [x] 2.3 Route normalized telemetry and attributed lighting observations through mutation confirmation/flywheel behavior before publishing composed state.
- [x] 2.4 Route semantic controls, fatal clear, lighting, and controller shutdown through the mutation owner and existing scheduler with exact token/completion handling.

## 3. Configuration and Mutation Serialization

- [x] 3.1 Convert configuration schema/current/default effects into exact commands 92–94 scheduler work and return deterministic configuration/cache/publication effects.
- [x] 3.2 Acquire one exact mutation lease before configuration write or Tune work, encode command 95 through the safe codec, and retain the lease through acknowledgement and verified command-93 readback.
- [x] 3.3 Decode and attribute every commands 92–95 response to exact route/index/operation/generation context before applying one configuration transition.
- [x] 3.4 Abort configuration and fail/release only the exact mutation token on every synchronous codec/service/enqueue failure and asynchronous timeout, queue-full, cancellation, stale-generation, malformed, flywheel, reconnect, or reset outcome.
- [x] 3.5 Enforce the finite nested-effect bound and stable payload-free diagnostics across all new transition paths.

## 4. Evidence and Repository Integration

- [x] 4.1 Add committed source-derived direct/CAN/cache/read/write/lease/confirmation/failure/reconnect composition vectors and focused unit tests that prove Swift/Kotlin parity and exact effect order.
- [x] 4.2 Add exhaustive adversarial tests for identity/access, mutation/configuration state, scheduler completions, response mismatch/malformation, maximum bounds, cache corruption, counters, cancellation, and reset with no stuck lease or stale publication.
- [x] 4.3 Update workspace documentation and root recipes for focused formatting, warnings-denied linting, tests, dependency/copied-logic/host-selection/bridge/symbol/package/callback/executor/persistence/network/generated-artifact audits.
- [x] 4.4 Confirm both native application/configuration/mutation owners remain selected, host build inputs are unchanged, and no coordinator-specific FFI/JNI or generated binding exists.

## 5. Verification

- [x] 5.1 Run focused coordinator tests and audits, workspace formatting and warnings-denied linting, strict change validation, and `git diff --check`.
- [x] 5.2 Run the complete `just verify` software gate with native owners still selected.
- [x] 5.3 Run the canonical ESP32 physical matrix on the connected macOS host, Android device, and iOS device; accept only bounded location acquisition as deferred manual evidence and record any harness-only lifecycle exit behavior explicitly.
- [x] 5.4 Record exact verification evidence in this task file and ensure every task is complete before the implementation commit.

## Verification Evidence


Software verification passed. Applicable macOS/Android fixture checkpoints and iOS foreground scenarios passed; iOS background BLE/session observations passed.
Mobile location acquisition remained deferred. Where the iOS XCTest passed but its parent process timed out, the parent run is not recorded as a clean pass.

Detailed execution history and device records are retained locally under
`.local/physical-testing/`. This summary applies only to the archived change.

Recorded change revision: [fae1953f](https://github.com/acheronfail/float-view/commit/fae1953f9f9bcf026dae0bdf1b159c6566790e35)
(historical record, not a verified binary hash).
