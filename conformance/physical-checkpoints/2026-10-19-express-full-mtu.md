# Express configuration and full Android ATT MTU

Source: [fae17a0a](https://github.com/acheronfail/float-view/commit/fae17a0a8d4e281b9bf5fd116c00845bbeb81adf).

Result: The isolated Android test build negotiated ATT MTU 517 with Express and
completed two cold Refloat 1.3.0 schema downloads, followed by successful current
configuration reads. Three cached reconnects also passed. Configuration reported
ready and writable with all 172 current values loaded; telemetry advanced and
lighting controls became ready on every check. Cold configuration readiness took
about 14 seconds, and cached readiness about two seconds. No board mutations were
issued. The original Play installation and its data were preserved.

The failing MTU-247 capture contained schema replies within 78–143 ms, but each
416-byte frame lost exactly three bytes at the first notification boundary. The
second notification began at byte 247 after the first delivered only 244 bytes.
Vendor Express notification fragmentation advances by `min(MTU, 255)` without
subtracting ATT overhead. After the correction, the capture confirmed MTU 517 and
all 69 schema pages; both copies of every page passed CRC and matched the
independently downloaded audited schema. Increasing request timeouts was not
needed. The shared outgoing write cap remains 244 bytes.

The subsequent [CAN collision investigation](2026-10-19-express-can-id-collision.md)
isolated the source of duplicate forwarded replies and verified that correcting
the gateway/receiver address collision also restores the original Play RC4 app.

For repeat checks, retain one isolated test package, stop other clients, verify
the negotiated MTU and complete schema/current-value reads, observe advancing
telemetry, and repeat reconnects. To repeat a cold download, stop only the test
app, back up and evict its validated regenerable schema-cache entry, then verify
the regenerated entry matches. Preserve app records and production installations.
Restore logging settings and remove diagnostic forwarding afterward.

Limits: This checkpoint covers the connected Android/Express combination. It does
not establish iOS negotiation size, other Android devices, smaller peer MTUs,
background execution or configuration writes. Negotiation failure/cancellation
has software coverage. The earlier
[MTU-247 checkpoint](2026-10-19-express-stream-recovery.md) records the intermediate
build whose configuration download remained unavailable.

Private captures, device inventory, cache backup, APK/checksum and individual
timings remain in `.local/physical-testing/2026-10-19-express-scheduling/`.
