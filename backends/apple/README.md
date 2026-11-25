# Apple host

Swift owns Apple OS integration for the [shared Rust service](../core/README.md).
One `SharedService` creates the process owner; `LoopbackServer`, listeners and
WebViews borrow it. Export presentation retains the service's file lease until
dismissal or completion of the scoped destination copy. Do not add native product
storage, reconnect policy, public dispatch or snapshot reconstruction.

| Path                                                    | Responsibility                                        |
| ------------------------------------------------------- | ----------------------------------------------------- |
| `Sources/FloatViewBackend/application/`                 | Composition and OS exchange                           |
| `Sources/FloatViewBackend/bluetooth/`                   | CoreBluetooth, GATT and permissions                   |
| `Sources/FloatViewBackend/location/`                    | Core Location                                         |
| `Sources/FloatViewBackend/transport/`                   | Listener lifetime and C buffers                       |
| `Sources/FloatViewBackend/speech/`                      | Native synthesis and audio-session lifecycle          |
| `Sources/FloatViewBackend/protocol/`                    | Software-conformance fixture only                     |
| `ios/float-view/`                                       | iOS lifecycle, file presentation, theme and WebView   |
| `ios/FloatViewLiveActivity/`, `ios/LiveActivityShared/` | WidgetKit UI and ActivityKit model                    |
| `ios/float-view/live-activity/`                         | ActivityKit lifecycle                                 |
| `macos/`                                                | macOS lifecycle, file presentation and window/WebView |

## Local builds and permissions

Run command examples from the repository root.

