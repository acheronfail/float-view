# App distribution

## Purpose

Define predictable app versions and downloadable builds for continuous development and deliberate releases across every supported host.

## Requirements

### Requirement: Stable versions follow explicit tags

Stable builds SHALL use strict `vX.Y.Z` tags on master history as their version source. The release helper SHALL derive patch, minor or major increments from the greatest stable ancestor tag, reset lower components and push an annotated tag only from a clean, current master checkout. Published stable releases SHALL retain their tags and assets on reruns.

#### Scenario: Explicit semantic increments

- **WHEN** the latest stable ancestor is `v0.1.49`
- **THEN** patch, minor and major release requests produce `v0.1.50`, `v0.2.0` and `v1.0.0` respectively

#### Scenario: Invalid or unsafe release request

- **WHEN** a tag is malformed, outside master history, already reserved, or the helper checkout is dirty or behind origin/master
- **THEN** release creation fails before publishing or replacing a stable release

### Requirement: Nightlies identify development commits

Master pushes and manual master runs SHALL resolve a nightly from the next patch after the greatest stable ancestor, the count of commits since that tag and the source hash. Successful builds SHALL update one rolling prerelease without marking it latest. An unchanged nightly commit SHALL skip rebuilding; failed publication SHALL remain retryable.

#### Scenario: Development after a minor release

- **WHEN** three commits follow `v0.2.0`
- **THEN** the display version is `v0.2.1-nightly.3.g<source-hash>` and no stable patch tag is created

#### Scenario: Unchanged source or failed build

- **WHEN** the current commit already has a successfully published Nightly, or a platform build fails
- **THEN** unchanged builds are skipped and failures do not replace the last successful Nightly

### Requirement: Native build identity is independent

All platform builds SHALL receive the same display version, numeric marketing version and independent positive native build number. Numeric build identifiers SHALL continue across major/minor changes. Settings and package filenames SHALL include the full display version; Apple marketing versions SHALL omit prerelease suffixes.

#### Scenario: Minor bump with continuing build number

- **WHEN** build 60 packages `v0.2.0` after build 59 of `v0.1.50`
- **THEN** every native package uses build 60 and marketing version `0.2.0`, while Settings shows `v0.2.0`

### Requirement: Publication remains bounded and recoverable

Distribution SHALL publish only after all selected sideload packages succeed, serialize publication, retain only the current Nightly asset set and preserve stable history. A stable rerun SHALL resume a draft or leave an already published release intact. Missing release metadata SHALL be distinguished from API or authentication failure.

#### Scenario: Selected platform fails

- **WHEN** one platform is skipped and a selected platform fails
- **THEN** publication does not proceed

#### Scenario: Interrupted nightly publication

- **WHEN** uploading or publishing a new Nightly fails
- **THEN** existing successful assets are retained until replacement uploads succeed and a later run can retry

### Requirement: Nightly releases use sortable version tags

The rolling Nightly prerelease SHALL reference its full SemVer display-version tag so it can sort above older stable releases. Updates SHALL retain one Nightly release identity and replace its asset set. Nightly tags SHALL identify immutable source commits, and pushing them SHALL NOT trigger a stable-release build.

#### Scenario: Development nightly follows a stable release

- **WHEN** a nightly based on `v0.1.49` is published
- **THEN** its release tag is `v0.1.50-nightly.<count>.g<hash>`, it remains a prerelease and `v0.1.49` retains the stable Latest designation

### Requirement: Source commits can skip platform distribution

Build apps SHALL honor exact `[skip ios]`, `[skip android]` and `[skip macos]` markers in the source commit message. Each marker SHALL skip its platform's sideload packaging, store signing and store delivery, including on tagged manual runs. Markers SHALL combine independently. A partial stable release SHALL preserve the existing Latest designation.

#### Scenario: Android-only stable release

- **WHEN** the stable tag's source commit contains `[skip ios]` and `[skip macos]`
- **THEN** only Android packaging and any enabled Android store delivery proceed, and GitHub publishes the APK without changing Latest

#### Scenario: All platforms are skipped

- **WHEN** the source commit contains all three markers
- **THEN** no platform is packaged or delivered and no GitHub release is published

#### Scenario: Skip marker exists only on an ancestor

- **WHEN** the source commit has no skip markers and an earlier commit has one
- **THEN** the earlier marker does not suppress any platform
