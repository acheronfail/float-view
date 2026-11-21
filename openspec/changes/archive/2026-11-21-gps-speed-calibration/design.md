# Design

## Context

The native adapters discard OS speed/uncertainty and currently deliver coordinate timestamps plus receipt clocks. Motor configuration reads expose only current limits. VESC command 13 writes an entire signature-specific configuration; command 91 reads speed setup but its setters cannot change diameter. See proposal.md for scope.

## Decisions

- Keep a bounded, connection-scoped calibration owner in the shared service. Native observations include nullable speed, speed accuracy and age. Map measurement age onto the service monotonic clock and compare against a short telemetry ring; never change existing persisted track timing or format. Reject delayed fixes and use stable windows rather than raw coordinate differences.
- Add a temporary high-accuracy capture reason through the existing OS effect; preserve independent route-recording eligibility. Stop calibration at a bounded deadline; permission/background restrictions suspend useful capture and must not turn missing values into zero.
- Reread current setup before capture using the existing serialized scheduler. If a previously readable setup becomes unavailable, require an explicit manual entry before proceeding. A manual starting diameter permits an advisory result when the layout/read is unavailable. Cancelled or disconnected preparation cannot start capture from a late reply. Keep coordinate-free calibration state in authoritative snapshots and public start/cancel/apply operations. No automatic command replay on restoration.
- Implement a signature/length-specific opaque motor configuration patch in the existing protocol owner. Audit four supported VESC schemas, encode only the four diameter bytes, preserve all remaining bytes, and verify readback. Unknown layouts remain advisory. Reuse one scheduler and mutation coordinator; never use Lisp/terminal scripting or add a second transport path.
- Apply only after fresh idle normal-mode authorization, on the same controller generation and route. Fresh read must match the calibration diameter. An acknowledgement is not success; timeout is an uncertain outcome, without blind retry or automatic rollback. Firmware normalization must be audited; unexpected unrelated readback changes fail verification.
- Use a single connected-board panel: short introduction, current diameter, Start, ongoing collection activity, Finish once a result is ready, prominent recommended millimetres, explicit Apply where eligible, otherwise concise VESC Tool instructions. Keep the result visible on failures. Assume gearing and poles are correct.

## Risks / Trade-offs

GNSS quality varies by phone/route: conservative quality thresholds and a physical field check are required. Full motor configuration writes can normalize/reapply firmware settings: exact profiles, byte-preservation vectors, readback and a controlled persistence/restoration hardware check are required. These checks cannot be claimed from simulation.

No storage migration or new dependency. Rollback removes temporary calibration capability without rewriting saved data. Threshold tuning may follow physical evidence without weakening the quality requirements.

## Riding feedback follow-up

The user reported 0/30 throughout an outdoor ride and exported diagnostics afterwards while stationary. The clipped report contains no phone speed/accuracy, so its zero board speed cannot diagnose the ride. The original algorithm independently imposed a 0.25 m/s / 3 percent GPS cutoff, 500 ms maximum board gaps, and 250 ms nearest-sample matching; ideal fixed-cadence fixtures did not cover these failure modes.

Use bounded interpolation and stable board windows with realistic radio jitter; retain stale, invalid, missing-accuracy and wheelslip rejection. Weight native-speed ratios by reported uncertainty, require enough independent time-separated samples, and verify aggregate uncertainty, outlier rate and consistency across halves before recommending. Add coordinate-free status/counters to snapshots/diagnostics. UI copy describes only app behavior and current data eligibility. No change to motor-write authority or storage formats.

## Completion feedback follow-up

A second ride collected 32 comparisons but was still checking aggregate quality when the user chose Finish. The minimum count was presented as a completed progress bar, although it never guaranteed a result. The screenshots establish this mismatch but do not distinguish aggregate uncertainty from disagreement. A previously approved result could also be recomputed and revoked during continued capture.

Remove the fixed-count progress promise and premature Finish action/public operation. Retain the estimator quality criteria; publish distinct statuses for aggregate uncertainty and inconsistent comparisons. Show ongoing activity with a secondary comparison count and concise app-only status. Make the first quality-approved estimate available immediately. The optional-refinement flow below retains it until Finish or the original deadline stops capture. Timeout remains a bounded insufficient result. Record a final coordinate-free diagnostic status even when completion stops capture. No firmware-write or storage policy changes.

## Street-riding presentation

The user reports successful completion after approximately 45–50 comparisons over 1–2 minutes and successful explicit Apply on the previously reported setup. Record this as a user-reported phone/controller outcome, without claiming controlled configuration preservation or power-cycle persistence. Retain estimator quality thresholds for now; this report supports feasibility on that setup, not universal GNSS performance.

Use the fullscreen area for a large labelled board-speed reading in preferred units, one prominent text-and-colour state and a single Cancel action. Use “Keep speed steady” for changing speed and “Measuring” while accumulating or checking comparisons; show the minimum only for low speed. Retain counts for backend diagnostics, with no process paragraphs, counts or completion reminders in the running view. Explain optional refinement when a result becomes ready. Explain changing speed separately from low speed; a stable GPS/board ratio outside the supported band must have its own mismatch status. Brief blocking states receive a short presentation-only delay; eligible collection appears immediately. No unrelated rider advice, target cruising speed, live raw GPS fields or changes to write authority.

