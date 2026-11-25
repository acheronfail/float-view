# Release verification summary

## Recording policy

Keep reusable procedures, open release gates and brief build-linked outcomes in
Git. Keep detailed execution history, device/OS/firmware inventories, tester
reports, screenshots, logs, account setup and approval history in ignored local
records under `.local/ios-store/readiness/`. Raw artifacts can remain in their
existing ignored build folders. Arrange a private backup when retention matters;
ignored files are not backed up by Git.

A public result should identify the build/source or CI run, tested scope,
pass/fail/pending status and material limitations. Include sanitized actionable
failures without publishing personal device records, routes, identifiers or
contact details. Never infer physical acceptance from software checks. Preserve
existing Git history; this policy does not require rewriting earlier commits.

## Build-linked results

| Build / source | Scope and result | Limits / next step |
| --- | --- | --- |
| [Mac nightly / run 38863449266](https://github.com/acheronfail/float-view/actions/runs/38863449266) | Developer ID signing, notarization, stapling, quarantined download and Gatekeeper checks passed. Installation/permissions checkpoint passed. | Does not establish Mac App Store sandbox behavior or recording/export acceptance. |
| [iOS 1.0.0 (77) / run 38977368838](https://github.com/acheronfail/float-view/actions/runs/38977368838), [source fae17d3](https://github.com/acheronfail/float-view/tree/fae17d3206174adfd1c432bb64d7df370e9a005f) | Protected signing/export, independent IPA validation, exact-source access and packaged privacy checks passed. Read-only Apple authentication/app/build lookup passed. | No upload or Apple processing acceptance. Predates the Rust runtime notice correction and is ineligible for submission. |
| [Nightly 78 / run 38980352255](https://github.com/acheronfail/float-view/actions/runs/38980352255), [source fae1f60e](https://github.com/acheronfail/float-view/tree/fae1f60ea5709fb40f6856c2a62a9c4ce63ec414) | IPA/APK passed; master selected no store jobs. Mac notarization was accepted, but ticket stapling failed on both attempts, preventing nightly publication. | A subsequent retry fix needs successful publication. Physical iOS acceptance is pending on the nightly actually installed. |
| [Apple navigation implementation fae1aff1](https://github.com/acheronfail/float-view/commit/fae1aff18ecb00da432fdc09a838e1a35dd75b44) | Focused native policy/startup tests and Release iOS simulator privacy/support/source browser handoff passed. | Local software/simulator verification; subsequent nightly device acceptance is recorded below. |
| [iOS nightly 82 / run 38986380948](https://github.com/acheronfail/float-view/actions/runs/38986380948), [source fae1971](https://github.com/acheronfail/float-view/tree/fae1971b4f947215dad7ef962c6a1702686dae2a) | CI succeeded. Owner confirmed build 82 passed all scoped iOS device acceptance checks, including storage, Bluetooth/permissions, locked-screen recording, announcements, Live Activity, import/export and licence/browser navigation. | Sideload acceptance; detailed results remain local. Does not establish App Store signing, Apple processing or TestFlight-delivered behavior. |
| [iOS local signed preflight / source fae1814](https://github.com/acheronfail/float-view/tree/fae1814f9696b56071755d33784f0e233cc34bac) | Distribution export, app/extension signatures/profiles/entitlements, corrected full notices, manifests, permission text, development-hook exclusion and anonymous exact-source comparison passed. Release iPad simulator rotation and browser resizing checks passed. | Local test number, not an upload allocation. Does not establish hosted candidate upload, Apple processing or TestFlight delivery; detailed artifacts stay local. |
| [iOS candidate v1.0.0-rc.1, build 86 / run 38990541780](https://github.com/acheronfail/float-view/actions/runs/38990541780), [source fae1651](https://github.com/acheronfail/float-view/tree/fae16516d2565b59c747203e17712bc3affdd222) | Hosted signing/export and independent IPA validation passed: app/extension distribution signatures, profiles, entitlements, full notices, manifests, permission text, iPad orientations, source/build identity and development-hook exclusion. Anonymous exact-source comparison passed. All three sideload packages published as a separate GitHub prerelease. Protected Apple upload passed; matching receipt and independent API check confirm VALID processing and no non-exempt encryption. | Owner confirmed installation through TestFlight and all scoped iOS device checks passed. Settings shows the numeric v1.0.0 without the candidate suffix; the display correction needs a subsequent build. External beta review remains open. |
| [iOS candidate v1.0.0-rc.2, build 88 / run 38992628964](https://github.com/acheronfail/float-view/actions/runs/38992628964), [source fae11a5](https://github.com/acheronfail/float-view/tree/fae11a5d0f1b1774e340ffcaad2e7c7280b381d8) | Hosted signing/export, independent IPA distribution/package checks, anonymous exact-source comparison, all sideload builds/publication and protected Apple upload/processing passed. The exact packaged frontend displays v1.0.0-rc.2 in Settings under WebKit. | Owner confirmed build 88 installed through TestFlight and Settings displays v1.0.0-rc.2. This packaging-only correction does not reopen unaffected BLE/background acceptance from build 86. Production and TestFlight hardware/video review notes are verified saved; remaining listing work and external beta review remain open. |

## Unpublished checks

Local software, unsigned packaging and simulator checks are retained in the local
readiness record. They do not certify a signed release candidate. Publish their
brief result against the committed build after the relevant checks pass.

## Open release gates

- Repeat package/source gates for each new candidate. Build 88 passes the hosted
  export and independent package/source checks.
- Complete remaining console metadata and review materials. The owner confirmed
  completion of the iOS App Privacy questionnaire; private TestFlight contact
  fields are configured. Hardware details and video are verified in both
  production and TestFlight review notes. Final listing/assets, account declarations and external beta
  review remain open; detailed review materials stay local and in private
  console fields.
- Owner-reported TestFlight device acceptance passed for build 86; the scoped
  candidate-version display check also passed through TestFlight in build 88.
  Upload readiness
  remains enabled behind protected environment review; external beta review is
  still pending.
- Complete remaining Android/Mac-specific tasks. The approved historical v0
  release/tag cleanup and subsequent fresh nightly publication are verified.
  Stable v1.0.0 publication and Apple processing are recorded below.

The implementation checklist is 13/38 complete. Local checks do not close
cross-platform tasks or external submission gates.

## Historical development release cleanup

Applied the exact [cleanup manifest](../../../docs/pre-v1-release-cleanup.json)
with Build apps disabled and no active runs: 49 releases/70 assets, 50 remote
tags and 51 local tags removed. All six v1.0.0 candidate releases/tags, the
rolling Nightly/assets, other refs and HEAD commit history were preserved.
Build apps is active again. Fresh nightly publication is verified below;
this cleanup does not establish Android Play or Mac App Store readiness.

[Post-cleanup master run 39009005958](https://github.com/acheronfail/float-view/actions/runs/39009005958)
passed release-tooling checks and resolved the preserved nightly version with
store signing/upload disabled. Since that source already had complete Nightly
assets, packaging/publication correctly skipped. All 28 focused local version
and distribution tests passed, including cleanup/count continuity. The subsequent
[fresh nightly run 39009233662](https://github.com/acheronfail/float-view/actions/runs/39009233662)
succeeded for IPA/APK/notarized Mac ZIP and publication, with both store jobs
skipped. This completes the one-time cleanup verification.

## Local Mac App Store sandbox proof

The universal Release feasibility package passed signature/entitlement and
resource checks, native WebView and authenticated loopback, supported-baseline
archive import/export, settings/recording preservation across relaunch, and
native Save-panel export outside the container with staging-lease release.
The connected ESP fixture passed scoped direct connection/recording and
unexpected-disconnect recovery, including RESET/READY cleanup. These checks
used an ad-hoc, isolated sandbox-check identity from the working source; exact
executable hashes, dirty source status, device/fixture inventory and raw reports
remain local. They do not establish store signing, store delivery, rider-board
interoperability, location or speech acceptance. See
[Mac distribution preparation](../../../docs/macos-distribution.md).

The independent desktop-window change is committed as
[fae10b1](https://github.com/acheronfail/float-view/commit/fae10b1f0e448f97b7f0733971a9cf2b7143a462).
Its universal Release rebuild and native desktop-size/persistence checks passed;
it does not reopen unchanged Bluetooth behavior from the sandbox proof.


Mac store packaging now has separate structural-check and clean-source signed
package commands, plus an independently gated signing/artifact job. Universal
Release structure, resources and full bundled legal-text checks passed locally;
profile/source/release-routing and dual-identity cleanup tests pass. The owner
confirmed signing-material backups, and the separate Mac app record was verified
read-only. Shared apple-store-signing reviewer/tag protection, expected secret
names and per-platform readiness were verified before enabling Mac signing.
Subsequent hosted results appear below. No Mac upload or review submission occurred. Detailed records and setup commands remain local.

A clean checkout of source `fae1c3c` passed the complete universal Release
store-package command, Apple Distribution app-signature/entitlement checks,
full bundled legal-text checks and Mac Installer Distribution package signing.
The temporary signing keychain was removed. That local check did not verify
GitHub secret values, hosted signing or Apple processing/install acceptance.


[Mac store candidate v1.0.0-rc.7, build 102](https://github.com/acheronfail/float-view/actions/runs/39022207820),
source `fae1a3a`, passed protected hosted signing. Independent downloaded-installer
inspection passed Apple installer/app signatures, shared source/build record and
package hash, embedded profile/signer match, exact sandbox entitlements, universal
executable and development-entry-point exclusion, source-matching privacy/icon
and complete bundled legal text. The shared environment's Mac signing credentials
are now exercised; iOS is verified separately. No Mac Apple upload occurred, and
processing, store installation and affected runtime acceptance remain open.
Detailed logs, hashes and extracted-package evidence remain local.


## Mac privacy and protected delivery implementation

The [Mac source/map audit](../../../docs/macos-distribution-audit.md) records the
shared data behavior and Mac-specific required-reason/API differences. Native
WebKit checks verify the app user agent, HTTP cache reuse and actual registration
of both navigation-policy callbacks; the audit fixed an SDK callback-signature
mismatch. Focused native navigation/startup/theme checks, intercepted map browser
checks, privacy/resource packaging checks and release/upload tooling tests pass.
Detailed logs remain local.

Mac protected delivery uses the shared `apple-store-upload` environment and team
API key, with separate app IDs/readiness. It independently verifies the signed
PKG and uses processing receipts before any retry. Mac upload readiness remains
off. Shared-key presence, tag-only protection, separate app IDs and read-only
Apple authentication/platform queries are verified. A new signed candidate,
hosted read-only verification, Apple processing and store-delivered physical acceptance are still required. No Mac
upload, tester invitation or review submission occurred in this step.


## Candidate RC8 delivery checkpoint

[RC8 build 104](https://github.com/acheronfail/float-view/actions/runs/39024530139),
source `fae12466`, passed all platform builds, both protected signing jobs and
GitHub prerelease publication with all three sideload artifacts. Shared-environment
iOS upload and Apple processing passed. Independent Mac PKG inspection verified
signatures, source/build, profile/entitlements, privacy resources and full notices.
Mac delivery failed: Apple's validation identified root-only bundle permissions
inherited from the credential wrapper's restrictive umask. The recorded transport
outcome is uncertain; do not blindly resend build 104. A packaging permission
check/fix and a fresh candidate/build number are required before Mac acceptance.
Detailed diagnostics, receipts, screenshot assets and device results stay local.

## Candidate RC9 Apple delivery checkpoint

[RC9 build 106](https://github.com/acheronfail/float-view/actions/runs/39025585402),
source `fae1bec2`, passed every CI job: three sideload packages, GitHub prerelease
publication, both protected Apple signing jobs and both shared-environment uploads.
Mac and iOS processing are independently confirmed `VALID`; exact-source/run/build
receipts are retained locally. The downloaded Mac PKG independently passed the
signature/profile/entitlement/resource/source audit, including the corrected
non-root permissions. Its internal TestFlight group contains build 106. The
ordinary master run still skipped all store signing/upload jobs with readiness
enabled. The owner subsequently confirmed the requested Mac TestFlight checks
passed for build 106. This is owner-reported physical acceptance; detailed results
remain local. Production review and remaining platform checks remain open.


## Mac listing handoff

The owner completed the Mac listing and six desktop screenshots. Read-only
verification confirms all six assets processed, Utilities, 4+, privacy/support
URLs, review-contact presence and manual release. The owner corrected iOS-only
Live Activities wording and recorded a Mac hardware demonstration; its new private
review link and corrected text are verified saved. Footage recording is
owner-reported. Build selection and owner-only pricing/availability confirmation
remain before App Review submission. Private review materials stay local.

## Stable v1.0.0 checkpoint

[Stable v1.0.0 build 108](https://github.com/acheronfail/float-view/actions/runs/39028413704),
source `fae18a46`, passed every CI job: all sideload packages, stable GitHub
publication, both protected Apple signing jobs and both Apple uploads. Exact
receipts and independent API checks confirm both builds processed as `VALID`.
Downloaded Mac PKG inspection passed signatures/profile/entitlements, source/build,
resources/notices and installed-bundle permissions. Its exact packaged Settings
page renders `v1.0.0` in WebKit; seven focused chart regression tests also pass.
These are software/package checks, not a new physical device acceptance report.
Both store records retain manual release; final build selection and App Review
submission remain owner-controlled. The broader Android/store launch gates remain
open. Detailed artifacts and private review material stay ignored locally.
