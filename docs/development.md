# Development reference

Float View has one responsive SvelteKit frontend and a shared Rust backend with native OS hosts. The
frontend knows nothing about Apple or Android: every backend implements the
small hand-written contract in `frontend/src/lib/backend/contract.ts`.

## Repository

- `frontend/` — SvelteKit, TypeScript, Tailwind, the backend contract, client,
  deterministic mock, and UI tests. `npm run build` emits one self-contained
  `build/index.html`.
- `backends/apple/` — native macOS and iOS hosts for the shared Rust backend.
- `backends/core/` — shared Rust application runtime and loopback server.
- `backends/android/` — one Android application module containing the backend
  and thin WebView shell.
- `backends/sql/` — the canonical supported SQLite schemas.
- `backends/fixtures/` — immutable VESC and Refloat protocol fixtures.
- `conformance/` — the canonical black-box contract suite and programmable VESC
  simulator/orchestrator.
- `tools/vesc-test-device/` — pure ESP-IDF firmware, built with PlatformIO, that
  only bridges a serial line protocol to a fixed BLE GATT service.

See [backend ownership](../backends/README.md) for service and host boundaries.

Project-owned contributions use AGPL-3.0-or-later. Preserve third-party licences
and attribution; see [licensing and notice maintenance](licensing.md).

## Additional commands

`just --list` lists recipes; [CONTRIBUTING.md](../CONTRIBUTING.md) covers everyday
setup/build/run commands and [releases](releases.md) covers publication.
For manual BLE iteration, run `just fixture dev [port]` beside `just dev <platform>`.
The controller is at `http://127.0.0.1:11004`; see
[fixture development](../conformance/fixture-dev/README.md).
Fixture tooling needs PlatformIO Core, without a separate ESP-IDF installation.

### Ride Hermes builds

Native builds without a partner registration show Ride Hermes as unavailable.
For an approved partner build, set `FLOAT_VIEW_HERMES_ORGANIZATION`,
`FLOAT_VIEW_HERMES_AUTH_API_KEY`, and `FLOAT_VIEW_HERMES_RIDES_API_KEY` before
rebuilding the native Rust bridge. Each defaults to
`pending-hermes-registration`. These values ship in the app, so use only
credentials Hermes approves for distribution in a public client.

## OpenSpec

