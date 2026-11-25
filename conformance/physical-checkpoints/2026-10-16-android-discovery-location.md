# Android discovery location: historical result

Historical record revision: [fae1e9c5](https://github.com/acheronfail/float-view/commit/fae1e9c5f41e79ea5fbf9818d03fa67ef42f0ad7). This identifies the recorded checkpoint, not an independently verified binary hash.

Result: For source fae1356, the production permission/discovery path passed initial request, denial/retry, permanent-denial Settings recovery, foreground grant and device Location off/on recovery. Recording remained disabled.

Limits: This was scoped discovery testing, with no board connection or recording. Newer Android Nearby devices/approximate-location behavior was not physically established.

Detailed device records and execution history are retained locally under
`.local/physical-testing/`. See [recording guidance](README.md) for future checks.
