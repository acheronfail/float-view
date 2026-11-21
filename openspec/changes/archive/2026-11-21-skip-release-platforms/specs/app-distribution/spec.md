## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Publication remains bounded and recoverable

Distribution SHALL publish only after all selected sideload packages succeed, serialize publication, retain only the current Nightly asset set and preserve stable history. A stable rerun SHALL resume a draft or leave an already published release intact. Missing release metadata SHALL be distinguished from API or authentication failure.

#### Scenario: Selected platform fails

- **WHEN** one platform is skipped and a selected platform fails
- **THEN** publication does not proceed

#### Scenario: Interrupted nightly publication

- **WHEN** uploading or publishing a new Nightly fails
- **THEN** existing successful assets are retained until replacement uploads succeed and a later run can retry
