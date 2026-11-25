# Shared host cutover: historical result

Historical record revision: [fae1610a](https://github.com/acheronfail/float-view/commit/fae1610aa0b0db000751d52dc1288b0ec325183b). This identifies the recorded checkpoint, not an independently verified binary hash.

Result: All 17 iOS fixture scenarios passed after the shared-host/Android cutover.

Limits: Physical Android testing was intentionally skipped. Location acquisition was deferred; the disabled/unavailable path invented no samples.

Detailed device records and execution history are retained locally under
`.local/physical-testing/`. See [recording guidance](README.md) for future checks.
