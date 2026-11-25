# Proposal

## Why

Float View is preparing for store distribution on the iOS App Store, Google Play and Mac App Store. Existing releases are sideload packages, while repository policy still assumes disposable development data and contains inconsistent release boundaries.

## What Changes

- Retain GitHub stable/nightly IPA, APK and universal macOS ZIP downloads and local source builds; add independent, protected store packaging and upload paths from the same source/version, selected only for stable releases or numbered release candidates created by `just release ...`, never master/nightly builds. `just release candidate` supports TestFlight before the stable tag.
- Run stable/RC Apple and Android store signing and enabled delivery without required environment reviewers, retaining release-tag restrictions, separate credentials and readiness gates.
- Configure Apple/Google publisher accounts, app records, signing, review materials, privacy disclosures and store-delivered beta testing.
- Establish storage baseline `100` for the `v1.0.0` candidate: automatically reinitialize recognised pre-v1 owned development databases/settings/recordings without migrations, then preserve baseline and subsequent user data. Apply this before external store testing.
- Use `AGPL-3.0-or-later` for project-owned code with `Copyright © 2025 acheronfail`; retain third-party terms and complete dependency/provenance and Apple distribution-rights checks.
- Remove all existing pre-v1 GitHub releases/assets and matching local/remote version tags, preserving commit history. Retain rolling nightly builds, target `v1.0.0-nightly.…` during preparation, and create the stable `v1.0.0` tag only after candidate acceptance.
- Audit and remove Release-accessible development launch overrides, backup templates, stale documentation/version claims and missing distribution metadata; resolve project licensing and bundled notices before publication.
- Validate a sandboxed macOS store build early, preserving a direct-download route and its storage/export continuity.
- Record channel-switching and nightly downgrade limits rather than promise transparent replacement across different signing identities or storage containers.
- Update README installation instructions with verified iOS App Store, Google Play and Mac App Store links alongside AltStore, APK, direct macOS and source-build routes. Explain the project's open-source licence and that paid app purchases support development and distribution fees.

## Capabilities

### New Capabilities

- `public-data-compatibility`: supported public storage/archive baseline, non-destructive unsupported-version handling and channel compatibility boundaries.

### Modified Capabilities

- `app-distribution`: parallel sideload/store artifacts, protected submissions, release isolation and release-package requirements.

## Impact

Release scripts/workflows, Apple packaging/signing/entitlements and startup, Android bundle/signing/backup configuration, Rust product-store initialization and compatibility checks, privacy/help surfaces, installation documentation, agent guidance and active pre-release specification wording. No new firmware family or frontend wire operation is proposed. Persistence behavior changes across both native host families; any required public error/state change must update contract/client/mock/hosts/conformance together. Prefer existing tools and no new runtime dependency.

## Non-goals

Do not implement the plan during proposal preparation, submit apps, enroll accounts, rewrite commit history, restore historical development formats, relabel third-party code as project-owned, fork the frontend by platform, add a general migration framework without an actual published schema transition, remove sideloading, or require an automatic updater. Exact store prices and launch countries remain owner decisions.
