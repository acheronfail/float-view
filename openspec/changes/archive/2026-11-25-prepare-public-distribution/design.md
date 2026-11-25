# Design

## Context

See proposal.md for scope. Audit performed on 2026-10-16 against the local checkout; this is planning evidence, not a complete security, licensing or runtime certification. Store publishing must retain open-source sideload distribution. Keep publisher identity and enrollment records outside the repository.

### Repository audit

| Finding | Evidence | Planned treatment |
| --- | --- | --- |
| Conflicting release boundary | `README.md` promises disposable formats until v1.0; `AGENTS.md` and `openspec/config.yaml` say first release/no users, while local tags already include v0.3.0 | Name the first supported public-data baseline explicitly; do not infer it from the existence of a GitHub tag or the major version |
| Destructive version mismatch is real code | `backends/core/product-store/src/root.rs::prepare_root` deletes owned entries when the marker is absent or different | Replace unconditional deletion before external beta; unknown/newer/malformed/missing-on-nonempty markers preserve files and fail actionably |
| Archive/storage documentation drift | `backends/core/README.md` says marker 12; `backends/README.md` says storage 15/archive 3; code was storage 24/archive 4 at initial inspection, with concurrent work subsequently moving storage to 25 | Remove duplicated hardcoded numbers where unnecessary; inventory all actual development markers before the baseline-100 reset |
| Current policy repeated in active specs | `backend-contract`, `platform-hosts`, `shared-rust-backend-service`, `session-location-recording`, `refloat-telemetry-pipeline`; SQL docs/comments and contributor guide | Reconcile active disposable-test wording when adopting the public baseline; preserve historical archived evidence and development fixture semantics |
| No tracked project licence found | Tracked non-vendor files contain no LICENSE/COPYING/NOTICE | Owner selected AGPL-3.0-or-later with acheronfail attribution; add licence, required notices and bundled acknowledgements after rights audit |
| Android backup templates | `backup_rules.xml`, `data_extraction_rules.xml` still contain sample comments/TODO; manifest says `allowBackup=false` | Define cloud/device-transfer policy explicitly, encode it and verify actual OS behavior; do not assume allowBackup controls every manufacturer's transfer path |
| Release Mac accepts development options | `macos/lifecycle/FloatViewMac.swift` accepts HTML override, `--browser-host`, `--test-host`; `MacBackendRuntime.swift` accepts root/port overrides without a Release guard | Move these behind explicit development/conformance build conditions; retain the contributor browser-host workflow |
| Apple startup force-unwraps fallible work | iOS `AppBackend.swift` and Mac runtime use `try!` for storage/service startup | Provide a useful startup/recovery presentation preserving files, especially for unsupported storage and sandbox failures |
| Store packaging missing | Existing workflow builds AltStore IPA, signed APK, self-signed Mac ZIP; no store upload jobs | Add store jobs without replacing the existing download artifacts |
| Build numbering tied to workflow name | `.github/scripts/prepare.ts` uses workflow run number + 60 and warns against renaming | Centralize a monotonic allocator across store retries and sideload jobs before splitting workflows |
| Missing privacy manifests | No tracked `PrivacyInfo.xcprivacy` found; Swift uses `ProcessInfo.systemUptime` | Audit all shipped Swift/Rust/native dependencies for required-reason APIs and bundle justified manifests |
| Network/privacy scope includes maps | `SessionLocationMap.svelte` fetches OpenStreetMap tiles | Document tile-provider requests, location implications, attribution, terms and provider usage policy; audit the complete shipped network surface |
| Native identity metadata needs reconciliation | Xcode contains different development team IDs at project/target levels; Mac lacks store category/copyright; current app/extension IDs exist | Configure the publishing team consistently, confirm identifier availability, and complete platform metadata |

These are identified issues, not a claim that every development tool is a release defect. Disposable WebViews, bounded temporary files, fixture-only reset data, intentionally supported firmware families, internal npm package versions and archived migration acceptance evidence remain valid. Do not mechanically remove every occurrence of “disposable”, “legacy”, “debug” or “prerelease”.

## Goals / Non-Goals

Preserve one product implementation, both installation routes and independent publication. Protect externally distributed user data before launch. No general migration engine, firmware change, product account system or updater is needed. No runtime dependency is proposed; use existing Xcode, Gradle, Rust, Node and GitHub tooling first.

## Decisions

### 1. Keep downloads and store submission separate

