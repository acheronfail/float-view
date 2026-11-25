# iOS distribution audit

This is the reusable implementation inventory and submission checklist. Brief
build-linked outcomes are in [the release verification summary](../openspec/changes/prepare-public-distribution/verification.md).
Detailed execution history and device results belong in ignored local records;
successful packaging is not Apple processing or physical beta acceptance.

## Privacy and network inventory

| Surface | Implementation and treatment |
| --- | --- |
| Bluetooth and telemetry | Native CoreBluetooth communicates with the selected VESC. Saved board identity, settings, tunes and recordings are stored by the shared Rust service in app-private SQLite files. No developer telemetry endpoint, advertising or analytics SDK is configured. |
| Route recording | Optional CoreLocation observations are recorded during rides. `CoreLocationAdapter` uses Always permission for recording that may restart with riding while locked/backgrounded; denying location does not prevent ordinary BLE telemetry. |
| Maps | Leaflet requests `https://tile.openstreetmap.org/{z}/{x}/{y}.png` for viewed recorded routes, up to zoom 19. Tiles can identify precise viewed areas; IP address, user-agent and HTTP metadata reach OSMF. The raw route/telemetry record is not uploaded. |
| Speech | AVSpeechSynthesizer speaks locally generated ride phrases; there is no microphone capture or speech-recognition upload. Platform voice downloads remain platform services. |
| Live Activity | ActivityKit local content updates, without push tokens, remote updates or a server. The extension reads only the supplied activity state. |
| Web frontend | Bundled single-file HTML talks to authenticated loopback HTTP/WebSocket endpoints. This communication remains on the same device. Only theme/accent hints are held in localStorage; product data belongs to Rust. |
| Imports/exports | User-selected imports are staged in private storage before Rust reads them. User-selected exports may contain precise route data. Shared-file copies and platform backups have separate lifetimes. |
| Support/TestFlight | Support links open public GitHub Issues. Apple provides TestFlight crash/usage/feedback information separately from app-initiated collection; the privacy policy explains this. A feedback email is still needed in App Store Connect, even when public support uses Issues. |

The public policy is [PRIVACY.md](../PRIVACY.md), linked from README and shared
Settings. Public console URL:
`https://github.com/acheronfail/float-view/blob/master/PRIVACY.md`.
Support URL: `https://github.com/acheronfail/float-view/issues`.
Check both URLs anonymously before submission.

Do not answer “Data Not Collected” solely because there is no developer server.
The app manifest conservatively declares precise location and other data (IP and
HTTP request metadata), linked and not used for tracking. Purposes include App
Functionality for tile delivery/operation and Analytics for the provider's stated
aggregate usage analysis. Logs can be linked to an IP before later aggregation;
no anonymity is promised. This includes requests for old/imported routes even
when current location recording is off. Review the matching App Privacy answers
in the console before release; there are no advertising/tracking domains and no
ATT request is needed for the audited functionality. Purely on-device board/ride records are not listed as
off-device collection. Support and TestFlight disclosures remain explicit.

OSMF requires attribution, identifiable requests and normal HTTP caching. The map
uses its standard HTTPS raster endpoint with no offline download feature. Leaflet
loads the viewport's tile range; its small buffer retains previously loaded
images rather than prefetching surrounding areas. Its world-wrap/zoom behavior
must remain bounded to ordinary interactive map use. Both app and tile requests
use normal WebKit caching; iOS appends FloatView/version to its user-agent.
Attribution remains in the map, including “OpenStreetMap contributors”.

For regression checks, intercept public tile requests with synthetic responses;
never pan/zoom against the live provider in automated suites. Inspect outbound
paths/headers for credentials, identifiers or raw route uploads and check narrow
layout attribution. Playwright request routing disables caching and can inject
no-cache headers: it cannot establish the native host's cache behavior. Probe
native WebKit separately with a controlled cacheable image endpoint, including
WebView recreation. Retain detailed request/cache captures locally. A provider
HEAD check can inspect cache directives/validators without downloading route tiles.