Use [CONTRIBUTING.md](../../CONTRIBUTING.md) for setup and run commands.
`just test apple` covers adapters and the shared boundary; `just apple-packaging`
checks clean macOS, iOS simulator and device packages. Select checks by
[impact](../../AGENTS.md#verification).

For signed device builds, select your account in Xcode Settings → Accounts and
set the team outside source:

```sh
export APPLE_TEAM_ID=YOUR_TEAM_ID
just run ios <device-id>
```

The recipe supplies `DEVELOPMENT_TEAM` to both app and extension. For direct
`xcodebuild` calls, pass that override yourself. Do not save personal signing teams
in `project.pbxproj`; unsigned packaging needs no team.

`just run macos` launches `/tmp/float-view-swift-build/Float View Desktop.app`
through `package-macos.sh`. Launch the bundle: `swift run` omits the identity and
usage descriptions required by Core Location. Icon compilation requires Xcode 26+;
see [icon tooling](../../tools/icon/README.md).

CoreBluetooth can report an unknown radio until its first permission request.
Reading state or quitting an unused app must not instantiate a manager just to
prompt. For permission changes, physically check first request, denial/recovery and
quit-without-requesting. Check Location via Settings → Permissions → Location with
Location Services enabled. Mocked tests cannot establish native prompt presentation.

## Embedded navigation

WebViews stay on the embedded document's origin/path/query; internal hash routes
remain allowed. User-activated HTTP(S) links, including new-window targets, open
in the system browser. Preserve the app route and reject scripted external
navigation, other schemes and subframes.

## iOS App Store preparation

Local store preparation uses Release for the app and Live Activity extension.
It is separate from the unsigned AltStore IPA and does not upload or tag.
See [release commands and numbering](../../docs/releases.md) and the
[iOS privacy/review audit](../../docs/ios-distribution-audit.md).

### Account and signing setup

- Install an upload-supported [Xcode/SDK](https://developer.apple.com/xcode/resources/).
  A newer SDK does not require raising the app's deployment target. Select a
  particular Xcode with `DEVELOPER_DIR` when multiple versions are installed.
- Register explicit IDs `fail.acheron.floatview` and
  `fail.acheron.floatview.live-activity` for the same publishing team. Do not enable
  unused App Groups, iCloud or push capabilities.
- Create an Apple Distribution identity and securely back up its private key.
  Automatic local signing may also need Apple Development; Developer ID signing
  for direct Mac downloads is a different identity.
- Create the iOS record in [App Store Connect](https://appstoreconnect.apple.com/apps)
  using the main ID; the extension has no separate listing. Resolve agreements,
  price, territories and privacy/support information before publication.

Changing a bundle ID creates another installation/container; no old-container
alias or migration is provided. Keep team IDs and signing material out of source.

### Local archive and export

Install frontend dependencies and the pinned Rust toolchain with
`aarch64-apple-ios`. Fetch dependencies before the offline build:

```sh
(cd backends/core && cargo fetch --locked --target aarch64-apple-ios)
```

The helpers rebuild the frontend. An unsigned structural check needs no account
and cannot subsequently be exported as a store build:

```sh
FLOAT_VIEW_VERSION=v1.0.0 FLOAT_VIEW_BUILD_NUMBER=1 \
  just ios-archive-check /tmp/float-view-ios-archive-check
```

For signed preparation, use clean source, fresh output directories and an explicit
allocated build number. Local helpers do not allocate numbers or reserve tags;
never reuse an Apple-consumed number for a corrected binary.

```sh
# Set APPLE_TEAM_ID and an allocated FLOAT_VIEW_BUILD_NUMBER outside Git.
export FLOAT_VIEW_VERSION=v1.0.0
just ios-store-archive .local/ios-store/candidate-archive
just ios-store-export .local/ios-store/candidate-archive .local/ios-store/candidate-export
```

Normal commands use installed assets. To authorize Xcode account/profile updates:

```sh
python3 backends/apple/ios-store.py archive .local/ios-store/candidate-archive \
  --allow-provisioning-updates
python3 backends/apple/ios-store.py export .local/ios-store/candidate-archive \
  .local/ios-store/candidate-export --allow-provisioning-updates
```

`archive.json` and `export.json` record source/version and package hashes. A partial
directory without its verification record is not a verified export. The tooling
rejects changed archives, mismatched app/extension signing and existing outputs.
Export remains local; successful signing does not establish Apple acceptance.

### Protected CI store builds

Only exact stable/candidate tags select store jobs; master/nightly builds do not.
See [Build apps](../../.github/workflows/build-apps.yml) for job inputs and
[releases](../../docs/releases.md) for source/build-number continuity.

Configure `apple-store-signing` with a tag-only deployment policy and no required
reviewers. Stable and RC signing builds proceed automatically.
iOS and Mac share `APPLE_DISTRIBUTION_P12_BASE64` and
`APPLE_DISTRIBUTION_P12_PASSWORD`; profiles/readiness remain platform-specific,
and Mac installer signing is separate. The workflow reuses `APPLE_TEAM_ID`.

Export only the selected Apple Distribution certificate/private key as encrypted
PKCS12 under ignored `.local/ios-store/ci-signing/distribution.p12`. In the Apple
developer portal create two App Store Connect distribution profiles for that
certificate: one for each explicit app/extension ID. Save them locally as
`app.mobileprovision` and `live-activity.mobileprovision`. Development/ad-hoc and
Xcode-managed profiles are not accepted by the manual CI route; automatic local
signing can retain its managed profiles.

Set the PKCS12 password interactively, then upload the selected files:

```sh
gh secret set APPLE_DISTRIBUTION_P12_PASSWORD --env apple-store-signing --repo acheronfail/float-view
base64 < .local/ios-store/ci-signing/distribution.p12 | \
  gh secret set APPLE_DISTRIBUTION_P12_BASE64 --env apple-store-signing --repo acheronfail/float-view
base64 < .local/ios-store/ci-signing/app.mobileprovision | \
  gh secret set IOS_APP_PROFILE_BASE64 --env apple-store-signing --repo acheronfail/float-view
base64 < .local/ios-store/ci-signing/live-activity.mobileprovision | \
  gh secret set IOS_EXTENSION_PROFILE_BASE64 --env apple-store-signing --repo acheronfail/float-view
gh variable set IOS_STORE_SIGNING_READY --body true --env apple-store-signing --repo acheronfail/float-view
```

Enable readiness only after protections, secrets and profiles are configured.
Renew matching certificates/profiles together and keep a secure private backup.
For a build-only retry, use the actual release tag:

```sh
gh workflow run build-apps.yml --ref vX.Y.Z -f ios-store=true --repo acheronfail/float-view
```

### Protected Apple delivery

Signing and enabled delivery proceed automatically for stable and RC tags.
`apple-store-signing` and `apple-store-upload` retain tag-only protection and
separate credentials without required reviewers. Keep `ASC_API_PRIVATE_KEY_BASE64`
as its secret and `ASC_API_KEY_ID`,
`ASC_API_ISSUER_ID`, `ASC_IOS_APP_ID` and `ASC_MAC_APP_ID` as its variables.
The Developer-role team key can access team apps; keep its downloaded key private.

Before enabling `IOS_STORE_UPLOAD_READY`, accept package, privacy and supported-data
checks. Use a read-only delivery check for the exact tag/app/build:

```sh
gh workflow run build-apps.yml --ref vX.Y.Z -f ios-store=true -f ios-delivery=check --repo acheronfail/float-view
```

`check` verifies the package and Apple records without uploading. Enabled release
delivery or `ios-delivery=upload` uploads and retains a processing receipt; neither
invites testers nor submits review. Complete hardware review instructions/video
before external beta review, not necessarily before the owner's first upload.

Inspect receipts and Apple state before retrying an uncertain transport result.
Never blindly resubmit; corrected binaries need fresh source/run/build numbers.
Pending processing is not completed delivery. Download receipts needed beyond
Actions retention. Public build artifacts and receipts are not confidential.

### Mac App Store preparation

The store app uses `fail.acheron.floatview.macos`; the direct-download Mac app
retains its separate identity. See [Mac distribution](../../docs/macos-distribution.md)
for profiles, installer signing, sandbox checks and data-transfer limits.
Current outcomes and remaining gates belong in the
[release verification summary](../../openspec/changes/prepare-public-distribution/verification.md).

## macOS release app

The workflow builds a universal Release app and uses
`acheronfail/dist-tools/actions/apple-release@v1` for Developer ID signing,
notarization, stapling and ZIP packaging. The direct-download bundle ID is
`fail.acheron.float-view.macos`; local runs use ad-hoc signing.
Sync credentials with the [dist-tools CLI](https://github.com/acheronfail/dist-tools/blob/v1/docs/credentials.md).

| Setting                                                                 | Type     |
| ----------------------------------------------------------------------- | -------- |
| `MACOS_CODE_SIGN_P12_BASE64`, `MACOS_CODE_SIGN_P12_PASSWORD`            | Secret   |
| `APPLE_TEAM_ID`                                                         | Secret   |
| `APPLE_NOTARY_API_KEY`, `APPLE_NOTARY_KEY_ID`, `APPLE_NOTARY_ISSUER_ID` | Secret   |
| `APPLE_NOTARY_AUTH_MODE=api-team`                                       | Variable |

Without the auth-mode variable, CI uses `APPLE_NOTARY_APPLE_ID` and
`APPLE_NOTARY_PASSWORD` instead. Store certificates/environments are separate.
For a local ad-hoc universal app, build the frontend with `just build`, install
both macOS Rust targets and run:

```sh
FLOAT_VIEW_VERSION=YOUR_VERSION FLOAT_VIEW_BUILD_NUMBER=YOUR_BUILD_NUMBER \
  bash backends/apple/build-macos-release.sh
```

Output goes under
`${FLOAT_VIEW_MACOS_BUILD_ROOT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/float-view-macos-build}`.

## AltStore installation

`just ipa` builds an unsigned device IPA without a connected device or signing
account. It writes `FloatView-YYYYMMDD-HHMMSS.ipa` in the invocation directory.
For explicit metadata, set `FLOAT_VIEW_VERSION` and `FLOAT_VIEW_BUILD_NUMBER`;
set `FLOAT_VIEW_BUILD_CONFIGURATION=Release` for a Release package.
GitHub package channels and artifact retention are documented in
[releases](../../docs/releases.md).

Transfer the IPA to Files and select it with + in AltStore's My Apps tab. AltStore
signs installation and refreshes. Before removing an incompatible development
installation, export recordings you need to preserve; uninstalling can erase data.

## iOS Live Activity

Use Xcode Canvas in `ios/FloatViewLiveActivity/FloatViewLiveActivity.swift` for
Lock Screen, Island, stale, narrow and large-text previews. ActivityKit rendering
and background execution are controlled by iOS; a returned update call is not
proof that the Island rendered it. The app uses local updates, so the remote-push
frequent-updates entitlement is not enabled speculatively.

Unified logging uses subsystem `fail.acheron.floatview`, category `LiveActivity`.
`update_begin` and `update_end` distinguish submission latency from presentation.
For a Debug-only comparison, launch with `FLOAT_VIEW_LIVE_ACTIVITY_BASELINE=1`;
Release ignores the switch. Capture several minutes of Console logs and timestamped
Island/Lock Screen observations under matching power/background conditions without
a debugger; correlate with `liveactivitiesd` and `chronod` where available.

For a physical checkpoint, connect the stationary ESP32 fixture, background after
readiness, resume riding and inject reconnect. Check stale readings, recovery on
the same activity, explicit disconnect, user dismissal, disabled Live Activities
and the explicit Show Live Activity action. Compare values with the app and test
compact/expanded layouts. Restore the fixture afterward. Procedures and brief
outcomes are in [physical checkpoints](../../conformance/physical-checkpoints/README.md);
keep detailed captures local. Simulator previews do not establish background delivery.

## Spoken announcements

`speech/SpeechAdapter` owns native synthesis and audio-session cleanup; shared
Rust owns eligibility and timing. iOS voices must be downloaded and exposed to
apps; the available system default can differ from Spoken Content selection.
Use the manual Read & Speak/Spoken Content → Voices path instead of undocumented
Settings URLs. Calls or unavailable audio can prevent speech. Adapter tests
establish cleanup, not audibility, headset routing or music restoration.

## Startup recovery

Retries for listener/WebView failures retain the process owner. Recovery must
preserve user data and must not offer a storage reset. Native first-use prompts
and foreground reconstruction require OS presentation checks when affected.

The connected-device UI checkpoint needs no ESP32:

```sh
xcodebuild test -project backends/apple/ios/float-view.xcodeproj -scheme float-view \
  -destination 'platform=iOS,id=<device-id>' -allowProvisioningUpdates \
  "DEVELOPMENT_TEAM=$APPLE_TEAM_ID" \
  -only-testing:float-view-lifecycle-tests/FloatViewLifecycleTests/testStartupAndForegroundPresentation
```

Set `SystemAttachmentLifetime=keepAlways` in the generated `.xctestrun` when
retaining XCTest screen recordings. Follow the root
[evidence policy](../../AGENTS.md#verification).
