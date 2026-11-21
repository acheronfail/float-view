# Tasks

## 1. Platform selection

- [x] 1.1 Resolve commit markers and gate sideload builds, store builds and delivery.
- [x] 1.2 Publish the selected artifacts and preserve Latest for complete stable releases.

## 2. Usage and verification

- [x] 2.1 Document marker usage in the release guide.
- [x] 2.2 Verify selection, partial publication, retries and workflow wiring.

All 69 release-tooling tests passed. Actionlint validated Build apps with the existing `xcode-27` runner label configured. The change and canonical spec validate without issues.
