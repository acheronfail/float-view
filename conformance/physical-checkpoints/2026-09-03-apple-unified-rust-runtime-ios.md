# Apple unified Rust runtime: historical result

Historical record revision: [fae1a2f9](https://github.com/acheronfail/float-view/commit/fae1a2f9211ff4bc3bb6b89abb4660758d92f8b6). This identifies the recorded checkpoint, not an independently verified binary hash.

Result: All 17 iOS fixture scenarios passed after selecting the unified runtime.

Limits: Location authorization/acquisition was deferred; the disabled/unavailable path preserved unchanged location boundaries. Android physical testing was outside this Apple-only checkpoint.

Detailed device records and execution history are retained locally under
`.local/physical-testing/`. See [recording guidance](README.md) for future checks.
