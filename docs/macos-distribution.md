# Mac App Store preparation

Float View uses separate paid iOS and macOS app records. The native Mac store
app uses `fail.acheron.floatview.macos`; it is not the iPhone app running on
Apple silicon and does not participate in iOS universal purchase.

The notarized direct-download app keeps `fail.acheron.float-view.macos` and its
Developer ID signing/notarization route. Store work must not replace that ZIP.

## Account and signing inputs

1. Register the explicit macOS identifier `fail.acheron.floatview.macos` in
   [Apple Developer identifiers](https://developer.apple.com/account/resources/identifiers/list).
2. In [App Store Connect Apps](https://appstoreconnect.apple.com/apps), use
   **New App**, macOS only, that bundle ID, an English primary language and
   an internal SKU such as `float-view-macos`. If the existing iOS record
   prevents reusing the name, use `Float View Desktop`. Keep Apple platform names
   out of the store title, following the App Review naming feedback. The native
   bundle display name is `Float View Desktop`. Do not add macOS to the
   iOS record when separate purchases are intended. See
   [Apple's app-record guide](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/).
3. Create a **Mac App Store Connect** distribution profile for the identifier,
   selecting the publishing team's Apple Distribution certificate. Download it
   into ignored `.local/macos-store/`. The iOS app's profile and Developer ID
   certificate do not substitute for this profile. See
   [Apple's profile instructions](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/).
4. Create a **Mac Installer Distribution** certificate using a locally generated
   **RSA 2048** key and CSR (the portal rejects RSA 3072 for this certificate),
   then download the certificate into the same ignored folder. Retain and
   securely back up its matching private key and password. The package signer
   is distinct from the Apple Distribution app signer. See
   [Apple's package-signing guidance](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution).
5. Independently validate the downloaded profile's team, exact app identifier,
   certificate, expiry, distribution type and granted entitlements. Match the
   installer certificate to its CSR/private key before importing/exporting it.
   Keep identities, fingerprints, profiles and operational records local.

No Mac helper uploads software, creates store records or sends private keys to
GitHub. The protected signing job is selected only by explicit stable/candidate
release tags and retains the existing cross-platform CI build-number allocation.
It is disabled until the repository variable `MACOS_STORE_SIGNING_ENABLED` is
`true`. Upload has its own readiness switch and does not run on ordinary master/nightly builds.

## Main-window review check

The app stays running when its main window closes. **Window → Show Float View**
(`Command-0`) must remain enabled without an open window and reopen the shared
frontend using the existing runtime. It must also restore a minimized window or
bring the existing window forward without creating a duplicate. Dock reopening
remains supported. Check close/reopen and minimize/restore on the submitted Mac
build; closing the window is not the same as quitting the application.

## Store packaging and protected CI

`just mac-store-package-check <new-output-directory>` rebuilds a universal
Release app using the real store bundle ID, checks resources and full legal
notices, and records source/version/build metadata. It uses ad-hoc signing and
is not uploadable. Set `FLOAT_VIEW_VERSION` to `vX.Y.Z` or `vX.Y.Z-rc.N` and an
explicit `FLOAT_VIEW_BUILD_NUMBER`; local test numbers are never CI allocations.
Do not launch this check as a substitute for a store-delivered installation.

`python3 backends/apple/mac-store.py package <new-output-directory> --profile
<profile-path>` requires clean committed source, `APPLE_TEAM_ID`, the Apple
Distribution certificate SHA1 in `CODE_SIGN_IDENTITY` and the matching
`MAC_INSTALLER_IDENTITY` name. `CODE_SIGN_KEYCHAIN` and
`MAC_INSTALLER_KEYCHAIN` select already-provisioned keychains when needed.
It rebuilds from source, validates the distribution profile, signs the app,
checks exact entitlements and Apple's certificate chain, signs the installer
and records its SHA256. Neither command uploads software.

Both iOS and Mac use one Apple Distribution identity in the shared protected
`apple-store-signing` environment; do not duplicate its certificate/password
under platform-specific names. Profiles and readiness switches remain separate.
Before enabling CI, create that GitHub environment with
release-tag deployment rules and no required reviewers. Configure these secrets:
`APPLE_DISTRIBUTION_P12_BASE64`, `APPLE_DISTRIBUTION_P12_PASSWORD`,
`MAC_INSTALLER_P12_BASE64`, `MAC_INSTALLER_P12_PASSWORD`, and
`MAC_STORE_PROFILE_BASE64`. Set environment variables `APPLE_TEAM_ID` and
`MACOS_STORE_SIGNING_READY=true`. Only then enable the repository switch
`MACOS_STORE_SIGNING_ENABLED=true`.

The job imports both identities into one disposable hosted-runner keychain,
checks their kind/team, removes signing secrets from the child environment,
and cleans up the keychain. The profile is temporary. It signs only after a
valid shared source/version/run/build record is verified, and retains the PKG
and `package.json` artifact separately from the public direct-download ZIP.
Manual retry uses the existing Build apps workflow on an immutable release tag
with the `mac-store` input; it does not select an iOS rebuild unless requested
separately. Master/nightly requests are rejected before signing credentials are
used. A Mac job failure does not block GitHub publication or iOS delivery.

## Sandbox feasibility package

Build an isolated universal Release app with the production Bluetooth adapter,
shared runtime and embedded frontend:

```sh
export DEVELOPER_DIR=/Applications/Xcode-26.0.0.app/Contents/Developer
export FLOAT_VIEW_VERSION=vX.Y.Z-rc.N
export FLOAT_VIEW_BUILD_NUMBER=900001 # Local check only; never a store allocation.
just mac-store-sandbox-check .local/macos-store/new-sandbox-check
```

Use a real valid release/candidate version and a new output directory. This
command rebuilds the frontend and universal Rust/Swift Release executable. Its
ad-hoc-signed app is explicitly **not uploadable** and uses the separate
`fail.acheron.floatview.macos.sandbox-check` container, preserving existing app
data. The JSON record captures exact executable hash, source/dirty status,
architectures and packaging checks; it does not claim runtime acceptance.
`--arch native` is available directly through `mac-store.py` for local iteration;
it does not establish universal packaging.

The signature contains only these sandbox capabilities:

| Entitlement | Purpose |
| --- | --- |
| `com.apple.security.app-sandbox` | Required Mac App Store isolation |
| `com.apple.security.network.server` | Existing authenticated loopback listener |
| `com.apple.security.network.client` | Native WebView loopback traffic and online map tiles |
| `com.apple.security.device.bluetooth` | Native board connection |
| `com.apple.security.personal-information.location` | Optional route recording |
| `com.apple.security.files.user-selected.read-write` | User-selected import/export and Save panels |

No broad filesystem exception, app group, persisted security-scoped bookmark,
debugger entitlement or second service owner is introduced. Release builds ignore
development frontend/storage/port overrides and exclude browser/test-host modes.
Debug/conformance builds retain those controls. The Mac privacy manifest is packaged from
`backends/apple/macos/Resources/PrivacyInfo.xcprivacy`. Its collection declarations
match iOS, with an additional required-reason declaration for user-selected
files outside the container. See the [Mac privacy/map audit](macos-distribution-audit.md).

## App Review: local server entitlement

Include the following explanation in the Mac App Review Information notes before
submission. If automated review questions the server entitlement, reply with the
same explanation. Retain the existing hardware instructions and demonstration link.

> Float View requires `com.apple.security.network.server` for its embedded local
> HTTP/WebSocket server. On launch, the app starts this server bound exclusively
> to the IPv4 loopback address `127.0.0.1`. The app's embedded WKWebView loads the
> bundled user interface from that server and uses HTTP/WebSocket requests to
> communicate with the native backend for Bluetooth telemetry, settings and ride
> recording/import/export. The listener is not bound to LAN or public network
> interfaces. Backend API requests require the expected local origin and a
> randomly generated per-launch token. This is an internal component of the app;
> users do not need to enable a server feature or connect another device to it.
> The entitlement is required for normal operation, including opening the app
> and viewing Settings without connected board hardware. The outgoing client
> entitlement alone does not permit this listener.

The bind is implemented in `backends/core/loopback-server/src/server.rs`
(`Ipv4Addr::LOCALHOST`); the Mac host starts it and loads its origin in
`backends/apple/macos/lifecycle/MacAppDelegate.swift`. Apple documents the
[server entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.server)
as permitting incoming connections. Removing it requires an architectural change,
not just a packaging edit. An entitlement-justification request can be answered
with the existing binary; await Apple's response before deciding whether a new
build is necessary.

## Storage and channel switching

Direct-download data lives under `~/Library/Application Support/FloatView`.
Sandbox data lives under the app's
`~/Library/Containers/<bundle-id>/Data/Library/Application Support/FloatView`.
Foundation resolves the container automatically; do not redirect production
storage with launch arguments or copy files around to bypass sandbox boundaries.
Both routes preserve owned-storage baseline 100 and later supported data.

Use supported recording export/import to move between routes. This does not
promise automatic settings, Tunes, permission or private Bluetooth-association
transfer; review preferences and reconnect hardware in the destination app.
Keep the original installation/data until exports are verified. Close one app
before opening the other: both use the existing loopback port and cannot run
simultaneously on that port. Do not uninstall or delete supported data to force
a channel switch or downgrade.

Ad-hoc rebuilds may require fresh OS permission grants. They do not establish
permission continuity for Apple-signed or store-delivered packages.

## Verified scope and remaining work

Local universal sandboxed Release checks passed: signature/entitlement and
architecture inspection, packaged frontend/icon/privacy manifest, development
entry-point exclusion, native WebView, authenticated HTTP/WebSocket, settings
and baseline archive persistence across relaunch, baseline archive HTTP
import/export, native Save-panel export outside the container and staging-lease
cleanup. A connected ESP fixture passed scoped direct connection/recording and
unexpected-disconnect recovery with canonical RESET/READY cleanup. These are
physical Mac Bluetooth checks against simulated board firmware, not validation
on a rider board or of a store-delivered app. Detailed build hashes, fixture
inventory, timing and reports remain under ignored `.local/macos-store/`.

[Stable v1.0.0, build 108](https://github.com/acheronfail/float-view/actions/runs/39028413704),
source `fae18a46`, passed all CI jobs, stable GitHub publication and both protected
Apple uploads. Mac and iOS processing are independently confirmed `VALID`.
Independent Mac PKG inspection verified Apple signatures/profile/entitlements,
exact source/build, universal executable, readable installed-bundle permissions,
notices, privacy manifest and icon. Its packaged Settings page displays `v1.0.0`
in WebKit. Detailed receipts, hashes, screenshots and extracted evidence stay local.

The [Mac source/API and map audit](macos-distribution-audit.md) is implemented.
The owner confirmed the scoped Mac TestFlight checks passed for RC9 build 106;
that physical result is distinct from the software/package checks on build 108.
The owner completed six screenshots and listing fields. Read-only checks confirm
processed assets, Utilities, 4+, privacy/support URLs, review-contact presence,
manual release, corrected Mac feature wording and the saved Mac video link. The
video's recording is owner-reported; private links and review materials stay local.

The owner can now select build 108 for version 1.0.0 and submit App Review.
Pricing/availability require owner verification because the Developer API key
cannot read them. Store submission, approval and controlled public store release
remain separate from the completed stable GitHub release and Apple uploads.

## Shared protected Apple upload

Both Apple platforms use `apple-store-upload`, one Developer-role team API key,
and a `v*` tag-only deployment policy. Signing and enabled delivery proceed
automatically for stable and RC tags; both `apple-store-signing` and
`apple-store-upload` have no required reviewers.
Keep the former environment during migration until both paths are verified.

Configure `ASC_API_PRIVATE_KEY_BASE64` as its sole secret. Configure
`ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`, `APPLE_TEAM_ID`, `ASC_IOS_APP_ID` and
`ASC_MAC_APP_ID` as variables. Per-platform readiness remains independent:
`IOS_STORE_UPLOAD_READY` and `MACOS_STORE_UPLOAD_READY`. The delivery jobs receive
only their selected numeric app ID. Signing and sideload jobs do not receive the
API key. Keep its download and secure backup outside public artifacts.

For a new candidate containing the Mac audit and uploader changes, first request
an explicitly read-only check on its immutable tag:

```sh
gh workflow run build-apps.yml --ref vX.Y.Z-rc.N -f mac-delivery=check --repo acheronfail/float-view
```

This automatically selects a fresh Mac signed build and number. The check verifies
the exact signed PKG, embedded app and
profile, notices, privacy manifest, team, source/run/build and digest; it then
queries Apple's app record and consumed build number. It never uploads and can
run while Mac upload readiness and the repository upload switch are off.
RC7 predates these audit/record changes and must not be used to bypass validation.

After that check and owner acceptance, set the environment variable
`MACOS_STORE_UPLOAD_READY=true` and repository variable
`MACOS_STORE_UPLOAD_ENABLED=true`. An explicit `just release ...` stable or
candidate tag then automatically selects Mac signing and upload. A deliberate
store-only retry uses the actual immutable tag with `mac-delivery=upload`;
ordinary master/nightly builds never select this job. Neither flag is required
for the existing direct-download ZIP.

Delivery verifies the PKG again, uploads once using Apple's package transport,
and polls processing to `VALID`. It does not invite testers, submit review or
release the app. The receipt records the package digest, exact source/build/run,
transport outcome and Apple processing identity for 90 days. On uncertain
transport, inspect Apple and the receipt before retrying. A rerun never blindly
resends an absent number; an existing number is accepted only with a matching
prior accepted-transport receipt from that run and binary. Corrected, invalid or
uncertain absent builds need a fresh run and number. Preserve any receipts needed
beyond Actions retention. A Mac delivery failure does not block GitHub or iOS.

After Apple processing, install through TestFlight and scope physical acceptance
to Bluetooth/location permissions, a short recording, optional speech, native
import/export and supported direct/store transfer. Keep detailed results local;
public readiness notes need only the build/source outcome and coverage limits.
