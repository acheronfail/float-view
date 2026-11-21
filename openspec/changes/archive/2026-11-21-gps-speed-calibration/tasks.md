# Tasks

## 1. Protocol and estimation

- [x] 1.1 Audit supported firmware motor layouts; implement diameter-only patch/readback validation with independent preservation and malformed-layout tests.
- [x] 1.2 Implement bounded time-aligned speed estimation with tests for known ratios, inconsistent/poor fixes, duplicates, gaps and lifecycle reset.
- [x] 1.3 Integrate motor read/write/verification into the existing scheduler and mutation owner; verify route, idle, stale-base, failure and disconnect cases.

## 2. Service and native boundary

- [x] 2.1 Add calibration contract, dispatch, snapshots and temporary capture policy; test route-recording independence, bounds and owner lifecycle.
- [x] 2.2 Pass native speed, uncertainty and measurement age on Apple/Android and temporary accuracy policy; run affected native boundary checks.

## 3. User experience and conformance

- [x] 3.1 Add simple connected-board calibration UI and client/mock support, including manual diameter/recommendation fallback; verify pointer/keyboard activation, errors and restoration.
- [x] 3.2 Extend fixture/canonical calibration scenarios for supported and unsupported application and verify focused mock/direct/browser coverage.

## 4. Integration and physical evidence

- [x] 4.1 Run affected Rust, frontend, native and conformance checks plus formatting/spec validation; record actual results and resolve failures caused by the change.
- [x] 4.2 Verify phone GNSS quality/lifecycle and controlled controller write/readback/power-cycle persistence/restoration on relevant hardware; keep raw evidence local and report missing checkpoints.

## Workflow follow-up

- Sync canonical specs and archive after implementation and all required verification complete.

## Verification evidence

- Shared Rust: 277 tests passed across backend-service, connection-application-coordinator, device-mutation-coordinator, vesc-controller-data and vesc-request-scheduler. Warnings-denied Clippy passed for these crates and loopback-server, including test targets.
- Frontend: 74 focused tests passed; Svelte/TypeScript checks, build and affected lint/format checks passed. Chromium and WebKit cover touch, non-primary pointers, pointer cancellation, keyboard activation, view reopening, unsupported recommendations and 320/390/768px layouts.
- Conformance: TypeScript/fixture frontend checks passed; 141 affected protocol/software-fixture tests passed. The real Rust-service calibration replay passed with temporary GPS, a fresh setup read, known correction, riding rejection and verified application. Synthetic observations establish software behavior only.
- Native: Android unit checks passed, including the nullable speed-observation JNI boundary. Apple backend checks passed (31 tests), including speed/accuracy/age mapping and shared-server integration. The broader Apple suite separately fails the unchanged `MacThemeTests.loadingArtwork` tint assertion; the same test fails in isolation. No calibration code changes that artwork path.
- OpenSpec validation passed without issues. No persisted format, commit or online mutation was introduced.

## Physical checkpoint closeout

Task 4.2 is complete based on the user's 2026-11-21 confirmation that the remaining Apple/Android field checks and controlled controller configuration preservation, application, power-cycle persistence and restoration checks were performed and worked. Earlier foreground runs and local reports remain recorded below and under ignored `.local/physical-testing/gps-speed-calibration/`. This final confirmation is user-reported; no new raw device logs or configuration snapshots were supplied with it.

## 5. Riding feedback

- [x] 5.1 Replace overly restrictive per-fix/cadence gates with bounded alignment and aggregate quality checks; reproduce realistic uncertainty, jitter, noisy fixes and retained invalid-data rejection in Rust and direct replay tests.
- [x] 5.2 Reduce copy to app behavior and publish measurement eligibility through contract/mock/UI plus coordinate-free diagnostics; verify status rendering, interaction and privacy coverage.
- [x] 5.3 Run focused Rust, frontend, contract/browser and affected native software checks; record the actual results and retain the outstanding physical checkpoint for a corrected ride attempt.

### Riding-feedback verification

