# Android distribution signing

Keep the application ID `fail.acheron.floatview` and preserve the existing
official APK signing identity when enrolling in Play App Signing. Keep
nightly/stable APK downloads available independently of Google Play.

## Key roles

| Identity | Purpose | Custody |
| --- | --- | --- |
| App-signing key | Signs official sideload APKs and APKs delivered by Play | Retain our existing key and secure backup; enroll an encrypted copy with Google |
| Play upload key | Signs AAB files sent to Play; does not sign installed Play APKs | Separate private key with a secure backup and a protected store-signing environment |
| Local debug key | Local development only | Never enroll this identity with Play |

The existing alias `float-view-ci` is a dedicated signing identity, not the
standard Android debug key. A Debug build configuration and a debug signing
certificate are different things. Store artifacts must nevertheless use Release
configuration.

Do not replace existing APK-signing secrets with upload-key material. Google
verifies AAB uploads against the upload certificate, then signs delivered APKs
with the app-signing key. Choosing a Google-generated app-signing key would
prevent independently built official APKs from using that same private key.
See [Android signing guidance](https://developer.android.com/studio/publish/app-signing).

## Before enrollment

1. Inspect the existing keystore certificate: private-key entry, algorithm,
   validity, and SHA-256 certificate fingerprint. Compare it with an actual
   published APK using `apksigner verify --verbose --print-certs`.
2. Verify the backed-up private key can sign a disposable artifact. Verify the
   separate upload key too; do not mistake a signed test JAR for a valid AAB.
3. Back up both keystores and their passwords securely outside the checkout and
   computer. GitHub Actions secrets cannot be downloaded to recover a lost key.
4. Export both public certificates in PEM format. Keep operational fingerprints,
   key paths, passwords, raw audit output and enrollment files in ignored local
   storage; never commit private keys or encrypted private-key exports.

Use password prompts or password-file options when inspecting/exporting keys;
do not put literal passwords in shell commands, chat or logs. For example:

```sh
keytool -list -v -keystore <keystore-path>
keytool -exportcert -rfc -keystore <keystore-path> \
  -alias <key-alias> -file <public-certificate.pem>
apksigner verify --verbose --print-certs <published.apk>
```

## Play Console enrollment

After account verification and app creation:

1. Open the app's **App integrity / App signing** settings. Select the option
   to supply an existing app-signing key, rather than generate a new identity.
   Console labels can change; inspect the offered enrollment options first.
2. Follow Google's current PEPK instructions to export/encrypt the existing
   app-signing key using the Console-supplied encryption inputs. Download PEPK
   only from Google's enrollment flow. Keep the encrypted export local and
   upload it only for this app's Play App Signing enrollment.
3. Register the separate upload certificate when offered. If enrollment initially
   uses the app-signing certificate for uploads, complete the separate-upload-key
   registration before configuring CI to use it.
4. Compare the Console's app-signing and upload certificate SHA-256 fingerprints
   with the independently recorded local certificates. They must match their
   respective roles and differ from one another.
5. Retain a private enrollment record. Enrollment is not established by creating
   keys locally. Do not request a signing-key upgrade or rotate keys as part of
   initial setup without considering sideload compatibility.

See [Google's Play App Signing procedure](https://support.google.com/googleplay/android-developer/answer/9842756).

## Store delivery and installation checks

The protected AAB build/signing path is described below. Final package/source audit and automated internal-track delivery remain open; hosted
CI signing and downloaded-artifact verification have passed for the candidate
recorded below. Local checks
do not establish store delivery or device acceptance. Store credentials must not
be required for local source builds or ordinary APK publication.

After enrollment, verify Play-delivered APKs carry the expected app-signing
certificate. Test sideload-to-Play and Play-to-sideload replacement on a device
using increasing version codes, checking that supported settings and recordings
remain available without uninstalling. Equal signatures alone do not establish
successful replacement: version, package/split and OS update policies also apply.
Nightlies can have higher version codes than the store version; wait for a newer
compatible build rather than forcing a downgrade or deleting supported data.
Community builds signed with another key cannot ordinarily replace official
installations. Export recordings before any intentional uninstall.

## Verified scope

The [RC6 APK](https://github.com/acheronfail/float-view/releases/tag/v1.0.0-rc.6)
passes APK signature verification and matches the retained official app-signing
certificate. Both retained app-key and separate upload-key signing checks pass.
The owner subsequently reported successful Play enrollment and supplied the
matching app-signing SHA-256 fingerprint. Local Release AAB structure,
upload-key signing/strict signature verification, package/version/target SDK,
non-debuggable manifest, four-ABI inventory and 64-bit 16 KB LOAD alignment
checks pass; the bundle requests 16 KB APK alignment. This local unversioned
package is not for upload. Play-delivered route-switch checks remain open. The owner confirmed separate backups of both the original
app-signing key/password and the new upload key/password. Detailed records are
local.

## Protected Play bundle signing

The `android-store` job in `Build apps` produces an independently retained AAB;
its success does not gate the existing GitHub APK publication. It does not upload
to Google, invite testers or start a rollout. Stable/candidate tag pushes select
it only when repository variable `ANDROID_STORE_SIGNING_ENABLED=true`.
Ordinary master/nightly runs skip it. A deliberate manual retry must select an
existing stable/candidate tag and set the `android-store` input; a fresh run
receives a fresh shared CI number without replacing published GitHub downloads.

Configure environment `android-store-signing` with tag-only `v*` deployment
rules and no required reviewers. Stable and RC signing builds proceed
automatically. Keep these environment settings:

| Setting | Purpose |
| --- | --- |
| Secret `ANDROID_UPLOAD_KEYSTORE_BASE64` | Separate Play upload keystore, alias `float-view-play-upload` |
| Secret `ANDROID_UPLOAD_PASSWORD` | Upload keystore/key password |
| Variable `ANDROID_UPLOAD_CERT_SHA256` | SHA-256 of the upload certificate registered with Play, lowercase hex without colons |
| Variable `ANDROID_STORE_SIGNING_READY` | `true` only after custody/enrollment and secret setup |

The job uses Release configuration and the same `FLOAT_VIEW_VERSION` and
CI-derived `FLOAT_VIEW_BUILD_NUMBER` as other packages. It signs with `jarsigner`,
strictly verifies the signature against the selected keystore, and checks the
signer's fingerprint against the enrolled upload certificate. The pinned,
checksum-verified Google bundletool validates structure, package/version,
non-debuggable manifest and target SDK. The package audit checks the closed
four-ABI native library inventory, 16 KB LOAD alignment on the 64-bit libraries,
and the bundle's `PAGE_ALIGNMENT_16K` setting for generated APKs. These packaging
checks do not establish operation on a 16 KB device.

Download `FloatView-android-store-<build>-attempt-<attempt>` from the matching run.
Retain its AAB and `package.json` together. Verify its source, version, build,
hash and upload certificate before manually uploading it to **Testing → Internal
testing → Create new release**. Never upload a local unversioned check bundle.
An upload-key-signed AAB is not an installable APK; Play signs generated APKs
with the enrolled app-signing key. Verify that delivered certificate separately.

New personal accounts must complete a closed test with at least 12 testers
continuously opted in for 14 days before applying for production access.
Internal testing does not satisfy that requirement. Complete listing, Data
safety and actual permission/foreground-service declarations before closed-test
review. See [Google's account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465).

[Candidate v1.1.0-rc.3, build 120](https://github.com/acheronfail/float-view/actions/runs/39218240672),
source `fae159af`, passed protected Android signing and GitHub candidate
publication. Independent downloaded-AAB checks passed: strict JAR signature,
registered upload certificate, artifact hash/source/build identity, bundletool
structure, Release manifest/package/version/target SDK, packaged licence/artwork/map
notice presence and native/bundle 16 KB alignment. The Apple signing jobs executed
no steps and their upload jobs were skipped. The aggregate run therefore shows
failure despite Android signing and GitHub publication succeeding. This does not
establish a complete Android source/permission audit, Google upload or physical
Play-delivered acceptance. Detailed receipts and the internal-test handoff stay local.

The [Android privacy/Play worksheet](android-distribution-audit.md) inventories
current data flows, location and foreground-service declarations, audience
selection and remaining closed-test gates. Its native disclosure/map-request
changes require a new build; they are not present in build 120.

## Android system backup

Android Auto Backup and device-to-device transfer are enabled for the complete
`files/float-view/logs/` product store (the historical directory name also holds
settings and ride databases). Include its marker, catalog, session databases and
SQLite WAL sidecars together. Android stops the process for full backup;
`backupInForeground=false` avoids requesting interruption of active foreground
use. Restored stores use the normal supported-baseline checks/recovery. Do not
allow restoration from arbitrary newer app versions or reset unsupported data.

The XML excludes disposable Exports, derived schema caches and coordination-lock
files. Diagnostics live outside the included root. Permission-history preferences
and WebView state are not selected; OS permissions must be re-established on the
destination device. Modern cloud backup requires encryption capability, while
legacy rules accept client-side encryption or device transfer.

Android's 25 MB cloud quota can skip a large store entirely; it does not promise
a partial selection of the newest rides. Device-transfer availability and limits
depend on the provider/device. Session exports remain the independent backup
route. XML selection and Release packaging checks do not establish a real
provider restore or manufacturer transfer; retain that coverage limit. See
[Android Auto Backup](https://developer.android.com/identity/data/autobackup).

## Protected Google Play delivery

`android-store-upload` consumes the signed AAB and `package.json` from the same
workflow run. Signing and enabled internal-test delivery proceed automatically
for stable and RC tags. The separate `google-play-upload` environment holds only
upload authentication. Both environments have tag-only `v*` deployment rules
and no required reviewers. The owner has installed the environment secret.
Service-account authentication
and access to the existing bundle/internal track passed a local API inspection;
both delivery readiness switches are enabled. Hosted delivery passed for the
candidate recorded below.

Create a dedicated Google Cloud project, enable the Google Play Android Developer
API, and create a service account. It needs no general Google Cloud project role
for this flow. In Play Console, invite its email with access to Float View only,
**View app information (read-only)** and **Release apps to testing tracks**.
Do not grant production-release, financial or account-wide permissions. Store a
JSON private key in ignored local storage and back it up securely; install it as
an environment secret without printing it. See [Google's setup instructions](https://developers.google.com/android-publisher/getting_started).

Configure `google-play-upload`:

| Setting | Purpose |
| --- | --- |
| Secret `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Dedicated service-account JSON key; raw JSON, not base64 |
| Variable `ANDROID_UPLOAD_CERT_SHA256` | Same enrolled upload-certificate fingerprint as the signing environment |
| Variable `GOOGLE_PLAY_UPLOAD_READY` | `true` only after credential/access setup |

Repository variable `GOOGLE_PLAY_UPLOAD_ENABLED=true` selects delivery. Stable/RC
tag pushes request internal upload automatically when enabled. Master/nightly
builds cannot select it. For a fresh manual run on an existing stable/RC tag,
`android-store=true` builds/signs only; `android-delivery=check` builds/signs and
checks Google without uploading or changing track assignments;
`android-delivery=upload` builds/signs and delivers to internal testing. These
inputs do not select Apple jobs. A fresh manual run receives a new shared build
number, while rerunning failed jobs preserves the original number.

The uploader checks the exact tag/source/run/build identity, AAB hash, registered
upload certificate and strict JAR signature before authentication. It uses the
Google OAuth service-account flow with Python's standard library and OpenSSL;
there is no new application or publishing-library dependency. Only Float View's
**internal** track is writable. Its completed release serves existing internal
testers; it does not add testers, promote to closed/production tracks or edit
listing/pricing/policy declarations. Closed-test promotion remains an owner
Console action. GitHub downloads and Apple jobs remain independent.

Uploads are serialized. The script compares Google's version-code/SHA-256 record
before sending bytes; a matching completed internal release is already delivered.
A newer internal build or conflicting hash stops the job. Receipts record source,
run, version code, hash, edit ID and stage, never credentials. An interrupted
attempt inspects its saved edit before creating another, because creating a new
edit invalidates the previous edit for that account. Reruns may upload when every
earlier attempt has a matching receipt explicitly confirming that uploading never
started. The receipt marks upload uncertainty before sending bytes and carries
it through later failures and check-only attempts. Missing or older receipts do
not establish that an upload is safe. If an earlier upload may have started and
the edit expired or the upload cannot be established, stop and inspect Google;
use a fresh workflow run for a corrected or unobservable consumed build. Do not
blindly retry upload POSTs.

The commit requests `ERROR_IF_IN_REVIEW`, without falling back to cancelling an
existing review or changing submission flags. Google may reject incomplete policy
or draft-app states; resolve those in Console before retrying. Avoid editing the
app in Play Console while CI delivery is running: Console changes invalidate API
edits. See Google's [edit lifecycle](https://developers.google.com/android-publisher/edits)
and [commit behavior](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit).

Download `FloatView-android-upload-<build>-attempt-<attempt>` for the receipt.
`delivered` confirms the matching bundle and completed internal track in a fresh
Google edit; storefront/device propagation can still take time. Software tests
cover signatures, credentials, routing, conflicts and interrupted attempts.
[Candidate v1.1.0-rc.5, build 127](https://github.com/acheronfail/float-view/actions/runs/39261200590),
source `fae1f22a`, passed protected Android signing and automated internal-track
delivery. An independent Google API inspection matched the bundle SHA-256 with
the CI receipt and confirmed the completed internal release. Detailed receipts
stay local. This establishes CI delivery, not installation or physical acceptance
of build 127, closed-test completion or production access.
