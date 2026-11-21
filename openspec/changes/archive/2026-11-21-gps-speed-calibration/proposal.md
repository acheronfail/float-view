# Proposal

## Why

Riders need a straightforward way to correct board speed using phone GNSS measurements. A useful recommendation must remain available when a controller cannot safely accept a diameter write.

## What Changes

- Add a connected-board calibration flow: start, collect speed comparisons, optionally refine and review a quality-approved wheel diameter.
- Use native speed, speed accuracy and measurement age; estimate in the shared Rust service with bounded temporary samples and no new persisted location fields.
- Allow explicit application only for audited motor-configuration layouts, using fresh read/diameter-only patch/full write/verified readback through the existing scheduler and mutation coordinator.
- Keep recommendations visible with manual VESC Tool instructions when application is unavailable. Assume pole count and gearing are correct.
- Non-goals: general motor configuration editing, changing other settings, automatic application, historical recalibration or storage migrations. No superseded path needs retaining or removing.

## Capabilities

### New Capabilities

- `speed-calibration`: Temporary native GNSS calibration, recommendations, simple UI and narrowly authorized wheel-diameter application.

### Modified Capabilities

- `interactive-fixture-development`: Permit only audited idle diameter-only motor configuration writes in the fixture.
- `session-location-recording`: Explicit calibration may request temporary location independently of route recording without persisting calibration-only coordinates.

## Impact

Contract/client/mock, shared service and protocol scheduler/mutation owners, both native location adapters and conformance fixtures. No new dependency or persisted format; physical GNSS and firmware write/power-cycle checks remain required before closeout.