- The supplied report was exported while stationary after the reported ride. Its clipped telemetry cannot establish the in-ride phone GPS rejection reason; preserve the bundle and context under ignored local physical evidence.
- Backend-service: 168 tests passed, including realistic GPS uncertainty/noise, bounded radio jitter, one-second board cadence, stale/invalid input rejection, diagnostic privacy and eligibility statuses. Warnings-denied Clippy passed for backend-service and loopback-server.
- Native Rust consumers and loopback: 26 tests passed across host, Apple FFI/ABI, Android JNI, publication and transport boundaries. This follow-up changes shared estimation and snapshots, with no additional native adapter change.
- Frontend: 83 focused tests passed. Svelte/TypeScript checks, build, affected lint and formatting passed. Chromium and WebKit passed touch, cancellation, keyboard, minimal copy, status and manual recommendation checks at 320/390/768px.
- Direct replay passed against the real Rust service using 0.5 m/s reported uncertainty and 600 ms observation age, yielding the expected 268.8 mm recommendation and verified application. Two earlier attempts timed out before service readiness; a standalone startup probe and the final replay passed without changing the startup deadline.
- Conformance TypeScript/fixture checks, Rust formatting and OpenSpec validation passed. Task 4.2 remains open for an updated-build ride and controlled hardware persistence/restoration checks; synthetic tests are not physical GPS evidence.

## 6. Completion feedback

- [x] 6.1 Automatically complete and retain the first quality-approved result; remove premature Finish and fixed-count target contracts, distinguish aggregate quality blockers, and verify timeout/capture shutdown.
- [x] 6.2 Replace full-count progress with ongoing activity and concise comparison statuses; verify automatic result transition, cancellation, keyboard and unsupported fallback.
- [x] 6.3 Run affected shared/native consumer, frontend, replay/browser and spec checks; retain outstanding physical verification.

### Completion-feedback verification

- The second reported ride reached 32 comparisons while aggregate quality still blocked a recommendation. Screenshots and context are retained under ignored local physical evidence; the specific failed aggregate check cannot be inferred from those images.
- Backend-service: 170 tests passed, including automatic result retention, uncertainty versus disagreement above the minimum count, bounded inconsistent sampling, timeout and capture shutdown/downgrade with route recording both enabled and disabled. Warnings-denied Clippy passed for backend-service and loopback-server.
- Native Rust/loopback consumers: 26 tests passed across Android JNI, Apple FFI/ABI, process owner, publication and transport boundaries. No host adapter or persisted format changed in this follow-up.
- Frontend: 84 focused tests passed; Svelte/TypeScript checks, build and affected lint/format checks passed. Chromium and WebKit passed automatic result transition, no completion bar or premature Finish action, touch cancellation, keyboard cancellation, view restoration and unsupported manual recommendations. Visual review uses the existing activity spinner with comparison count.
- The real Rust-service replay passed with 0.9 m/s reported uncertainty and 600 ms observation age: it remained collecting beyond 32 comparisons with the specific uncertainty status, then completed automatically and verified the expected 268.8 mm diameter application. Conformance TypeScript/fixture checks, Rust formatting and OpenSpec validation passed.
- Physical task 4.2 remains open. A further phone ride must establish the revised completion experience; controlled firmware persistence/restoration and relevant OS lifecycle checks remain required before sync/archive.

## 7. Street-riding clarity and duration

- [x] 7.1 Bound collection to three minutes, publish minimum speed, distinguish ratio mismatch from speed variation, and verify deadline/restoration/privacy and unchanged quality checks.
- [x] 7.2 Use the fullscreen space for large board speed and status, one concise state and automatic completion without a duration target or running process copy; verify preferred units, brief-state stability and accessible controls.
- [x] 7.3 Run focused shared/native consumer, frontend and replay/browser checks; record the reported successful ride/application and outstanding physical checks.

### Street-riding verification

