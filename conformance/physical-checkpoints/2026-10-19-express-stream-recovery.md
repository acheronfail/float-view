# Express stream recovery and Android negotiated capacity

Source: [fae11293](https://github.com/acheronfail/float-view/commit/fae11293ee812b3a2b0ecedfad28589a40d15d33).

Result: A separately installed Android test build negotiated a 244-byte payload
capacity with Express. Live telemetry advanced and Refloat control status became
ready on the initial connection and two explicit reconnects. The actual menu
showed enabled LED/headlight controls. No board mutations were issued.

Limits: The full Refloat configuration download remained unavailable, leaving
Configure Refloat disabled. Recovery accepts later valid frames; it cannot
reconstruct a reply corrupted upstream. Initial readings took several seconds.
The [full-MTU follow-up](2026-10-19-express-full-mtu.md) identifies the three-byte
notification truncation at MTU 247 and verifies complete configuration downloads
after requesting MTU 517.
Default-MTU fallback, missing/stale negotiation callbacks and malformed-stream
bounds have software coverage; they were not separate physical passes. This
checkpoint does not establish background execution, other firmware interoperability,
or Apple OS behavior.

For repeat checks, install a separate test package when the production signing
identity is unavailable, stop the other app to release its connection, connect
the single-controller CAN gateway, confirm the negotiated capacity, observe
advancing samples and control availability, and repeat explicit reconnects.
Preserve the production installation and its data. Keep packet captures, device
inventories, APK identity and detailed timing reports in ignored local storage.

Detailed evidence is retained under
`.local/physical-testing/2026-10-19-express-mtu-recovery/`.
