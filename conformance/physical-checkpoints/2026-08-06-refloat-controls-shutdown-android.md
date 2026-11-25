# Android Refloat controls and shutdown: historical result

Historical record revision: [fae1e4d0](https://github.com/acheronfail/float-view/commit/fae1e4d0beb5dcda6c5810244a31ea09b1ba0233). This identifies the recorded checkpoint, not an independently verified binary hash.

Result: Direct/CAN fixture controls and shutdown/no-op passed. Real supported-controller shutdown returned Home without automatic reconnect; manual power-on restored discovery. No motor-motion command was observed.

Limits: Background location produced no new sample and was accepted with that explicit limitation; this is not a background-location pass.

Detailed device records and execution history are retained locally under
`.local/physical-testing/`. See [recording guidance](README.md) for future checks.
