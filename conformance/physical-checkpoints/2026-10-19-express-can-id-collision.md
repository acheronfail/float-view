# Express duplicated replies and CAN address collision

App sources: original Play RC4 build 122
([fae15b2a](https://github.com/acheronfail/float-view/commit/fae15b2a2df2b8d559612dd4160c5df4cde44835))
and the isolated corrected Android build
([fae17a0a](https://github.com/acheronfail/float-view/commit/fae17a0a8d4e281b9bf5fd116c00845bbeb81adf)).

Result: Express and a CAN receiver shared a CAN identifier. A single firmware
query to the receiver enabled duplicate replies to subsequent motor-controller
reads. Assigning Express an unused identifier, with explicit user approval,
removed the duplicates. Full configuration readback verified that only the
approved identifier changed. Motor-controller and receiver settings were not
written. Both the original Play RC4 installation and the corrected test app then
loaded all 172 current configuration values and advanced telemetry and controls.
After a physical power cycle, complete readback confirmed persistence and
preservation of every other configuration byte. Probing the receiver again left
motor and schema responses single-copy.

Controlled observations:

- After a board restart, Linux and a separate Android probe received one reply
  per request. Immediate schema-to-limits requests also completed normally.
- Running the normal app reintroduced duplicate replies, which then persisted
  with Linux as the sole client. This excludes Android callback duplication as
  the sole explanation.
- Read-only, command-by-command testing isolated the receiver firmware query.
  The app issues this legitimate query during auxiliary-node discovery.
- With duplicate replies active and 20-byte payloads, a schema read delivered
  exactly 32 notifications: one complete frame plus a partial duplicate. No
  other request was sent for 1.5 seconds. The truncation therefore did not
  require the next request to interrupt transmission. The count and unchecked
  notification-send loop are consistent with burst queue exhaustion.
- After the identifier correction, all 28 Android probe cases passed at default
  ATT MTU and MTU 517. Sixteen immediate schema-to-limits pairs returned one
  complete reply each, with no incomplete bytes left in the probe decoder.

The earlier Linux download probe consumed the first matching reply and did not
report all copies. Its initial success alone did not establish absence of
duplicates. Later explicit passive observation established the state-dependent
behavior above. The separate
[MTU-247 truncation](2026-10-19-express-full-mtu.md) and decoder recovery fixes
remain applicable; neither request-priority changes nor increased deadlines were
needed to correct this CAN topology.

For repeat diagnosis, release other clients, count all responses during a quiet
window, compare before and after each auxiliary-node probe, and verify unique
CAN identifiers for the gateway and every receiver/controller. Back up complete
configuration before any separately authorized address correction, verify unused
destination and exact readback, and test the original client as an independent
control. Preserve app records and production installations.

Limits: No physical CAN-bus analyzer trace was collected; the relay mechanism is
supported by the isolated trigger, confirmed address collision, upstream routing
source and successful correction. Exact receiver binary source was not captured.
This checkpoint does not establish other devices, background execution or
motor-control behavior.

The app now reports a nonfatal **Possible CAN ID conflict** warning after
unexpected exact duplicates of three separate solicited CAN reads within ten
seconds. Each duplicate must arrive within 1.5 seconds of its original reply;
repeated copies of one response count once. Tracking retains at most eight
responses of at most 8 KiB each, excludes streaming telemetry and direct reads,
and resets on reconnect. The warning names the gateway, controller and
receivers/accessories to check, without changing their settings or preventing
otherwise working reads.

This is evidence-based detection, not a complete CAN collision inventory.
Truncated copies that never form valid frames, collisions without duplicate
replies, and ambiguous replies that match the current request may escape the
heuristic. A CAN scan reports responding addresses rather than device counts.
The warning path has deterministic protocol, public snapshot and Chromium/WebKit
coverage; the corrected physical board was not deliberately returned to a
conflicting address to exercise the new warning.

Private inventories, addresses, raw traces, temporary probe source/results,
configuration backup, approved proposal and rollback remain in
`.local/physical-testing/2026-10-19-express-duplicates/`.
