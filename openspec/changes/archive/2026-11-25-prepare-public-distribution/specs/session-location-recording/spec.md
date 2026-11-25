## MODIFIED Requirements

### Requirement: Location lifecycle and retention parity

Location rows SHALL participate in the same provisional-session retention, interruption recovery, deletion, pruning, integrity checks, and export lifecycle as the containing board session. Location storage SHALL follow the supported-storage requirement in [backend-contract](../backend-contract/spec.md#requirement-supported-current-storage-schema); version mismatch alone never authorizes deletion.

#### Scenario: Rejected provisional session

- **WHEN** a provisional session closes without satisfying the existing minimum ride retention rule
- **THEN** its location rows and catalog entry are deleted together with its board rows

#### Scenario: Recovered active session

- **WHEN** native startup finds an interrupted session with durable location rows
- **THEN** recovery validates and exposes the last complete location boundary without exposing rows beyond that boundary

#### Scenario: Pruning

- **WHEN** a user confirms session pruning
- **THEN** the backend accounts for and removes location storage with the selected sessions and returns updated bounded metadata
