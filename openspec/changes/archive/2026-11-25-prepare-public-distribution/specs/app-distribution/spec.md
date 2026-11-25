# Spec Delta

## MODIFIED Requirements

### Requirement: Nightlies identify development commits

Master pushes and manual master runs SHALL resolve commit-identified rolling nightly prereleases without marking them latest. Before the first stable v1.0.0 tag, nightlies SHALL target v1.0.0; afterward they SHALL use the next patch after the greatest stable ancestor. Unchanged successful commits SHALL skip ordinary nightly rebuilding. Master/nightly runs SHALL NOT select store jobs. Failed publication SHALL remain retryable.

#### Scenario: Development after a minor release

- **WHEN** three commits follow `v0.2.0` in historical version resolution
- **THEN** the general next-patch resolver produces `v0.2.1-nightly.3.g<source-hash>` without creating a stable patch tag; current pre-v1 launch preparation applies the explicit v1.0.0 target

#### Scenario: Unchanged source or failed build

- **WHEN** the current commit already has a successfully published Nightly, or a platform build fails
- **THEN** ordinary unchanged builds are skipped, and failures do not replace the last successful Nightly

#### Scenario: Launch preparation after old tags are removed

- **WHEN** historical pre-v1 tags have been removed and no stable v1.0.0 tag exists
- **THEN** a fresh rolling nightly is `v1.0.0-nightly.<count>.g<hash>` with defined commit-count semantics and no stable v1.0.0 tag is created

### Requirement: Publication remains bounded and recoverable

GitHub distribution SHALL publish only after all selected sideload packages succeed, serialize publication, retain only the current Nightly asset set and preserve stable history. A stable or candidate rerun SHALL resume a draft or leave an already published release intact. Missing release metadata SHALL be distinguished from API or authentication failure. Store submission SHALL be independently retryable and SHALL NOT gate GitHub publication.

#### Scenario: Selected platform fails

- **WHEN** one platform is skipped and a selected platform fails
- **THEN** publication does not proceed

#### Scenario: Interrupted nightly publication

- **WHEN** uploading or publishing a new Nightly fails
- **THEN** existing successful assets are retained until replacement uploads succeed and a later run can retry

#### Scenario: Store review is delayed

- **WHEN** a store rejects, delays or fails processing a submission
- **THEN** completed GitHub downloads remain available and unaffected stores can proceed independently

## ADDED Requirements

### Requirement: Historical development releases receive one cleanup

The approved pre-v1 cleanup SHALL remove all existing pre-v1 GitHub releases/assets and matching local/remote version tags while retaining commit history. Publication SHALL pause and active jobs SHALL drain before deletion against an enumerated cleanup manifest. The rolling nightly channel SHALL resume afterward. This exception SHALL NOT permit deletion of later stable release history.

#### Scenario: Clean historical development releases

- **WHEN** the approved cleanup runs
- **THEN** old v0.x stable and prerelease downloads and their version tags are removed, unrelated refs/commits remain intact, and a fresh preparation nightly can publish

### Requirement: Version one is reserved until acceptance

The first supported stable launch SHALL be v1.0.0. Its stable tag SHALL NOT be created or pushed until repository release-candidate and applicable TestFlight-delivered checks pass. Preparation nightlies SHALL remain available before that point. Numbered candidate tags select protected store build/upload work before the stable tag; TestFlight processing and delivered-device acceptance SHALL precede production store release. Upload SHALL NOT implicitly invite testers or submit review.

#### Scenario: Candidate is still under test

- **WHEN** a 1.0.0 candidate has outstanding acceptance checks
- **THEN** testing uses increasing native build identifiers without creating the stable tag or publishing production store releases

### Requirement: Sideload distribution remains available

Stable and nightly GitHub releases SHALL retain an AltStore-installable IPA, a signed Android APK and a universal macOS ZIP. Contributors SHALL retain documented local source-build commands without store-upload credentials. Store packages SHALL use the same application owners and shared frontend as corresponding sideload packages.

#### Scenario: Download without a store account

- **WHEN** a user selects a GitHub release
- **THEN** all three platform downloads have installation instructions and do not depend on an approved store listing

### Requirement: Installation guidance explains every distribution route

The README SHALL link to verified live iOS App Store, Google Play and Mac App Store listings while retaining AltStore IPA, Android APK, direct macOS and source-build instructions. It SHALL identify Float View as open source under AGPL-3.0-or-later and explain that paid app purchases support development and distribution fees. Store links SHALL appear only when their listings are available.

#### Scenario: User chooses how to install

- **WHEN** a user reads the README after all three store listings are live
- **THEN** each platform has its store link and relevant non-store installation route, with links to the source and licence and a clear explanation of purchase support

#### Scenario: One store has not launched

- **WHEN** a store listing is unavailable or still awaiting approval
- **THEN** the README retains working download instructions and does not present a placeholder or unavailable listing as an install link