Retain current stable/nightly GitHub lifecycle and asset names. Add explicitly invoked, protected store package/upload jobs tied to exact source/version metadata. A store failure does not prevent sideload publication. All three sideload builds still succeed before GitHub publication, as today. Select the upload track explicitly and keep public release/manual approval separate from build success.

Store jobs run only for stable `vX.Y.Z` or numbered `vX.Y.Z-rc.N` releases
created by `just release ...`. Their tag push selects signing/delivery; master
commits, manual master runs and nightlies cannot select store jobs. A manual
retry/check must target an existing stable or candidate release tag and receives a fresh run
number without replacing already published GitHub assets. Corrected source needs
a new release tag; existing tags stay immutable. Both protected environments allow
version tags without required reviewers; signing and enabled delivery proceed
automatically for stable and RC tags. Upload readiness remains a separate gate.
Candidate tags allow TestFlight processing/device acceptance before the stable
tag. Complete repository and applicable TestFlight checks before creating it;
production store review/release remains a separate owner action.

Tie each native build number to the GitHub Actions run that builds it. Keep the existing Build apps workflow as the sole counter owner and preserve `run_number + 60` across sideload and optional protected store jobs. Record run ID, attempt, URL and source revision, reject allocation from another workflow path, and treat a workflow-path migration as an explicit continuity change. Display-name changes are harmless. Reruns keep their number; a corrected/Apple-consumed binary needs a fresh workflow run. Upload retries must query Apple before resubmitting. Do not introduce a second workflow counter or reset native numbers during version/tag cleanup.

The owner explicitly approved removing every existing pre-v1 release (including GitHub “stable” v0.x releases), associated assets, and matching local/remote version tags. This is a one-time exception to immutable release retention; retain commit history and all later releases. Before deletion, enumerate exact release IDs/tags and record the cleanup manifest; pause publication and drain running jobs to avoid recreation races. Remove matching tags even when a GitHub release has already gone, then verify local and remote state. Resume the rolling nightly channel with fresh preparation builds; this exception does not permanently disable prereleases or nightlies.

Reserve v1.0.0 without pushing its tag. Before the first stable v1.0.0 tag, explicitly target v1.0.0-nightly.<count>.g<hash> so deletion of v0.x ancestors does not fall back to v0.0.1 nightlies. After acceptance/tagging, resume normal next-patch nightlies (v1.0.1-nightly.…). Keep commit-derived identity and numeric build allocation monotonic through the cleanup. Use `just release candidate` to create immutable numbered prereleases such as v1.0.0-rc.1, select protected Release store jobs and keep all sideload artifacts on the same CI number. Candidate releases never replace Latest or the rolling Nightly. Apple marketing versions strip the rc suffix; source records retain the full candidate tag. The stable tag waits for candidate acceptance, including TestFlight-delivered checks; production store review/release stays explicit.

### 2. Preserve signing continuity where possible

Android: keep the existing application ID and audit the current CI signing certificate's suitability and custody without exposing keys. Prefer enrolling that existing app-signing key with Play and using a separate upload key, allowing official APK and Play installs to replace one another where package/version policy permits. If the key cannot be used, document the resulting identity transition before enrollment. Google-generated signing plus downloaded Play APKs is an alternative but makes independently generated matching APKs dependent on Google's key. Do not casually rotate the existing key. Community self-builds signed by other people cannot replace official installations automatically.

iOS: retain the unsigned AltStore IPA and add Apple-signed store archives, provisioning app and Live Activity extension consistently. AltStore re-signing may change team/application identity and private storage; make no seamless-switching promise. Document archive export/import and which profiles/settings are outside that transfer. Do not hardcode a promise about AltStore refresh limits without checking current guidance.

macOS: retain the universal ZIP and improve official direct downloads with Developer ID signing, hardened runtime, notarization and stapling. Add the sandboxed store package with appropriate distribution identity. First prove the minimal Bluetooth/network-client/network-server/user-selected-file entitlements required by the actual app. Test WKWebView loopback, location, speech, import/export and file leases. Keep native scoped access in the host and data policy in Rust. Explicitly test old direct-data locations versus sandbox containers and permission/signing transitions. Prefer the same bundle identity where provisioning allows; never run two owners over the same storage. Archive import/export is the baseline supported manual transfer, not an unproven complete-settings migration.

### 3. Freeze a public data baseline before external beta

