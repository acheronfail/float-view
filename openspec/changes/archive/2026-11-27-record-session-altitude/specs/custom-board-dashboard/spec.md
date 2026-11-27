## ADDED Requirements

### Requirement: Custom elevation widget

The Custom View widget picker SHALL offer Elevation as a numeric reading or live trend. It SHALL use the current authorized route fix, follow the unit preference, and show unavailable when altitude is absent or stale. Live elevation trends SHALL use bounded in-memory history and break when readings are unavailable.

#### Scenario: Save and reopen an elevation widget

- **WHEN** the rider adds and saves an Elevation widget
- **THEN** the board layout restores the widget and it uses the current route fix for its next available reading
