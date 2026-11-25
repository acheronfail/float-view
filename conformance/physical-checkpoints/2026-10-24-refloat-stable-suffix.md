# Stable Refloat INFO suffix compatibility

Source: working-tree compatibility fix based on
[fae14eda](https://github.com/acheronfail/float-view/commit/fae14eda), in
[`decode_info`](../../backends/core/refloat-compatibility/src/lib.rs) and the
[connection coordinator](../../backends/core/connection-application-coordinator/src/lib.rs).

Result: The rebuilt macOS host using production CoreBluetooth connected through
an Express gateway to a real controller running stable Refloat 1.3.0. A separate
read-only INFO probe confirmed numeric version `1.3.0` and suffix `0`. The host
reached `ready`, published canonical package version `1.3.0`, continued live
telemetry, and completed schema and current-value reads with configuration ready
and writable. No connection issue was reported. No configuration or control
writes were issued; the checks used isolated app storage and guest tracking.

The upstream stable build's `src/Makefile` passes the patch through
`cut -d- -f2-` when there is no hyphen. The compatibility exception accepts only
an exact patch-number suffix for an already audited stable identity. Software
regressions retain empty-suffix support and reject beta/RC suffixes, mismatched
numeric suffixes, and unknown releases. The simulator now reproduces the stable
build artifact.

To repeat, build the current macOS runtime and host with isolated app storage,
scan for the board, connect as a guest, and verify canonical firmware identity,
ready state, advancing telemetry, and completed current-value loading. Disconnect
without issuing board mutations.

Limits: This checkpoint covers macOS and the tested Express/controller route.
It does not establish physical iOS/Android, background, or mutation behavior.
Detailed local evidence remains in
`.local/physical-testing/refloat-130-suffix-20261024/`.
