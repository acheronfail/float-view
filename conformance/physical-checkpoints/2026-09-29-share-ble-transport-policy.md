# Shared BLE transport: historical result

Historical record revision: [fae12540](https://github.com/acheronfail/float-view/commit/fae125408d6eaebeacd4e86392ec262d29ce33a4). This identifies the recorded checkpoint, not an independently verified binary hash.

Result: Selected production BLE checkpoints passed on all three hosts, including configuration readback/restoration, reconnect and mobile background continuity. Measured payloads respected each host ceiling.

Limits: The fixture selected with-response. No-response pacing/readiness, absent CCCD, lost/duplicate OS completions and saturation were not physical passes; their deterministic software coverage remains separate.

Detailed device records and execution history are retained locally under
`.local/physical-testing/`. See [recording guidance](README.md) for future checks.
