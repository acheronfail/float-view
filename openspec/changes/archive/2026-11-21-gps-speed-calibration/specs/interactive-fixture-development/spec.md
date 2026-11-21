# Fixture calibration delta

## MODIFIED Requirements

### Requirement: Strict custom-configuration rejection

Custom-configuration mutations SHALL require audited writable firmware, index `0`, complete valid signatures/values and safe normal mode. The fixture SHALL reject unknown indexes, malformed/partial values, unsafe state, arbitrary app-data tuning, firmware/motor-control writes and motor configuration beyond audited diameter-only patches. Flywheel SHALL permit only eligible disable, withhold/invalidate current values and require a fresh command-93 read on return; schema/default reads remain available.

#### Scenario: Test firmware write

- **WHEN** a test-version fixture receives command 95
- **THEN** it applies a complete valid write only under the same version, signature, index, mode, and safety checks as release firmware

#### Scenario: Invalid signature

- **WHEN** command 95 contains a signature from another Refloat release
- **THEN** the fixture preserves all values and later current read returns the unchanged complete configuration

#### Scenario: Existing semantic controls

- **WHEN** a source-correct package, flywheel, lighting, or fatal control is received
- **THEN** its dedicated live-control behavior remains available and coordinated with, but not replaced by, the full configuration model

#### Scenario: Flywheel configuration isolation

- **WHEN** simulated flywheel mode is active and a client requests command 93, command 95, Tune apply, or another mutation
- **THEN** the fixture supplies no current snapshot or mutation success except for eligible flywheel disable and preserves disposable persistent configuration values

## ADDED Requirements

### Requirement: Diameter-only motor fixture writes

The fixture SHALL accept motor configuration writes only for an audited layout, with idle normal-mode authority and unchanged bytes outside wheel diameter. Unknown layouts, malformed extents, invalid diameters and unrelated changes SHALL fail closed. Accepted changes SHALL affect only disposable simulated state.

#### Scenario: Narrow motor write

- **WHEN** an idle peer writes a valid diameter-only patch and reads motor configuration again
- **THEN** the fixture returns that diameter and preserves every unrelated serialized field

#### Scenario: Prohibited mutation

- **WHEN** a peer changes another motor field or writes while riding or in flywheel
- **THEN** the fixture rejects the request and preserves its configuration
