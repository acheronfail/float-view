# Proposal

## Why

Float View records a ride's horizontal GPS track but loses the altitude supplied with its fixes. Saving valid altitude makes new recordings usable for future consumers such as Ride Hermes and preserves existing recordings.

## What Changes

- Store nullable altitude in metres above the WGS84 reference ellipsoid on accepted route points from Apple and Android.
- Return altitude in bounded location history and preserve it in portable session and app-data exports.
- Show an elevation chart in session review when altitude was recorded.
- Make Elevation available in the Live View slots and Custom View widget picker.
- Preserve supported recordings and archive imports. Version altitude-capable archives and prevent older builds from opening the newer owned storage.
- Ride Hermes integration, CSV changes, and GPS speed recording are out of scope.

## Capabilities

### New Capabilities

### Modified Capabilities

- `session-location-recording` covers accepted altitude, its lifecycle, and privacy.
- `session-location-review` covers availability and timeline behavior of the elevation chart.
- `backend-contract` returns nullable altitude in authenticated location history and on the latest live fix.
- `live-board-dashboard` and `custom-board-dashboard` expose configurable Elevation readings.
- `public-data-compatibility` covers altitude-capable archives and supported older recordings.
- `support-diagnostics` keeps diagnostic formats independent of portable archive version changes.

## Impact

Apple and Android location adapters, the shared Rust service, SQLite session storage and archives, the frontend contract and mock, and canonical conformance. Reuse the existing location path and archive validation. This change requires no new dependency.
