# Diagnostic logs and manual bug reports

In Settings → Help with a problem, select **Export logs** and save the ZIP using the system
file chooser or share sheet. This single action exports the most recent retained
incident, or recent context when no incident exists. There is no incident picker,
preview or separate save step. Capture limitations are included in the ZIP.

Nothing is uploaded automatically. First check the project's
[existing GitHub issues](https://github.com/acheronfail/float-view/issues).
For a reproducible bug that has not been reported, manually write an issue with
steps, expected and actual behavior, and known hardware/firmware details. Unknown
motor or battery details are fine. Attach the saved diagnostic ZIP in the issue's
attachment area and review your issue before submitting. The app does not prefill
or submit issues. GitHub issues and attachments are public. Do not include route
files, private screenshots or credentials.

Reports contain `report.md`, `events.jsonl` and `manifest.json`. They include
available build/firmware facts, connection generations, failure categories,
request outcomes and timing/queue counters. Unrecognized text is omitted. Raw
packets, exception messages/stacks, names, addresses, UUIDs, stable board IDs,
location coordinates (including board GNSS), configurations and telemetry values
are excluded. Report-local generation numbers cannot identify a device.

Diagnostics are independent of ride retention and available before successful
controller setup, including guest connections. Local storage keeps at most three
incidents, each at most 1 MiB, for seven days; the journal and incidents together
are bounded to 8 MiB. The memory context is bounded to 256 records/30 seconds,
so busy windows can be shorter. Repeated errors coalesce within 60 seconds.
Manual marks are limited to one per ten seconds. Loss, clipping and incomplete
post-windows are disclosed; these logs are not a complete process crash report.

Report preparation runs automatically before native presentation. Reports belong
to their connected frontend, expire after ten minutes and occupy one of two
slots. Repeated exports replace the previous prepared report while native
presentations retain their file lease through completion. ZIPs are bounded to
5 MiB. Saved/shared copies remain under the user's control. The backend clear
operation invalidates unpresented reports without interrupting an active share;
the simplified Settings UI exposes only export.

The shared Rust service owns the typed vocabulary, background writer, journal,
incident policy and report preparation. Native adapters supply OS facts and
present service-issued files. Diagnostic persistence failure degrades to bounded
memory collection without blocking recording. Export requires usable diagnostic
storage. Native recovery remains responsible when the service cannot start.

The private diagnostic root is beside product storage: Apple
`Application Support/FloatView/Diagnostics`, Android
`files/float-view/diagnostics`. Test roots use a unique `.diagnostics` sibling.
Version 1 diagnostic files are independent of product baseline 100 and recording
portable archive versions. Unknown versions, malformed committed files and unexpected
layouts remain untouched and make diagnostic storage unavailable. A torn final
journal append is reported as incomplete; earlier valid data is preserved.

The existing authenticated control channel exposes `diagnostics.list` and
`diagnostics.capture` with empty parameters, `diagnostics.prepare` with
`{ "incidentId": null }` for recent context or a listed incident ID,
`diagnostics.export` with its prepared `reportId`, and `diagnostics.clear` with
empty parameters. Preparing another preview can explicitly release the previous
owned handle with `replaceReportId`; native presentation leases remain pinned.
`diagnostics.uiError` accepts only closed category/feature
codes and optional numeric source positions, with per-client/service rate limits.
`diagnostics.report` continues accepting bounded UI timing aggregates. Responses
use existing error envelopes; unknown fields/invalid input fail with
`invalid_request`, missing/foreign/expired handles with `not_found`, and capacity
or unavailable storage with `unavailable`. Diagnostic operations do not advance
product revisions or expose event streams in application state.

## Failed backend requests

Every failed authenticated backend control request records its allowlisted
operation name and stable error code, including validation, state, permission,
not-found and conflict errors. Unknown method text becomes `unknown`. No request
parameters, tune names/values, response bodies or raw error messages are recorded.
Session HTTP read/import/export failures use fixed route categories. Diagnostic
requests are excluded to prevent recursion.

Failures trigger bounded incidents even when the UI handles the error. Coalesced
backend failures remain in the incident after its ten-second follow-up window,
within existing event/byte limits, without extending that window. Client-side
transport, timeout and HTTP response-validation failures queue only closed UI
categories in memory: at most ten per minute and ten pending, retried on an
ordinary request or reconnect. Backend responses are recorded by the service;
HTTP failures may additionally have a generic UI failure. Deliberately cancelled
session reads are excluded. Pending frontend evidence can be lost if its WebView
is destroyed before reconnection. Successful tune changes and every user tap
are not recorded as an activity history.

## Reading timing and connection fields

Timing summaries use `[count, p50, p95, max]`. Percentiles use the nearest-rank
convention consistently, including one- and two-observation samples, over the
bounded last 256 observations; count and max cover the whole summary interval.
Scheduler outcomes include `sent`, `sent_only`, `response`, `timeout`,
`queue_full`, `cancelled` and `stale`.

New captures use `generation` for the transport connection and
`application_generation` for the controller protocol generation. A request or
activation carries both where available, so a protocol/controller change can be
associated with its transport without treating the counters as one namespace.
Exports independently rebase each namespace to report-local ordinals. Older
captures retain their original fields; they cannot retroactively gain a missing
outcome or separate generation namespace.

Store archives preserve the full stable/candidate source tag for embedded
frontend and Rust diagnostic metadata, while Apple's marketing version stays
numeric. A `request_delay` incident describes a timing observation, not proof of
an app-visible error. Partial/clipped captures and dropped records remain
explicitly reported; the ZIP is not a complete activity history.
