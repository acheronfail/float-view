# Spec Delta

## Purpose

Protect published user data and portable archives through app updates, unsupported versions and changes in distribution route.

## ADDED Requirements

### Requirement: Explicit public compatibility baseline

The project SHALL use owned-storage baseline `100` for the first v1.0.0 candidate and record its independent archive format before external store beta distribution. Baseline and later supported versions SHALL cease to be disposable development data, independently of installation route or beta status. Earlier development formats SHALL NOT require historical readers or migrations.

#### Scenario: Public beta precedes the stable tag

- **WHEN** a 1.0.0 candidate is distributed through external store beta before the stable tag exists
- **THEN** the documented baseline data receives the same preservation guarantee as the subsequent public release

### Requirement: Recognised development storage resets once

On first opening recognised pre-v1 development storage, the new application SHALL reinitialize its owned databases, settings, boards, tunes, caches and recordings at baseline `100`, without migrating those records. The reset SHALL be bounded, confined to validated app-owned paths and restartable after interruption. Subsequent launches SHALL preserve baseline data. Unknown layouts and exported user files SHALL NOT be erased.

#### Scenario: Upgrade a pre-v1 development installation

- **WHEN** a baseline candidate opens a valid recognised earlier development storage marker and owned layout
- **THEN** the old owned records are discarded and a fresh baseline is initialized without requiring manual device deletion

#### Scenario: Reopen or interrupt a baseline reset

- **WHEN** initialization restarts after interruption or the app opens an already initialized baseline
- **THEN** an interrupted reset completes safely, while an existing baseline's new records are not reset again

### Requirement: Unsupported owned storage is preserved

Except for the recognised pre-v1 reset, opening nonempty storage with an unknown, newer, missing or malformed marker SHALL preserve its files and return an actionable failure. Supported storage SHALL open or upgrade through an explicitly tested path. Corruption and operational failures SHALL NOT trigger a compatibility reset. Empty new roots SHALL initialize normally.

#### Scenario: Install an older build over newer data

- **WHEN** a build encounters a newer storage marker
- **THEN** it refuses to mutate the root and explains that a compatible build is required

#### Scenario: Missing marker on a nonempty root

- **WHEN** the marker is absent but existing owned data is present
- **THEN** startup preserves the data and reports the problem rather than treating the root as a new installation

#### Scenario: Upgrade failure or ordinary corruption

- **WHEN** a supported upgrade is interrupted or opening storage fails
- **THEN** committed data remains recoverable and restarting does not silently recreate the root

### Requirement: Published archives retain portable support

Supported app updates SHALL continue to import archives from the recorded public baseline and subsequent supported releases. Unsupported or malformed archives SHALL fail without modifying existing data. Archive compatibility SHALL depend on format identity rather than store channel or app marketing version.

#### Scenario: Move a recording between installation routes

- **WHEN** a user exports a supported archive in a sideload build and imports it in a compatible store build
- **THEN** the same bounded validation and import semantics apply

### Requirement: Installation route limits are explicit

Installation documentation SHALL distinguish in-place updates, manual export/import and unsupported downgrades for each platform and channel. It SHALL NOT promise access to another app's private container or preservation through uninstall. Nightly downloads SHALL state their compatibility limits before users replace stable installations.

#### Scenario: Different signer or private container

- **WHEN** switching installation routes cannot preserve the existing private store in place
- **THEN** instructions explain the supported export/import scope and any settings or associations that must be recreated before removal of the old installation