Pre-v1 storage is designated disposable development data. Set the owned-storage marker to 100 and automatically reinitialize recognised earlier owned development state on the first new-candidate launch. Discard old settings, boards, tunes, caches, sessions and recordings without migration. This is an on-device upgrade behavior, not a request to delete arbitrary databases on the development computer. Preserve exported files, committed fixtures and vendor data. Validate paths/layout/known historical markers, and make the reset restartable and bounded. Missing/corrupt markers or unknown layouts still preserve data and fail actionably. Include any disposable native/web preference hints in the reset inventory, but retain accurate OS permission/denial history and do not try to reset OS grants.

Apply the reset once based on persisted storage identity, not on app launch or marketing version. Baseline 100 must preserve new records on every subsequent launch, including on the owner's devices. From that boundary onward, incompatible storage changes increment 101, 102, etc., with explicitly tested upgrade behavior for published supported data. Keep archive format numbering independent (currently 4); do not renumber SQLite PRAGMA user_version or archive metadata merely to mirror 100. Replace policy in agent/config/contributor docs and reconcile active spec references.

After the boundary, current and published supported data must open or use an explicitly designed, crash-safe tested upgrade. Unknown/newer storage must remain untouched, including when a stable app follows a nightly. Reject unknown archives without changing owned data. Keep baseline storage/archive fixtures for future regressions. Do not add a migration framework until there is an actual published-to-new-schema transition. Freeze the candidate's baseline contents before external testing; further incompatible post-baseline changes need a new marker and a supported upgrade, rather than another unconditional wipe of 100.

Resolve startup failure presentation locally first; if actionable public state/errors require changing the frontend contract, update contract/client/mock/both hosts/conformance as one slice. Avoid building a second portable persistence owner in Swift/Kotlin.

### 4. Treat privacy, provenance and review as release inputs

Owner selected AGPL-3.0-or-later and Copyright © 2025 acheronfail for project-owned work. Preserve earlier/third-party notices and accurate dates; Git author metadata alone is not proof of ownership. Add the full licence, appropriate source/package notices and exact corresponding-source access for each distributed binary, including build inputs and scripts required by the licence. Do not imply that branding or every dependency is relicensed. Verify Apple distribution rights against current terms; any additional permission/separate distribution grant for owner-controlled code requires an explicit owner decision and cannot cover third-party rights. Do not silently add a store exception or change the chosen licence.

Owner still supplies contact details, price and countries. Vendor source used as research is not automatically shipped; inventory actual redistribution rather than assume either that every vendor licence applies or none does. Resolve obligations or seek suitable rights/replacements before store packaging; no final legal compatibility conclusion is asserted by this plan.

The iOS package/source audit is recorded in docs/ios-package-source-audit.md.
Include pinned Rust standard-library/compiler-builtins/math notices in addition
to Cargo's dependency graph. Check actual bundled frontend runtime packages and
complete packaged legal texts. Settings links to a dedicated offline scrollable
licences route with a Settings return path rather than expanding in place.

Audit local data, backups/transfers, logs, exports, tile requests, speech dependencies and any analytics/crash reporting actually present. Write accurate public privacy/support pages and in-app links, then complete App Privacy/Data safety. Evaluate whether Android needs ACCESS_BACKGROUND_LOCATION for intended user-started rides; remove it only if behavior and policy allow, otherwise implement required disclosure/declaration/video. Justify every foreground service type and iOS background mode against actual behavior.

Use real supported hardware for reviewer pairing/interaction video and precise firmware instructions. Start with video and available offline/history surfaces; add a clearly labelled demo mode only if reviewability requires it, as a separately scoped product change, never ship hidden conformance controls as a demo.

### 5. README installation and project support

Organize the README installation section by iOS, Android and macOS, showing the verified store listing for each platform alongside its non-store route: AltStore IPA, signed APK and direct universal Mac download. Retain source-build/contributor links and nightly/update/switching guidance. Add each actual store URL only once the listing is available; stores can launch independently. Do not invent app IDs or replace useful installation instructions with store-only badges.

State plainly that Float View is open source under AGPL-3.0-or-later, linking to the repository and licence. Suggested copy: “Float View is open source. Buying the app through an app store supports ongoing development and helps cover developer memberships and distribution fees. You can also install through the alternative routes below or build it yourself.” Exact prices remain to be chosen. Describe purchases as support for development and distribution, without promising that the full purchase price reaches the developer or implying that a purchase is required to access the source.

### 6. Verify actual channel artifacts

