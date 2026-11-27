# Proposal

**Status: Approved for implementation with placeholder registration.** Ride Hermes confirmed Float Control as the integration reference. Production access awaits Float View’s partner registration and a test upload.

## Why

Riders want to record in Float View and submit a completed ride to Ride Hermes for trail and leaderboard processing. Float Control demonstrates the account and ride API flow and uses saved VESC speed alongside phone GPS coordinates. Float View already records the data needed to build that payload.

## What Changes

- Add an Integrations subsection in Settings with Ride Hermes sign-in and disconnect. Use the Float Control email-and-password flow against Hermes with Float View's own partner registration.
- Add **Upload to Ride Hermes** in the session action menu after sign-in. Identify the destination account and explain that the recorded GPS route and ride measurements will be shared before the rider confirms.
- Build the upload from the saved GPS track and time-aligned board speed. Include recorded altitude and horizontal accuracy according to the partner contract.
- Show progress, confirmed uploads, and actionable failures. Prevent concurrent submissions and unsafe retries after an uncertain outcome.
- Scope the first release to manual uploads of individual rides. Automatic sync, historical backfill, local route redaction settings, tunes, and trail browsing are out of scope. Use Hermes defaults for vehicle and visibility.

## Capabilities

### New Capabilities

- `ride-hermes-integration` covers account linking, per-session upload, and result handling.

### Modified Capabilities

- `backend-contract` adds platform-neutral account and upload controls and status.
- `session-location-recording` permits confirmed submission of recorded GPS data to Ride Hermes.

## Impact

The shared frontend adds Settings and session-review controls. The process-owned Rust service owns eligibility, payload mapping, upload policy, and receipts. The iOS, macOS, and Android hosts provide native credential entry and protected token storage through the existing native boundaries. The change preserves supported recordings and portable archives.
