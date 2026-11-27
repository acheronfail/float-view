## MODIFIED Requirements

### Requirement: Supported data compatibility

Diagnostic storage and report versions SHALL be independent of owned product storage and portable session archive versions. New collection SHALL NOT rewrite supported catalogs, session schemas, historical diagnostic rows or archives. Frozen baseline fixtures and existing imports SHALL remain supported without a reset or pre-baseline recovery path.

#### Scenario: Upgrade and reopen

- **WHEN** this feature opens a supported baseline catalog and imports a baseline recording
- **THEN** product records and historical diagnostic rows retain their existing semantics and independently owned diagnostic storage remains separate from product records

#### Scenario: Restartable diagnostic format upgrade

- **WHEN** supported version-1 diagnostics are opened by the version-2 collector or an upgrade is interrupted
- **THEN** existing incident and journal contents are preserved through an explicit restartable marker transition; unknown markers, corrupt data and operational errors preserve files and fail actionably