OSMF offers no availability guarantee. Sources: [tile policy](https://operations.osmfoundation.org/policies/tiles/),
[provider privacy policy](https://osmfoundation.org/wiki/Privacy_Policy).

### App Privacy worksheet

| Collected type | Reason | Purposes | Linked | Tracking |
| --- | --- | --- | --- | --- |
| Precise Location | High-zoom tile coordinates can reveal precise viewed route areas; the raw GPS track stays local. | App Functionality; Analytics (provider aggregate usage) | Yes | No |
| Other Data Types | Provider-retained IP/user-agent/request metadata; no app account, Bluetooth identity or backend token is sent. | App Functionality; Analytics (provider aggregate usage) | Yes | No |

Use this worksheet for App Store Connect's data-collection questions; publishing
a manifest does not save console answers. This is the interpretation of the
current map integration and the provider's stated processing, not a claim that
the developer receives map logs. No tracking/ATT prompt is needed for these
purposes. Purely local settings, board/ride data and speech are not declared as
off-device collection. Apple handles its own TestFlight data; public support and
source pages open in the external browser. Reassess optional support disclosures
if an in-app collection channel is added.

Apple guidance: [collection, purposes and linkage](https://developer.apple.com/app-store/app-privacy-details/),
including its WebView/off-device and IP-address guidance. Review/save the answers
in App Store Connect whenever the implementation changes. The owner confirmed
completion of the questionnaire matching this worksheet; this is an owner-reported
console result, not an independent console inspection.

## Required-reason APIs and manifests

The host app's `PrivacyInfo.xcprivacy` covers its Swift code and statically linked
Rust/SQLite implementation. There are no external Swift packages or embedded
third-party binary SDK frameworks. The frontend bundles Svelte/Leaflet; dev tools
and research vendor submodules are not copied into the app. Rust dependencies
come from the locked Cargo graph, including rusqlite/libsqlite3-sys and standard
library filesystem/time implementations.

| Category | Reason | Actual use |
| --- | --- | --- |
| SystemBootTime | `35F9.1` | SharedService timer deadlines/ordering, permission timeouts, speech cooldowns, ActivityKit update duration and Rust Instant timers. Exported timings are elapsed between app events, rather than raw system boot times. |
| DiskSpace | `E174.1` | SharedService checks available capacity; shared policy prevents recording/maintenance writes when space is insufficient. Raw available-byte facts stay inside the local runtime. |
| FileTimestamp | `C617.1` | Rust/SQLite stat/fstat/lstat and app-private schema-cache metadata/eviction, staging and file bounds. User imports are copied into private staging before Rust reads them. |

The separate Live Activity extension has its own manifest with no collection,
tracking or app-authored required-reason API calls. It renders supplied ActivityKit
content, including SwiftUI timer views; it does not link the Rust service or host
adapters. No direct UserDefaults or active-keyboard API use was found. Web
localStorage is not NSUserDefaults. Do not add speculative reasons for APIs that
the app does not use. The archive/export validator requires both packaged
manifests to match the reviewed source manifests.

Sources: Apple's [required-reason API list](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype),
[manifest packaging guidance](https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk),
[collection categories](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype).
Before submission, validate both packaged manifests and inspect Xcode Organizer's
aggregate Privacy Report from the candidate archive. Check collection categories,
purposes, linkage and tracking against the inventory above. Resolve any Apple
processing findings; local inspection alone does not establish acceptance.

## Permissions, background execution and encryption

- `bluetooth-central` supports active BLE telemetry/reconnection while backgrounded.
- `location` supports the optional route recording described above. Usage strings
  distinguish foreground and background recording. Always permission is requested
  through an explicit user recovery flow, not merely at app launch.
- `audio` supports user-enabled spoken ride announcements with an audio session;
  it is not a silent-audio keepalive. There is no microphone/recording declaration.
- NSSupportsLiveActivities is enabled; frequent remote updates, push notification,
  App Group and iCloud capabilities are not requested.
- Release WebViews no longer enable Safari inspection. Fixture adapters and
  performance/reset hooks remain behind build conditions. Mac Release launch overrides
  and test-host modes are also excluded; see the
  [Mac-specific audit](macos-distribution-audit.md).

The iOS Info.plist declares `ITSAppUsesNonExemptEncryption=false`: this app uses
platform HTTPS for maps, platform Bluetooth security and standard hashes (SHA-1
for WebSocket handshakes, SHA-256 for schema/content identity), with no custom
data-encryption implementation or bundled TLS stack in the locked iOS graph.
This declares no **non-exempt** encryption, rather than claiming HTTPS uses none.
Re-audit whenever dependencies/networking change and answer any applicable
territory-specific questions in App Store Connect. Source:
[Apple's beta export-compliance guidance](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-export-compliance-information-for-beta-builds/).

## Candidate and review checkpoints

Use the build-linked verification summary for completed checks. Before upload,
verify the exact candidate rather than reusing evidence from an earlier binary.

- Baseline 100 and software preservation/startup checks are implemented. Nightly
  82 passed the owner-reported scoped device checkpoint; simulator failure/retry
  presentation checks also passed. The owner subsequently confirmed TestFlight
  build 86 passed all scoped iOS device checks. See
  [storage-baseline.md](storage-baseline.md) and the verification summary.
- The [iOS package/source audit](ios-package-source-audit.md) verified exact
  public source and existing packaged texts, and fixed missing Rust runtime
  notices. The clean local signed preflight at source fae1814 passed corrected
  notices,
  manifests, entitlements, production-hook exclusions and exact-source checks.
  The hosted candidate build 86 and its independent package/source audit also
  passed; repeat these gates for each new candidate. Build 77 predates the
  fixes. The owner's official Apple permission is
  recorded in licensing.md; third-party terms remain independent.
- `just release candidate` created `v1.0.0-rc.1` (build 86) without publishing
  stable v1.0.0. Protected upload and Apple processing passed for build 86,
  including its reviewed encryption declaration. Verify each new candidate's
  actual transport/processing result; local packaging alone is insufficient.
- Beta description, privacy URL, feedback email and review contact/notes fields
  are saved (read-only API presence check). Review their final content and add
  build-specific what-to-test notes in App Store Connect. First tester is the owner;
  invited external users come later and need the applicable external beta review.
- Provide real supported-hardware pairing/use instructions and review evidence
  before external beta review. Build 86 passed the owner-reported delivered-build
  checkpoint; scope subsequent checks to affected behavior, including verifying
  the candidate-version display correction in the next candidate.

## TestFlight information worksheet

Draft copy for the first iOS beta. The owner enters private contact details in
App Store Connect; they must not be committed here. No console field is marked
complete merely because its proposed text appears below.

### Where to enter the private fields

In App Store Connect, choose Apps → Float View → TestFlight → Additional →
Test Information. Select the language and enter Feedback Email. Under the
TestFlight App Review information section, enter the reviewer contact name,
phone and email privately. This app has no sign-in account, so do not invent
reviewer credentials. Save the changes. Feedback Email is available to testers
and used as the reply-to for invitations; choose an address you are willing to
share with them. Public support can remain GitHub Issues.

Source: [Apple's test-information guide](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information/).

### First owner installation

After Apple successfully processes the candidate, open Apps → Float View →
TestFlight. Under Internal Testing, create a group such as “Owner testing”,
leaving automatic distribution disabled so builds are selected deliberately.
Use Add Builds to select the verified version/build and enter the What to Test
text below. Use Invite Testers to add only the owner's App Store Connect user,
then accept the invitation in TestFlight on the device. This step sends an
invitation; it is separate from uploading the binary. See
[Apple's internal testing guide](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/).

Export wanted recordings before changing signing/install channels. Do not
uninstall the existing app to force an update without first retaining those
exports. An installation under a different signing identity/container does not
establish an in-place upgrade. Verify the installed TestFlight version/build,
then run the scoped device acceptance procedure below. Successful Apple
processing does not establish device acceptance or external beta review.

### Beta App Description

Float View connects over Bluetooth to compatible VESC-based boards to display
live telemetry, record rides and review session history. Optional route recording,
spoken ride announcements and Live Activities support ride tracking. No account
is required. This beta requires compatible hardware for live features; recorded
sessions and the open-source licence information can be reviewed separately.

Float View is open source. Source code, build instructions and public support
are available at https://github.com/acheronfail/float-view.

### What to Test

Check Bluetooth discovery, connection and reconnection with your supported board.
Confirm live readings, session creation and history after restarting the app.
Try location recording both off and on, including a short locked-screen ride.
Check spoken announcements, Live Activity updates and session export/import.
Verify the new licences page opens from Settings and returns correctly.

Report the app version/build, iPhone model, iOS version, controller/firmware
versions, what you expected, what happened and reproduction steps. Remove precise
routes and private identifiers before posting public GitHub Issues; TestFlight
feedback is also available. Use the app only when it is safe to do so.

### Review Notes

No sign-in is required. Live telemetry needs a compatible VESC controller and
Bluetooth connection. The audited controller firmware families are VESC 6.02,
6.05, 6.06 and 7.00; exact board/Refloat/transport details for the physical review
example must be supplied from the accepted device test, not assumed from this
source inventory. This app is not a controller firmware installer.

After accepting the first-launch safety notice, enable Bluetooth access, select
the supported device on Connect and open its live view. Settings explains
optional location access and announcement controls. Background Bluetooth is used
for ongoing ride telemetry/reconnection, location for user-enabled route capture,
and audio for spoken announcements. Live Activities use local updates, not push.

History can be reviewed without hardware by importing an existing .floatview
archive: Sessions → Session actions → Import session, then choose the file.
The repository's public synthetic baseline recording is available for this
purpose; its location is fictional and it contains no user's ride data:
https://github.com/acheronfail/float-view/raw/master/backends/fixtures/public-baseline/100/recording.floatview

Before external beta review, the owner must add the tested hardware connection
steps and a reviewer-accessible physical-device/hardware interaction video.
The synthetic archive demonstrates history only, not real Bluetooth integration.
Do not submit these notes while those specific review inputs are missing.

### Hardware review video

Apple's [complete-review guidance](https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review/)
requires camera footage, not just a screen recording, for apps requiring hardware.
Show the app on a physical iPhone or iPad as it pairs/connects and interacts with
the board; keep the screen readable and show live readings and recorded history.
No riding footage is necessary. Supply concise hardware/firmware setup details
and an accessible video through private App Store Connect review materials;
keep detailed device results, video files and private links out of Git.

### URLs and declarations

- Privacy policy: https://github.com/acheronfail/float-view/blob/master/PRIVACY.md
- Support: https://github.com/acheronfail/float-view/issues
- No app account, advertising, analytics SDK, tracking domains or ATT prompt.
- App Privacy draft follows the audit above: map-provider precise location and
  request metadata, linked, no tracking, for App Functionality and the provider's
  aggregate Analytics. The owner confirmed completion of the console questionnaire
  matching this worksheet; an embedded manifest does not fill it in.
- The reviewed encryption declaration is embedded in Info.plist. Resolve any
  Apple processing questions on the actual uploaded build.

## Production listing draft

Owner-approved copy, not a claim that these console fields are saved.
Keep first-release screenshots and final categories/age rating as separate
submission checks. Source: [Apple product-page guidance](https://developer.apple.com/app-store/product-page/).

Read-only console verification confirms the description/subtitle, Utilities
category, support/privacy URLs, completed age questionnaire (Apple calculated
4+), version `1.0.0` and manual release. Production and TestFlight reviewer
contacts and hardware/video notes are saved. Build selection, final content-rights
review and screenshot upload remain open. Availability and business completion
are not established by this API verification.

The Developer-role API key cannot edit these listing fields or beta review notes
(HTTP 403). Enter remaining fields through the owner's App Store Connect session;
keep the upload key scoped to its existing role. Private handoffs and hardware
review materials remain local. Saving draft fields does not submit review.

- Name: Float View
- Subtitle: VESC telemetry and ride logs
- Primary category: Utilities (saved and independently verified).
- Keywords: Refloat,Bluetooth,electric board,battery,controller,route,session
- Support/privacy URLs: use the reviewed URLs above.

### Description

Float View connects to compatible VESC-based boards over Bluetooth to display
live telemetry, record rides and review session history.

- View live speed, battery and controller readings.
- Record rides and optional GPS routes, then review your sessions and charts.
- Import and export recordings, including CSV exports.
- Read and change supported board settings and Refloat tunes.
- Use optional spoken announcements and Live Activities during a ride.

Compatible VESC hardware and a Bluetooth connection are required for live
features. Recorded sessions can be reviewed without a connected board. Route
recording is optional; online maps use OpenStreetMap's tile service. No Float
View account is required.

Float View is open source under AGPL-3.0-or-later. Purchasing the app supports
ongoing development and distribution costs. Source code and project information:
https://github.com/acheronfail/float-view

### Screenshot and console checklist

- Capture the accepted candidate's live readings, recorded session/charts,
  optional route map and Settings on the supported iPhone/iPad display classes.
  Keep private routes/identifiers out of assets; label any illustrative/sample
  content accurately. Marketing screenshots do not replace the hardware review video.
- Confirm price, availability, agreements, banking/tax and applicable trader
  declarations privately in App Store Connect.
- Review iPhone/iPad compatibility availability on Apple-silicon Macs before
  public release. The owner selected opting out in Pricing and Availability
  while the native macOS store app is pending; console state still needs owner
  confirmation. This is a
  separate setting from publishing the native macOS app. See
  [Apple's Mac availability guide](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/manage-availability-of-iphone-and-ipad-apps-on-macs-with-apple-silicon/).
- Complete the age-rating questionnaire from the actual app content. Board
  telemetry is not medical advice; local recordings/imports are not a public
  social feed. External browser links do not turn the pinned app WebView into an
  unrestricted web browser. Review each console question before selecting its
  answer; Apple calculates the rating from those responses. See
  [Apple's age-rating guide](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/).
- Select manual production release and the accepted processed build when ready
  for App Review; candidate upload alone must not submit review or release the app.

Eight labelled sample-data screenshot drafts are available in local readiness
records for owner review: four views each at iPhone 1179 × 2556 and iPad
2048 × 2732. They render the actual shared UI in WebKit with synthetic data;
compare them with the native app and approve final assets before upload. No
screenshots are recorded as saved in the console. Verify the console's current
accepted slots against [Apple's screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

## Device acceptance procedure

Record the tested build and results locally, following the recording policy in
the verification summary.

Install over the existing app using the same AltStore signing identity; do not
uninstall first. A different identity/container cannot establish an old-data
upgrade. If old data is already at baseline 100, preservation is expected and
must not be mistaken for a failed reset. Export any recordings you want to keep
before updating, since recognised pre-baseline development data is disposable.

In the local result record, include iPhone model, iOS version, installed display
version/native build and supported board/controller/Refloat/transport versions.
Check:

1. Recognised old development data resets once; OS grants remain accurate.
2. Create a new saved board/settings change and session. Relaunch twice and
   confirm new data remains. Also check process restart, not just foregrounding.
3. Connect/reconnect the real board; test Bluetooth denial/recovery if it is
   practical without disrupting other work.
4. Enable optional route capture through Settings, check denial/recovery, record
   briefly while locked/backgrounded, and confirm timestamps/map route on return.
5. Check announcements and Live Activity during that same scoped session.
6. Export/import a recording; keep the exported copy outside the app container.
7. Open Settings → View licences and notices, scroll and return to Settings.
8. Open privacy, support and source links in the system browser; return and
   confirm Settings remains usable and the embedded app has not navigated away.

This is a focused regression checkpoint for the storage baseline, permission
state and real iOS background/Bluetooth integration. Simulator checks establish
synthetic storage handling and UI behavior, but cannot establish real radio,
location, announcements or lock-screen behavior. Do not create unsafe riding
conditions just to test; a short controlled session is enough. Record the actual
native build number from the tested nightly. This sideload check does not
establish TestFlight signing, delivery or production entitlement behavior.

Failure/retry presentation is exercised separately on an isolated simulator with
synthetic unsupported data; do not alter real databases to provoke that failure.
Store-delivered permissions/background behavior still needs a TestFlight pass
once the first upload is processed.

## Package identity

| Item | Value |
| --- | --- |
| App / extension | `fail.acheron.floatview` / `fail.acheron.floatview.live-activity` |
| Minimum iOS/iPadOS | 17 |

Validate the publishing team, current public certificate fingerprints and profile
expiry against the signed candidate. Keep the operational signer inventory and
credential provisioning history local; private signing material stays outside Git.
