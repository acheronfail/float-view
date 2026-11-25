# Apple Rust stream background: historical result

Historical record revision: [fae1adbe](https://github.com/acheronfail/float-view/commit/fae1adbe2b820cb500309353d788e9b12901a23d). This identifies the recorded checkpoint, not an independently verified binary hash.

Result: The iOS fixture background scenario passed using production CoreBluetooth and Rust stream framing, including fragmented notifications, retained session continuity and new persisted background location samples.

Limits: This is fixture-backed transport/lifecycle coverage, not a new firmware or all-platform acceptance claim.

Detailed device records and execution history are retained locally under
`.local/physical-testing/`. See [recording guidance](README.md) for future checks.