- User reports foreground completion after approximately 45–50 comparisons in 1–2 minutes and successful explicit Apply on the previously reported setup. The report is retained locally; controlled preservation/power-cycle restoration and broader OS lifecycle checks remain outstanding.
- Final software checks passed: 197 Rust tests across backend-service/native consumers/loopback, warnings-denied Clippy, 89 focused frontend tests, frontend build/type/lint/format checks, conformance type/fixture checks, Chromium and WebKit, and the real-service replay through automatic completion and verified diameter application.
- Collection now shows one speed-specific state and labelled board speed, with only the minimum threshold when too slow. Running count, countdown and process paragraphs are omitted. Closing the view preserves capture; cancellation and automatic result transition are verified. The three-minute cutoff is an unsuccessful-attempt bound, with immediate completion whenever quality passes.
- Test-only native service readiness now permits a bounded 30-second cold start after repeated failures of the prior 10-second allowance. This changes no product timeout or quality threshold.

## 8. Mixed-quality ride failure and export follow-up

- [x] 8.1 Reproduce stalled aggregate quality with heterogeneous GPS uncertainty; bound individual observation influence while retaining uncertainty, outlier, independent-evidence and drift checks.
- [x] 8.2 Record exact aggregate rejection category and bounded aggregate quality metrics without raw speed, uncertainty observations or coordinates; verify changing quality and regression traces through the real service.
- [x] 8.3 Run relevant estimator/service/native consumer, frontend/browser, replay and spec checks; retain physical verification limits.
- [x] 8.4 Investigate the separately reported stationary diagnostic-export failure after calibration work, and fix a reproduced cause within the existing diagnostic owner or record the specific remaining evidence required.

### Mixed-quality and export verification

- Reproduced an aggregate starvation defect: a synthetic set of agreeing comparisons with five nominally precise early fixes retained fewer than six effective observations under the old weighting. A small relative weight cap now prevents domination while retaining the same minimum observations, aggregate uncertainty, outlier and drift gates. New tests also preserve rejection of systematic drift and avoid bias from precise outliers.
- Shared service/native owner/loopback: 190 tests passed; warnings-denied Clippy passed. Failure diagnostics include a closed rejection category, effective comparison count and bounded estimated uncertainty, without individual GPS speed/accuracy or coordinates. Unsuccessful completion captures a calibration-failure incident for later export.
- The real-service mixed-precision replay passed in approximately 42 seconds, including automatic completion and verified diameter-only application. This is synthetic evidence, not confirmation of the specific 98-comparison phone failure. Raw screenshots/context are retained locally and the exact phone-side quality cause remains unproven.
- Reproduced the generic export error in Chromium and WebKit by exporting after repeated in-app navigation while retaining one connection. Moving report replacement/in-flight work to the connection owner fixes the test without changing report capacity, expiry, file leases or native presentation. This is a matching reproduced failure, not an observed phone-side error code.
- Frontend: 95 focused tests passed, including export replacement beyond capacity, reconnect ownership and overlapping work. Frontend type/build/lint checks and conformance type/fixture checks passed. Four Chromium/WebKit checks passed for simplified calibration controls and repeated exports across view recreation on one connection. Formatting and OpenSpec validation passed.
- Physical task 4.2 remains open. Updated-phone calibration/export confirmation and the outstanding controlled preservation/power-cycle/restoration/lifecycle checks are not claimed from software tests.

## 9. Connected-device findings

- [x] 9.1 Restore the known historical diagnostic vocabulary, reproduce reopening/export failure with supported saved records, and verify unknown records still fail closed without deletion.
- [x] 9.2 Verify the copied phone diagnostic store reopens and prepares a ZIP with the corrected reader; preserve device data and raw evidence locally.
- [x] 9.3 Analyze the supplied ride's actual timing and sampling eligibility; distinguish archive-supported findings from unavailable native GPS-speed/uncertainty observations and identify remaining evidence needed.

### Connected-device verification

