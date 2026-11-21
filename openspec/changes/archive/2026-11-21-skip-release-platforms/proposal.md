# Proposal

## Why

Platform-specific fixes can require a new signed build for one store. A normal release currently rebuilds and distributes every platform.

## What Changes

- Allow the source commit to opt out of iOS, Android or macOS independently with bracketed skip markers.
- Publish the enabled platforms together after their sideload builds succeed. Keep the current stable Latest designation for complete releases.

## Capabilities

### Modified Capabilities

- `app-distribution`: platform selection for CI packaging, publication and store delivery.

## Impact

The Build apps workflow, preparation and publication scripts, release guide and release tooling tests.
