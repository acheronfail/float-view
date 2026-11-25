# Design

## Context

The Apple host embeds one WKWebView using ignoresSafeArea; the shared frontend has horizontal safe-area padding, fixed bottom tabs and a shared PageHeader. This machine cannot run the required newer Xcode. See proposal.md for scope.

## Goals / Non-Goals

Capture actual system, native and web geometry before choosing a side-region mapping. Preserve one frontend and existing control ownership. No native routing, storage or backend contract changes; no persistent remote development service.

## Decisions

1. Add a dedicated opt-in CI diagnostic with a single simulator architecture, unsigned Debug build, caches, bounded readiness polling and small downloadable artifacts. Bootstrap registration used a narrowly scoped workflow-file push trigger on the authorized branch; that trigger has been removed. Manual CLI dispatch on the branch is verified without default-branch integration. A job-level guard permits only manual dispatches from dedicated `apple-duo/*` branches; other branches and tags skip the job before runner allocation. Main checks and distribution workflows do not invoke this diagnostic. It must not invoke release publication or the full suite. Record cold/warm timings rather than assume a duration. Retain an unsigned simulator app artifact by all Apple/core/SQL/toolchain inputs; on frontend-only iterations replace its bundled index.html with the freshly built artifact. This is diagnostic-only and cannot alter signed release artifacts. A missing or expired matching native artifact rebuilds the app, with a separate Rust compilation/toolchain cache retained even after later failures. Retain frontend dependency artifacts by tracked package/lockfile contents, OS/architecture and exact Node version so ordinary captures skip npm installation too.
2. Measure native window/WebView bounds, safe-area and status geometry alongside CSS viewport, safe-area values and control rectangles. Keep captures in ignored local evidence and CI artifacts. Debug capture code is explicitly enabled by a launch environment variable and writes one bounded report inside its sandbox.
3. Gate the production layout work on evidence from the diagnostic. If CSS alone cannot identify usable control space, a thin Apple UI adapter may expose closed geometry facts to the document; it must not expose product operations or duplicate the runtime. Prefer reported reserved regions over model detection or guessed screen coordinates. Record the chosen mapping here after capture.
4. Reuse existing tab links, header action snippets and back links, changing their placement rather than constructing native navigation. Remove bottom and header control reservations in side mode; retain ordinary placement when geometry is absent or insufficient. Modal surfaces keep their focus/inert boundaries.
5. Pin only iOS distribution jobs to the same Xcode 27.1 toolchain: older linked SDKs cannot use this region. Verify an unsigned device build once through an optional diagnostic input, disabled for ordinary captures; preserve existing signing/publishing controls.
6. Use measured geometry in focused browser tests for quick iterations, then confirm actual native rendering in CI. Build only the affected simulator target; no physical BLE gate is necessary for this UI change.

## Risks / Trade-offs

- New simulator/runtime availability and cold boot delays → inspect the selected image and runtime explicitly; bounded failure with diagnostic artifacts.
- CSS safe area may exclude more space than the actual system occlusion → capture both native and CSS geometry; do not infer a usable rail from safe-area width alone.
- Future camera/status/Live Activity changes → use live geometry and conservative fallback, not a captured constant in production.
- Shared header changes affect overlays and focus → verify representative routed and modal screens, pointer and keyboard behavior, and resize fallback.
- A native build linked to a newer SDK changes compatibility framing → record SDK/runtime/source with every capture and compare the unmodified control layout before adapting it.

## Measured mapping

CI run 40460393322 (source fae19516, Xcode 27.1/27A9275, Duo iOS 27.1)
reported a 466 × 678 native window and WebView, a matching CSS viewport at scale 3,
and matching native/CSS safe insets {top: 0, right: 84, bottom: 34, left: 0}.
Active occlusions include the right-column rectangle {x: 382, y: 0, width: 84,
height: 174} and its smaller camera rectangle. StatusBarManager reports only a
466 × 2 frame and is therefore insufficient for custom controls. The screenshot
command failed because two integrated displays were exposed; use --display=primary
for the closed outer display.

The host publishes versioned bounds, physical vertical-bar edge, safe insets and
active occlusion rectangles through a read-only document event/global. The shared
frontend selects the largest clear vertical interval in the reported side inset,
with control padding and minimum target/text fit. For the recorded closed layout,
this yields x=386, y=182, width=76, height=454. These coordinates are a regression
fixture, never production device constants. UIKit region/trait/layout changes and
web viewport/font changes recompute placement; invalid, mismatched or insufficient
geometry falls back to ordinary controls. Keep the existing controls in place in
the DOM and alter their CSS positioning to preserve focus and activation semantics.

Detailed reports, device inventories and troubleshooting logs remain in ignored local evidence and short-lived CI artifacts. Production placement uses live facts rather than these fixture coordinates.

## Verification

- Native folded capture [40470640834](https://github.com/acheronfail/float-view/actions/runs/40470640834), source fae1c937, passed with actual system status UI. The header action is {x:402,y:182,width:44,height:44}; tabs occupy {x:386,y:458,width:76,height:178}. Inline assertions establish minimum target sizes, viewport/home-area containment and no overlap with live system occlusions. The screenshot was inspected.
- The artifact preparation run [40469793398](https://github.com/acheronfail/float-view/actions/runs/40469793398) took 7m01s from recorded setup to screenshot. The repeat took 6m55s and verified native/dependency artifact hits, skipped npm installation, Rust setup and native/device compilation, and rebuilt the current frontend. Reuse is correct, but this sample did not establish a substantial elapsed-time reduction: artifact lookup/restores took about 3m05s, frontend compilation 46s, and the native launch/capture phase 2m53s despite an already booted simulator. Runner/capture variability dominates; do not promise sub-minute native captures. Earlier native-app cache restores repeatedly timed out, so reuse uses same-branch/repository artifacts with embedded key validation; the independent Rust cache remains for native rebuilds.
- The quick UI loop uses the captured fixture locally: the focused Chromium/WebKit tests take about 2.8 seconds after a frontend build. Use native CI occasionally to re-establish OS facts and inspect status UI. The workflow is manual-only and retains artifacts for seven days; no runner remains allocated afterward.
- Frontend: 550 unit tests across 94 files, Svelte check (zero warnings/errors), focused ESLint/Prettier and production build passed. Conformance TypeScript and the measured-side browser tests passed in Chromium and WebKit, covering tabs, Live actions, routed returns, left/right placement, menu reachability, modal focus, primary/non-primary/keyboard activation, font/resize/occlusion fallback and one retained backend connection.
- The older navigation, Live-menu and full-screen-overlay browser files fail identically on this change and the unchanged baseline fae19516 in both engines: navigation waits for Board actions at line 91; Live-menu expects focus after pointer cancellation at line 431; full-screen overlays uses a non-unique scroll selector at line 98. Those pre-existing failures were reproduced in a separate source archive without modifying the checkout. Detailed logs remain ignored local evidence.
- The optional unsigned iPhoneOS build passed in CI run [40466675146](https://github.com/acheronfail/float-view/actions/runs/40466675146), confirming the new adapter compiles for devices with Xcode 27.1. Distribution script tests passed (21 TypeScript and 32 Python tests), and only the two iOS distribution jobs changed SDK/runner.
- Local Xcode 26 Swift type checking passed for the WebView/URL-boundary sources. CI establishes newer-SDK compilation and native Sessions layout; populated Live/back/overlay interaction coverage is browser-based. No physical-device behavior is claimed.