- USB inspection established the actual export blocker: saved supported diagnostic rows used an earlier calibration code that the current closed vocabulary no longer recognized, so persistence fell back to memory-only mode. Known historical state/method tags are now retained solely by the diagnostic reader; obsolete public operations remain unavailable. A failing reopen/export regression now passes, and unknown future records still fail closed with their bytes preserved.
- A private copy of the device store reopened with all retained incidents and successfully prepared a ZIP. The corrected signed development build was installed as an in-place local update using existing signing assets, with no online provisioning changes or app-data reset. Device health changed from memory-only to available; the user then supplied a valid exported ZIP. Raw inventories, source-linked build/install logs, stores, reports and ride analysis remain under ignored local evidence.
- The supplied successful export contains an older clipped request-delay incident, without the latest ride's calibration records. The ride archive supports timing and approximate board eligibility analysis but contains neither native speed uncertainty nor app-build identity. The exact cause of the slow field result remains unproven; the final installed build retains outcomes for successes and failures, elapsed duration, sampler revision and separate accuracy-rejection counts without raw GPS observations.
- Final shared/service/native-owner/loopback checks: 194 tests passed, plus warnings-denied Clippy and Rust formatting. Frontend: 99 focused tests, type checks, build and relevant browser/mock checks passed; conformance checks and OpenSpec validation passed. The signed iOS build and preserved-store export are actual device evidence. A subsequent user-supplied outcome from the final sampler confirms automatic foreground completion after 42 accepted comparisons from 77 GPS updates in approximately 78 seconds; the corrected ride archive includes the completion marker. Controlled motor persistence/restoration and remaining lifecycle coverage still keep task 4.2 open.

- A saturated/coalesced-incident regression also passes: the latest calibration outcome remains exportable after the follow-up window closes, within unchanged event and byte limits. This prevents a busy incident from hiding the result summary.

## 10. Completion review

- [x] 10.1 Review the estimator, native observations, shared capture policy, diameter write authority/protocol, diagnostics, contract/mock and UI for unnecessary complexity and failure cases.
- [x] 10.2 Fix reproduced diagnostic rejection-count/order defects, preserve inclusive diameter wire bounds, use named write stages and keep preparation arguments within their pending request; retain the current estimator gates and UI.
- [x] 10.3 Run focused shared/consumer, frontend and fixture/service replay checks; record results and retain the specific outstanding physical checks.

### Review verification

- 311 Rust tests passed across the shared service, coordinator, mutation owner, scheduler, controller data, loopback and native runtime host; warnings-denied Clippy and Rust formatting passed. Regression tests reproduce inflated rejection counts from duplicate callbacks and out-of-order outcomes in full incidents. Diameter endpoints round-trip on every audited layout while adjacent out-of-range wire values remain rejected. Mutation kinds remain visible through the closed diagnostic vocabulary.
- 56 focused frontend tests, type/lint checks and the production build passed. Four Chromium/WebKit browser tests passed for calibration and repeated exports. Conformance type/fixture checks and the diameter fixture test passed. The real-service mixed-precision replay passed in approximately 42 seconds through automatic completion, riding rejection and verified idle application.
- Preparation data now belongs to its pending-request variant, write stages use a closed enum, and location authorization is evaluated once per capture-policy decision. Start requests allow the service deadline to return a structured failure before the frontend times out. Estimator thresholds, automatic early completion and the riding UI remain unchanged.
- The reviewed implementation and software checks are complete. Task 4.2 remains open for controlled full-configuration preservation/power-cycle/restoration and remaining platform/lifecycle checks; neither the synthetic replay nor user-reported Apply establishes those outcomes.

- Android physical foreground check on `fae161df`: calibration completed automatically with 30 accepted comparisons in approximately 70 seconds. The recommendation, idle Apply eligibility, OS GPS shutdown and a valid diagnostic ZIP containing the outcome were verified over USB. Apply was not exercised. Detailed timing, diagnostic-loss counters and raw reports remain local; controlled motor persistence/restoration and background/locked checks remain outstanding.

