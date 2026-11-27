## ADDED Requirements

### Requirement: Portable session altitude and prior recording support

Portable session archives that carry route altitude SHALL use format 5 and preserve altitude in standalone and app-data transfers. Format 4 SHALL remain supported. An existing owned recording without altitude SHALL remain readable and shall return absent altitude for its existing points.

#### Scenario: Round trip a recording with altitude

- **WHEN** the user exports and imports a supported altitude-bearing recording
- **THEN** each altitude remains associated with the original route point

#### Scenario: Open an earlier recording

- **WHEN** an owned recording or a format-4 archive has no altitude field
- **THEN** supported reads return its existing points with absent altitude

#### Scenario: Reject a mismatched archive

- **WHEN** an archive declares format 4 with an altitude schema or format 5 without its altitude schema
- **THEN** import fails without modifying existing data