Reduce the absolute capture deadline from ten to three minutes, leaving margin around the reported 1–2 minute success. Keep this deadline in the shared owner so restoration cannot restart it. The maximum duration is an upper bound, not a required duration: show no countdown, and enable Finish as soon as quality passes. At the deadline retain the best approved result or report insufficient evidence without weakening result quality. The existing bounded rolling comparison history and quality checks remain unchanged.

## Heterogeneous GPS uncertainty

A subsequent ride on the same reported route reached 98 accepted comparisons without a recommendation before the shortened deadline. The screenshot at 83 comparisons shows the aggregate uncertainty/effective-sample branch, not the speed-stability branch. The precise cause is not established because a stationary diagnostic export also failed.

Investigate inverse-variance concentration: a few early fixes with nominally low uncertainty can dominate many subsequent agreeing fixes and keep effective sample count below the minimum indefinitely. A synthetic regression must establish this failure before changing the estimator. Cap an observation’s inverse-variance weight at four times the median-uncertainty observation’s weight, only raising effective uncertainty; retain reported uncertainty, modeled-error and drift gates rather than allowing the raw sample count to grant a result. Expose the exact aggregate rejection category and bounded derived metrics only in coordinate-free diagnostics. Capture each completed attempt as an outcome incident with duration, algorithm revision, aggregate quality and rejection counts so later exports include slow successes and failures. Preserve individual GPS observations only in temporary estimator memory. Keep early result availability and the absolute deadline; do not require longer riding as the remedy for a weighting defect.

## Export follow-up

The existing Help component retained its prepared diagnostic report handle locally. Leaving Help destroyed that handle while the same WebSocket owner retained the backend report for its bounded lifetime; repeated in-app navigation/exports exhausted the existing two-report capacity. A browser regression reproduces the generic export failure on the same connection, while page reloads mask it by releasing that owner.

Move the replacement handle and in-flight export work to the existing frontend connection owner. Reset them on connection replacement/closure, share overlapping export work, and retain the existing explicit report replacement, backend slot/file leases, expiry and native presentation behavior. This restores existing export behavior without changing the public contract or relaxing file bounds.

## Historical diagnostic compatibility

A direct USB connection found the phone's diagnostic persistence in memory-only mode. Its preserved version-2 journal contains the earlier `checkingConsistency` calibration code, removed from the closed reader when the active status vocabulary changed. Valid historical records then failed store reopening and disabled report preparation. Restore only the known historical diagnostic code/method vocabulary; do not restore obsolete public operations or accept arbitrary strings. Existing supported diagnostic data must remain readable/exportable; unknown or malformed data still fails closed and remains preserved. Add reopen-and-export regression coverage and validate a local copy of the device store before any physical verification.

Outcome records use a distinct closed diagnostic kind. They participate in existing incident coalescing and remain retained if that incident is already full, replacing one routine summary/sample record (or the oldest record when necessary) within the unchanged count and byte budgets. Clipping remains disclosed. A regression saturates the incident and verifies the final outcome survives after the normal follow-up window has closed.

## Approximate collection progress

Publish one bounded progress percentage from the shared calibration owner. Estimate evidence collected using sample count, independent measurement span, effective sample count and modelled aggregate uncertainty; preserve the highest estimate within an attempt. Reserve full progress for the existing quality-approved result. The estimate may pause, and it does not predict time remaining or alter acceptance, consistency, completion or deadline rules. Keep it across view recreation and reset it with the existing calibration owner.

Reuse the existing themed connection bar beneath the large speed reading, with a short approximate label and accessible estimated value. Keep the prominent status, preferred-unit speed and Cancel action. Do not expose sample targets, countdowns or additional explanatory paragraphs. Mock fixtures supply explicit estimated progress; presentation does not duplicate estimator policy. Native hosts continue forwarding the shared snapshot unchanged through their generic JSON boundary.

## Optional refinement after readiness

A reliable estimate enables Finish without ending capture. Keep the existing accepted-data gates, consistency checks, bounded comparison buffer and original three-minute deadline. Store the best approved candidate and its quality metrics separately from ongoing assessment; replace it only when a new candidate passes every gate with lower modelled relative uncertainty. Finishing or reaching the deadline restores those metrics to the final outcome and stops temporary capture. New bad readings cannot revoke the retained candidate. Application remains a separate, idle-only action after capture ends.

Expose a refining state through the shared snapshot. Before readiness show the existing progress/status display and Cancel. After readiness continue showing the live measurement status and its eligibility colour/low-speed threshold, alongside the short explanation More measurements may improve precision and Finish calibration alongside Cancel. A quality-approved reading is shown as Measuring while capture continues; readiness controls Finish availability without replacing live feedback. Preserve ownership across view recreation. Do not claim guaranteed greater accuracy, show an indefinite time target, replay operations, or reset the deadline. Both native hosts forward the existing generic state/effect boundary. Retain the historical Finish diagnostic method tag while restoring the public operation with the stricter approved-result prerequisite.