Use focused automated checks for each changed surface and consumer. Add Release negative checks for development options, manifest/entitlement/signature checks, bundle page-size checks, storage preservation tests and store upload retry/version tests. Validate delivered TestFlight/Play artifacts on devices for affected BLE/background/permission/audio behavior. Check clean Mac download and sandbox behavior. Historical full-matrix migration gates do not become recurring release gates.

Keep reusable procedures, open requirements and brief build-linked scope/results
in public readiness documents. Keep detailed testing chronology, device/OS/firmware
inventories, raw artifacts, tester reports and account/approval history in ignored
local records under `.local/ios-store/readiness/`, with a private backup where
needed. Do not publish routes, private identifiers or contact details. A short
public result retains material limitations and actionable sanitized failures;
local storage of detail does not weaken acceptance gates or claim unrun checks.
Existing Git history is preserved.

## Risks / Trade-offs

- Mac sandbox may expose architecture or file-access issues → prove it before most store automation work; retain direct download throughout.
- Historical downloads are intentionally removed by owner request → save the exact cleanup manifest, preserve commits, pause/drain publication during cleanup and verify the rolling nightly resumes correctly.
- Same-ID Android nightlies can outrank store versions → use monotonic identifiers and document when a newer store build is needed; never delete newer data to force a downgrade.
- Account-specific Google production access can delay launch → recruit the required closed-test group early; verify account-specific requirements in Console.
- New Apple signer or sandbox container may change permissions/data access → perform scoped physical upgrade checks and document export/import before uninstalling.
- Store review and terms can change → recheck official requirements at implementation and submission; account state is not established by repository inspection.

## Migration Plan

1. Commit the reviewed planning artifacts before implementation under the existing repository workflow.
2. Apply selected licence after provenance review; reconcile docs and production guards; prove Mac sandbox feasibility in a focused slice.
3. Implement baseline-100 reset/preservation/startup behavior before external betas. Keep v1.0.0 preparation nightlies and explicit numbered TestFlight candidates; perform the pre-v1 cleanup only after candidate acceptance. Do not tag v1.0.0 until candidate acceptance.
4. Produce store packages alongside existing sideload assets; provision credentials and upload to test tracks.
5. Complete declarations, review evidence and affected device tests; submit each store independently, then publish links only when live.
6. Roll back code with a new higher build identifier only when it can read the published storage; otherwise halt rollout and ship a forward fix. Never recommend uninstall as a data-preserving rollback.

## Owner Inputs Before Publication

Apple and Google enrollment/status; public contact/support/privacy hosting; pricing and initial territories; any additional Apple distribution permission required after rights review. Licence choice and copyright attribution are resolved. These inputs block their individual external actions, not the repository audit or packaging work.

## Current Official References

Recheck at implementation/submission; verified during planning on 2026-10-16.