- A subsequent iPhone sampler-revision-2 run completed in approximately 167 seconds with 48 accepted comparisons from 168 updates. Its prolonged pause at 42 comparisons was attributable to 102 native speed-uncertainty rejections above the absolute gate, while aggregate uncertainty remained just above the completion limit. Permissions and connection were healthy. The retained outcome identifies the blocker; absent individual uncertainty values, it does not establish that admitting those fixes is safe. Detailed evidence remains local, and variable field completion time remains a material limit.

## 11. Approximate progress

- [x] 11.1 Publish a shared, bounded progress estimate from collected evidence and confidence; verify pauses, restart, restoration, quality blockers and full progress only on approval without changing thresholds.
- [x] 11.2 Add a simple themed, accessible bar with minimal copy; update contract/mock and canonical coverage, including view recreation and reduced motion.
- [x] 11.3 Run affected shared/native-boundary, frontend, direct replay/browser and spec checks; record results and preserve outstanding physical closeout.

### Progress verification

- 207 Rust tests passed across backend-service, loopback, runtime host and Apple/Android Rust bindings. The 18 estimator tests include partial progress that reflects reported uncertainty, a long rejected-GPS plateau, a new-attempt reset, insufficient/inconsistent evidence remaining below full, and completion retaining full progress. Eligibility, quality and deadline thresholds are unchanged.
- 93 focused frontend tests passed, including existing themed-bar coverage and explicit mock progress. Type checks, relevant lint/format checks and the production build passed. Two Chromium/WebKit checks verify progress across pauses and view recreation, reset on a new attempt, result transition, light/dark themes, reduced motion and phone/tablet widths. Screenshots were visually inspected in both themes.
- The real-service mixed-precision replay passed through partial progress, automatic approval at full progress, riding rejection and verified idle application. Conformance type/fixture checks, warnings-denied Clippy, formatting and OpenSpec validation passed. The new snapshot field passes through the existing generic native JSON integrations; no native adapter policy or persisted format changed. Task 4.2 remains the outstanding original hardware closeout.

## 12. Optional precision refinement

- [x] 12.1 Retain the best quality-approved candidate while continuing bounded capture; gate explicit Finish, preserve prior results through rejected/inconsistent data, and verify deadline/quality metrics without changing thresholds.
- [x] 12.2 Update the contract, mock, UI and canonical scenarios for readiness, continued capture, Finish and independent Apply; keep copy about potential precision improvement without an accuracy promise.
- [x] 12.3 Run affected shared/native-boundary, frontend, browser/replay and spec checks; record actual results and preserve original hardware closeout.

### Refinement verification

- 209 shared/service, loopback, runtime host and Apple/Android Rust-binding tests passed. Coverage includes continued observations after approval, lower-uncertainty candidate replacement, preservation through poorer approved candidates and later rejected/inconsistent readings, restored final quality metrics, premature-Finish rejection, and both explicit and deadline capture shutdown. The sampler revision is now 3; all acceptance/consistency thresholds and the original deadline remain unchanged.
- 93 focused frontend tests, Svelte/TypeScript checks, lint/format checks and the production build passed. Chromium and WebKit cover live measurement feedback during refinement, the short precision explanation, closing/reopening without finalizing, Finish activating once, unsupported recommendations and responsive layouts. The refinement screen was visually inspected.
- The real-service replay continued for additional accepted GPS observations after readiness, rejected Apply during capture, then finalized through Finish and completed verified idle application. Conformance checks, warnings-denied Clippy and OpenSpec validation passed. Task 4.2 remains open for the original controlled motor persistence/restoration and lifecycle hardware closeout; optional refinement has software verification and is ready for field testing.

## 13. Live feedback during refinement

- [x] 13.1 Keep live measurement status, eligibility colours and the low-speed hint after approval; use readiness only to offer Finish and verify UI/browser coverage without changing sampling or result retention.

- Live-refinement feedback verification passed: 21 focused component tests, Svelte/TypeScript and conformance type checks, lint, formatting and the production build. Chromium and WebKit verify GPS-uncertain and low-speed status/colour/threshold changes after approval, with Finish remaining enabled, followed by Measuring on an eligible reading. Backend sampling, best-result retention and deadline behavior are unchanged.
