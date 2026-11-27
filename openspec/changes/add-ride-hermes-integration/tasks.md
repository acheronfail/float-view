# Tasks

## 1. Product behavior

- [x] 1.1 Implement bounded ride preparation with speed alignment, timestamps and payload limits. Verify with representative recorded-session fixtures.
- [x] 1.2 Implement account state, durable upload outcomes and retry safeguards. Verify disabled registration, receipt recovery and uncertain results.

## 2. Native and frontend integration

- [x] 2.1 Wire native credential entry, protected storage and bounded HTTPS across the Apple and Android hosts. Verify with host builds and native bridge checks.
- [x] 2.2 Add Settings → Integrations and the session action, confirmation and outcomes. Verify through frontend checks and browser mock coverage.
- [x] 2.3 Update shared contract and conformance coverage for account and upload actions. Verify protocol parity and credential isolation.

## 3. Partner verification

- [ ] 3.1 Configure Float View's approved registration and verify native sign-in, credential persistence, upload acceptance, visibility, and trail processing using the partner-approved test account.

## Verification notes

- Focused Rust fixtures exercised sample matching, payload fields, credential isolation, and durable account-scoped receipts. The shared backend and loopback suites, warnings-denied Clippy, and direct conformance passed.
- Frontend type checks, 748 unit tests, and the Chromium and WebKit upload flows passed. The browser mock exercised sign-in, explicit consent, a confirmed receipt, and disconnect.
- Android unit tests, the iOS simulator build, and focused macOS bridge tests passed. The broader Apple suite reported a failure in the macOS loading-artwork appearance test.
- Production builds use an inert registration until the approved organization and separate sign-in and ride keys are available. No production sign-in or upload has been attempted. Keep the change open for the partner verification in 3.1.