Use OpenSpec according to [AGENTS.md](../AGENTS.md#when-to-use-openspec). Run every
CLI command with `OPENSPEC_TELEMETRY=0`. The commands below were checked with
OpenSpec 1.15.0. Commands normally resolve the nearest local `openspec/` root.
Only when a standalone store is explicitly selected, discover its ID with
`OPENSPEC_TELEMETRY=0 openspec store list --json` and retain `--store <id>` on
commands that support it. Use `status --change <name> --json` to resolve artifact
paths, schema and edit constraints, and `instructions <artifact-id>` to create
missing artifacts in dependency order. Do not write to a literal glob path.

Before declaring planning ready or starting implementation, start at `applyRequires`
and follow each artifact's `requires` transitively, including artifacts marked
`done`. Every required artifact must be `done` or explicitly `skipped`; skipped
outputs must not be created. Status is based on file existence, so a tasks file,
an apply-ready response or successful validation alone does not establish readiness.

[AGENTS.md](../AGENTS.md#completing-work) owns completion and authorization policy.
The commands below implement that workflow; they do not require separate Git phases.

Validation errors block completion. Fix warnings in new or changed requirements;
unchanged existing editorial warnings are reported separately and do not block
unrelated work. In particular, existing requirements longer than 500 characters
produce warnings; do not describe those results as a strict-validation pass.
`--strict` promotes warnings to failures and is an optional editorial audit.
Inspect JSON `issues` for touched specs and ready changes so non-strict summaries
do not hide warnings; compare warned requirements with the pre-change version
before classifying a warning as unchanged.

```sh
just spec-check                     # Canonical specs and archived task completion
just spec-check CHANGE_NAME         # One implementation-ready active change
OPENSPEC_TELEMETRY=0 openspec validate CAPABILITY --type spec --no-interactive --json
OPENSPEC_TELEMETRY=0 openspec validate --specs --strict --no-interactive # Editorial audit
```

An intentionally unfinished proposal must say so and identify its remaining
planning work. Review the existing artifacts for coherence and valid links;
validate the complete change once it has its required delta specs (or an actual
spec-free scope). Do not include unfinished drafts in ready-change validation or
set `skip_specs: true` merely to silence missing behavioral requirements.
Consequently, `validate --all` is an inventory audit that can fail on drafts,
not the routine completion gate. `just spec-check` excludes active drafts;
validate each ready change by name as well as its affected canonical specs.

Sync reads both delta and canonical specs, preserves unrelated scenarios and is
idempotent. After sync and validation, use
`OPENSPEC_TELEMETRY=0 openspec archive CHANGE_NAME --yes --skip-specs` to archive
without applying the deltas twice. Here `--skip-specs` skips only the CLI merge;
it does not replace the preceding sync or validation. Preserve required evidence
and verify the archive destination; never bypass validation to force closeout.

## Verification

Choose checks for the changed behavior and affected consumers. The policy in
[AGENTS.md](../AGENTS.md#verification) applies to implementation, review and OpenSpec
completion. Existing test coverage stays available; running every suite is not
required for each edit.

| Change                                      | Relevant checks                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation or planning only              | Review links and commands, `git diff --check`, and the [OpenSpec validation rules](#openspec) when specs or plans change. No application tests or builds.                                                                                                                                            |
| Frontend UI only                            | Focused Vitest tests (`cd frontend && npm test -- <test-file>`), `npm run check`, and relevant formatting/lint checks. `just test frontend` runs the whole frontend suite when useful. Add `npm run build` for bundle/build changes and affected browser tests for interaction or rendering changes. |
| Shared Rust logic or persistence            | From `backends/core`, run `cargo test --locked --offline -p <crate>` for affected crates and consumers, plus relevant formatting and warnings-denied Clippy checks. Use `just conformance direct` for affected public service behavior.                                                              |
| Contract, client/mock or shared integration | Update the contract, client/mock, shared implementation, both host integrations and canonical scenarios together. Run affected frontend and Rust tests, mock/direct conformance, and affected native integration coverage.                                                                           |
| Apple or Android host                       | `just test apple` or `just test android`, or focused Swift/Gradle tests; add the affected native conformance target, startup tests or packaging checks when that boundary changes.                                                                                                                   |
| Conformance or fixture tooling              | Relevant TypeScript checks and focused runner/simulator tests; `just test conformance` for broader harness changes. `just test fixture` covers ESP32 firmware checks.                                                                                                                                |

For browser checks, first build the current frontend with `cd frontend && npm run build`,
then run the affected file from `conformance` with
`node --strip-types --test test/<name>.browser.ts` (with its Playwright browsers installed). Use native simulator/emulator
coverage when native integration is affected, not just because a frontend is
also shipped in a WebView. Package/build changes need the relevant build checks;
a pure component edit does not need clean packages for every architecture.

Run frontend builds, Vitest and SvelteKit checks sequentially: they share generated
SvelteKit files. The build validates that the embedded app and startup IDs agree.
When running multiple browser files, use `--test-concurrency=1` because their mock
servers share a port.

Automatic battery announcements also have opt-in native software replay. Build
the frontend first; for Android, configure Java/SDK tools as described in the
[Android guide](../backends/android/README.md#local-sdk-and-verification) and start
an emulator. From the repository root, run either host:

```sh
FLOAT_VIEW_NATIVE_REPLAY_HOST=macos node --strip-types --test conformance/test/announcements.native.ts
FLOAT_VIEW_NATIVE_REPLAY_HOST=android node --strip-types --test conformance/test/announcements.native.ts
```

These cases replay legacy pack and modern per-cell limits through the real
native host and shared service, then observe decoded phrases at a deterministic
speech-driver boundary, including a full one-minute repeat on each host. The
replacement drivers are compiled only into software conformance builds;
production Apple builds and Android Debug/Release builds retain native speech.
This does not establish audible output, audio routing or locked-device delivery;
use production builds for that physical checkpoint.

`just verify` retains the complete software check as an option for broad changes,
uncertain impact or an explicit full-regression request. `just test all` is also
available; neither is a default completion gate.

Physical testing is needed only for affected behavior that software cannot prove:
OS Bluetooth, permissions, lifecycle/background execution, radio timing or new
firmware interoperability. Select the relevant devices, routes and scenarios,
without rerunning unrelated physical matrices. Native visual checks do not
inherently require an ESP32/BLE run. Record missing required hardware and actual
results honestly; ordinary software-only changes need no hardware-skip report.
See [conformance/README.md](../conformance/README.md) for checkpoint procedures.

For new BMS support, follow the [compatibility audit procedure](../backends/README.md#auditing-another-vbms-wire-version).
Reusable hardware procedures and brief outcomes are in
[physical checkpoints](../conformance/physical-checkpoints/README.md).

### Release-readiness records

Follow the [evidence policy](../AGENTS.md#verification) for public summaries and
ignored local records. Distribution procedures are in [releases](releases.md)
and the linked platform guides.
