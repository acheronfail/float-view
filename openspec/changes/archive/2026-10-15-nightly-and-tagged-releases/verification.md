# Verification

- 13 focused Node tests passed locally and in GitHub Actions, covering semantic resets, stable ancestry, clean/current release tagging, stale rolling local tags, nightly skips, interrupted uploads, draft recovery, API failures and stable asset preservation.
- Release scripts passed strict TypeScript checking. Frontend Svelte checks, production nightly build, formatting and ESLint passed. Chromium and WebKit rendered the full nightly Settings version without application errors.
- Actionlint, workflow YAML/shell syntax, packaging shell syntax and `git diff --check` passed. Strict OpenSpec validation passed.
- Xcode Release settings resolved marketing version 0.2.0 and independent build 60. No Android SDK is installed locally; actual Android packaging was validated on the hosted runner.
- [CI run 50](https://github.com/acheronfail/float-view/actions/runs/38705421537) built all three platforms, signed/verified Android and macOS packages and published `v0.1.50-nightly.2.gfae172f5b32c` to the rolling Nightly prerelease.
- Downloaded iOS app, Live Activity extension and macOS bundle all contain numeric version 0.1.50 and build 50; their embedded frontend contains the full nightly version. Android manifest versionName is the full nightly version and versionCode is 50; its embedded frontend also matches.
- GitHub Nightly has exactly three versioned assets and points to the source commit. Stable v0.1.49 remains Latest.
- [Manual run 51](https://github.com/acheronfail/float-view/actions/runs/38706011211) succeeded with prepare only; platform/publication jobs were skipped for the unchanged commit.
- Stable tag publication and interrupted stable draft recovery were exercised in isolated Git/GitHub fixtures, plus Xcode Release metadata resolution. No additional public stable release or app-store submission was made during verification.
