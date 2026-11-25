# iOS Refloat controls and shutdown: historical result

Historical record revision: [fae1e4d0](https://github.com/acheronfail/float-view/commit/fae1e4d0beb5dcda6c5810244a31ea09b1ba0233). This identifies the recorded checkpoint, not an independently verified binary hash.

Result: Sixteen fixture scenarios and manual supported-controller controls/shutdown/recovery passed, including cancellation without side effects and return Home without automatic reconnect. No motor-motion command was observed.

Limits: The unrelated background lifecycle scenario was unavailable because the XCTest worker did not start; no background-location result is claimed.

Detailed device records and execution history are retained locally under
`.local/physical-testing/`. See [recording guidance](README.md) for future checks.