### Requirement: Store publication is explicit and traceable

Store jobs SHALL use Release packages from stable `vX.Y.Z` or numbered `vX.Y.Z-rc.N` tags (positive N), recording source/version/native build identity. Master, nightly and PR runs SHALL NOT select them. Credentials SHALL remain in tag-restricted environments with explicit upload readiness. Apple and Android signing and enabled delivery SHALL proceed without required reviewers. Retries SHALL inspect prior Apple state before resubmission.

#### Scenario: Master commit is built

- **WHEN** master is pushed or manually built, including a request for store preparation
- **THEN** store jobs are skipped or the invalid request is rejected before store credentials are used; ordinary sideload nightlies remain available

#### Scenario: Release helper pushes a stable tag

- **WHEN** `just release ...` pushes a valid stable tag on master history
- **THEN** its run selects independent protected store jobs and all newly built packages share its native number, without automatically inviting testers or submitting review

#### Scenario: Prepare TestFlight before stable publication

- **WHEN** `just release candidate` runs on clean master matching origin/master
- **THEN** it pushes the next immutable numbered candidate tag for v1.0.0 before launch, or the next patch after launch; its Release builds share the CI native number, keep Apple marketing version vX.Y.Z, publish a separate GitHub prerelease without changing Latest/Nightly, and use the same tag-restricted store signing/upload readiness gates

#### Scenario: Signing proceeds without manual approval

- **WHEN** a stable or RC tag selects a ready Apple or Android signing job
- **THEN** signing and enabled delivery proceed without environment approval while tag restrictions, credential separation and readiness gates remain enforced

#### Scenario: Retry an existing stable release

- **WHEN** a deliberate manual check/retry targets an existing stable or candidate release tag
- **THEN** it can allocate a fresh run/native number for the same source and marketing version without replacing published GitHub downloads

#### Scenario: Correct source after submission

- **WHEN** source changes are needed after a release was tagged
- **THEN** a new candidate or stable release tag is created through `just release ...`; published tags are not moved

#### Scenario: Rebuild an already processed version

- **WHEN** a corrected binary is needed after its previous build identifier was consumed
- **THEN** the new upload retains the intended marketing version, uses a newer native identifier and records its exact source

#### Scenario: One CI run builds several platforms

- **WHEN** a Build apps workflow run produces sideload and selected store packages
- **THEN** all packages use the same native build identifier, derived from the retained workflow run counter, and build records identify the source revision and exact CI run URL

#### Scenario: Missing upload credentials

- **WHEN** a store-upload credential is unavailable
- **THEN** submission fails explicitly without falling back to development signing or blocking independently valid sideload publication

### Requirement: Distribution packages exclude development entry points

Stable sideload and store packages SHALL exclude test-host launch modes, external frontend/root/port overrides, fixture selection and destructive test reset controls. Development and conformance builds SHALL retain their documented capabilities behind explicit build configuration. Normal diagnostics SHALL remain bounded and redact private data.

#### Scenario: Launch a Release Mac with test options

- **WHEN** a Release package is launched with development host arguments or environment overrides
- **THEN** those options cannot replace its frontend, storage root, listener configuration or application lifecycle

### Requirement: Store packages satisfy platform boundaries

Store artifacts SHALL include platform distribution signatures, required metadata and declarations. The macOS store app SHALL operate inside App Sandbox; Android SHALL publish an App Bundle and validate native page-size compatibility. macOS direct downloads SHALL use Developer ID signing, hardened runtime and notarization when the production distribution identities are provisioned.

#### Scenario: Sandboxed Mac operation

- **WHEN** a user connects hardware, renders the frontend, records, restarts, imports or exports in the sandboxed store app
- **THEN** permitted operations succeed without broad filesystem exceptions or a second application runtime

#### Scenario: Direct Mac download

- **WHEN** a user downloads the production direct-distribution ZIP onto a clean supported Mac
- **THEN** signature and notarization validation succeed without requiring removal of quarantine attributes

### Requirement: Google internal delivery follows verified Android signing

Google delivery SHALL consume the exact verified signed AAB from its CI run after
successful Android signing, with separate credential storage and explicit readiness.
It SHALL write only the internal track and SHALL NOT manage testers or promote
closed/production releases. Delivery failure SHALL NOT gate sideload publication.

#### Scenario: A ready Android release uploads automatically

- **WHEN** a stable/RC tag requests upload and Android signing succeeds
- **THEN** enabled delivery verifies the source/run/build/hash/signature, uploads once and confirms the matching completed internal release, without an environment approval

#### Scenario: Google delivery is interrupted

- **WHEN** an upload or commit has an ambiguous result
- **THEN** a retry inspects remote version-code/hash and any retained edit before new mutations; conflicting, newer or unobservable builds fail actionably without blind re-upload or cancelling existing review