- [Apple individual developer name](https://developer.apple.com/help/app-store-connect/create-an-app-record/set-your-developer-name/)
- [Apple enrollment](https://developer.apple.com/programs/enroll/)
- [Apple distribution and sandbox](https://developer.apple.com/documentation/xcode/preparing-your-app-for-distribution)
- [Apple privacy manifests](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)
- [Apple required-hardware review video](https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review)
- [Play signing across distribution routes](https://support.google.com/googleplay/android-developer/answer/9842756)
- [Personal Google account testing](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Google background location](https://support.google.com/googleplay/android-developer/answer/9799150)
- [Android native page sizes](https://developer.android.com/guide/practices/page-sizes)

## Dependency and Asset Licence Audit — 2026-10-16

### Scope and result

Licence/provenance audit of the checked-in lockfiles, cached exact-version package sources, resolved Android Release classpath, a fresh frontend build and source-map dependency inventory, native manifests and vendor/asset references. This is not a vulnerability audit or final legal clearance. No incompatible library licence was identified in the inspected graphs. Distribution is not yet complete: notices, corresponding-source delivery, asset licence evidence and Apple-specific rights still need the actions below. No dependency replacement is presently indicated by this inventory. Concurrent application changes appeared during inspection; these were not modified by this planning work. Recheck the final release revision and package contents before submission.

### Rust and bundled C

Resolved `cargo metadata --locked --offline --format-version 1 --filter-platform <target>` for aarch64 iOS, arm64/x86_64 macOS and all four shipped Android ABIs. Traversed from the selected Apple FFI or Android JNI crate through non-dev edges, including normal/build/proc-macro dependencies. Workspace feature unification and build tools make this a conservative dependency inventory, not a claim that every listed package contributes executable bytes. The unrestricted all-platform metadata request could not resolve an uncached WASI package offline; every supported native target graph succeeded.

The union contains 98 external package/version pairs: 95 in the inspected Apple graphs, 96 for armv7 Android, and 98 for each other inspected Android ABI. All have a licence expression in their exact local Cargo manifests.

| Declared expression | Package/version pairs |
| --- | ---: |
| MIT OR Apache-2.0 (either ordering, including historical slash notation) | 68 |
| MIT | 22 |
| Apache-2.0 | 1 |
| MIT AND BSD-3-Clause | 1 |
| Zlib | 1 |
| MIT OR Zlib OR Apache-2.0 | 1 |
| (MIT OR Apache-2.0) AND Unicode-3.0 | 1 |
| BSD-2-Clause OR Apache-2.0 OR MIT | 1 |
| Unlicense OR MIT | 1 |
| 0BSD OR MIT OR Apache-2.0 | 1 |

Notable obligations that a simple SPDX allowlist would miss:

- `matchit 0.8.4` requires both MIT and its httprouter BSD notice (`LICENSE.httprouter`).
- `unicode-ident 1.0.24` has an additional Unicode-3.0 notice, even when choosing MIT for the other licence branch.
- `atomic-waker 1.1.2` includes `LICENSE-THIRD-PARTY`; retain this rather than selecting MIT and discarding embedded third-party notices.
- `libsqlite3-sys 0.35.0` is MIT for its wrapper and bundles SQLite 3.50.2, whose amalgamation has its own public-domain dedication/blessing. Do not label SQLite itself MIT merely from the wrapper's metadata.
- `jni-sys-macros 0.4.1` declares MIT OR Apache-2.0 but has no top-level LICENSE file in its cached package. Obtain the exact upstream notice/text needed for source delivery rather than silently omitting it; it is a procedural macro/build concern, not evidence of a different runtime licence.

Representative runtime versions include axum 0.8.9, hyper 1.11.0, tokio 1.53.1, rusqlite 0.37.0, serde 1.0.229, serde_json 1.0.151, quick-xml 0.39.4 and miniz_oxide 0.8.9. No GPL/AGPL/LGPL dependency was declared in these external Rust graphs. First-party workspace crates currently lack project licence metadata; set that consistently with the selected AGPL licence during implementation.

### Frontend runtime, generated assets and tools

A successful fresh production build with source maps identified these client JavaScript package sources (maps are audit output, not an instruction to ship source maps):

| Component | Version | Licence |
| --- | --- | --- |
| Svelte | 5.38.6 | MIT |
| SvelteKit | 2.36.3 | MIT |
| clsx | 2.1.1 | MIT |
| devalue | 5.3.2 | MIT |
| esm-env | 1.2.2 | MIT |
| Leaflet | 1.9.4 | BSD-2-Clause |

The frontend lockfile has 482 dependency entries with licence declarations; no missing declarations were found. The 11 MPL-2.0 entries are Lightning CSS and platform binaries, and Python-2.0 is argparse; these are marked development tooling and did not appear in the inspected client source maps. Audit generated output as well as metadata: a development dependency can still supply shipped content.

That is the case for `@iconify-json/lucide 1.2.121`: the build converts selected icon geometry into CSS. Its metadata says ISC, while upstream's full licence also preserves MIT credit for Feather-derived icons. Ship the appropriate Lucide and Cole Bemis/Feather notices, pinned to the source used for this version rather than blindly copying a future main-branch licence. Leaflet's notices name Volodymyr Agafonkin and CloudMade and require reproduction for binary redistribution. No downloaded/custom font files or font-loading declarations were found in the inspected tracked frontend/icon paths; system fonts remain OS-provided.

### Android and Apple hosts

Resolved `:app:dependencies --configuration releaseRuntimeClasspath` offline using the installed JDK 21; inspected exact cached POMs. The graph has 19 selected Maven coordinates, including metadata/BOM entries. Eighteen declare Apache 2.0 directly; `com.google.guava:listenablefuture:1.0` inherits Apache 2.0 from cached `guava-parent:26.0-android` (it has no direct licence block). This illustrates why missing POM fields cannot be treated as licence-free software.

Selected coordinates:

- AndroidX annotation 1.6.0 / annotation-jvm 1.6.0 / annotation-experimental 1.3.0;
- AndroidX arch.core core-common/core-runtime 2.1.0, collection 1.0.0, concurrent-futures 1.0.0;
- AndroidX core/core-ktx 1.10.1, interpolator 1.0.0, lifecycle-common/lifecycle-runtime 2.3.1, versionedparcelable 1.1.1;
- Guava listenablefuture 1.0; JetBrains annotations 23.0.0; Kotlin stdlib 2.0.21;
- kotlinx-coroutines core/core-jvm/BOM 1.9.0.

Cached binary archives alone did not provide a complete bundled acknowledgement surface. Collect upstream copyright/NOTICE material and verify the final packaged app, not just the classpath report. Gradle plugins, JUnit and instrumentation runners are build/test scope rather than this Release runtime classpath. Apple Package.swift declares no external Swift packages; Apple frameworks and platform runtimes remain subject to their own SDK/distribution terms, not the project's AGPL notice.

### Artwork and upstream source

The rider artwork originates from [“onewheel” by Luis Prado, Noun Project image 4260841](https://thenounproject.com/icon/onewheel-4260841/). This explains its presence in both the older Float View repository and generated native/loading/map assets; do not attribute the underlying artwork solely to acheronfail. Noun Project's general terms offer free CC BY 3.0 with attribution and paid royalty-free use waiving attribution. The marketing label alone is not evidence of a paid licence or public-domain status.

Use the attribution route unless a paid download/licence is documented. Verify/retain the asset-specific download licence, include the creator/title/source/licence link and describe modifications (colour/background/silhouette/format adaptations). Add repository artwork provenance and bundled acknowledgements, including credit accessible in the app. Keep the artwork under its own terms; do not blanket-relicense it as AGPL. CC BY permits commercial reuse with its conditions, so purchase is not inherently required merely because the application is distributed commercially. Full attribution/terms and the app-store delivery of that asset still need checking before claiming complete compliance.

Commit author metadata alone does not establish copyright ownership. Trace third-party artwork and implementation provenance independently.

The vendor submodules are not Cargo/Swift/Gradle runtime dependencies. Refloat's GPL-covered schema fixture bytes are included in Rust test modules behind `cfg(test)` and used by conformance; `backends/fixtures/refloat-configuration/README.md` explicitly excludes those fixture files from native packages. Preserve their source/provenance/licence obligations in repository/source distribution. Audit actual source-derived/copied implementation material independently; protocol research and absence of a package-manager dependency do not by themselves settle copyright provenance.

### Remaining release actions

1. Add project licence and accurate attribution, exact-version third-party notice collection, bundled acknowledgement access and matching corresponding-source/build inputs for each published binary.
2. Retain the rider's asset-specific licence evidence and credits, including modified/generated variants; retain Lucide/Feather, Leaflet, Rust embedded notices and Android notices.
3. Resolve Apple delivery terms against AGPL-covered rights before upload. Do not claim “AGPL is automatically approved by the App Store” or silently add an exception. Owner-controlled permissions cannot waive obligations on upstream code/assets.
4. Verify final IPA/APK/AAB/Mac package contents and source delivery after implementation. This turn inspected source/metadata/frontend output, not final store archives.

Primary licence references:

- [Lucide/Feather upstream licence](https://github.com/lucide-icons/lucide/blob/main/LICENSE)
- [Noun Project licence options](https://help.thenounproject.com/hc/en-us/articles/200509798-What-licenses-do-you-offer-for-icons)
- [Noun Project credit format](https://help.thenounproject.com/hc/en-us/articles/200509928-How-do-I-give-creators-credit-in-my-work)
- [Noun Project terms, icon licences](https://thenounproject.com/legal/)
- [CC BY 3.0 conditions](https://creativecommons.org/licenses/by/3.0/)
- [Apple Developer Program agreement, including FOSS clause 3.3.1(v)](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)
- [Mozilla MPL compatibility guidance](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)

### Google Play CI internal delivery

Android signing and enabled internal upload proceed automatically for stable
and RC tags without required environment reviewers. `google-play-upload` is a
separate tag-restricted credential environment without required reviewers. Explicit repository/environment
readiness switches are enabled after owner credential installation and a passing
local authentication/app-access inspection. The account is
limited to this app and testing releases; closed/production promotion stays
manual. Tag pushes select delivery; a tagged manual run can choose build-only,
check or upload independently from Apple. Exact signed-artifact/run verification,
remote version-code/hash checks, serialized edit transactions and retained edit
receipts guard retries. Inspect an interrupted edit before opening another;
Google permits only one edit per account/app. Existing review must fail rather
than be cancelled automatically. No new application runtime dependency is needed.
