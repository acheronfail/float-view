## ADDED Requirements

### Requirement: Live elevation reading

Live View slots SHALL offer Elevation from the current authorized route fix in metres or feet according to the unit preference. A missing or stale reading SHALL display as unavailable. Selecting Elevation SHALL use the existing slot persistence without requesting location access or starting capture.

#### Scenario: Configure elevation with changing GPS availability

- **WHEN** the rider assigns Elevation to a Live View slot
- **THEN** the slot shows the current value when available and retains its assignment when location recording is disabled or the fix is lost
