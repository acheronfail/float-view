# Float View privacy policy

Updated 27 November 2026.

Float View is an open-source app maintained by acheronfail. It connects to your
VESC devices, displays telemetry and optionally records rides and routes. There
is no Float View account, advertising, tracking SDK or developer-operated
telemetry upload service.

## Data on your device

Float View stores saved boards and Bluetooth associations, settings, battery and
motor configuration, Refloat tunes, ride telemetry and optional location records
in the app's private storage. Bluetooth device identifiers are used to recognise
and reconnect to your boards. Location recording is optional and requires your
permission. When enabled, it can continue during a ride while the app is in the
background or your screen is locked. It is not required for ordinary telemetry.

Saved rides also retain Refloat and VESC firmware versions and the direct/CAN
connection path at each successful connection or reconnect. This recorded
connection context excludes controller UUIDs and Bluetooth addresses.

These records are not automatically uploaded to the developer. On Android,
Float View allows the operating system to back up the complete settings/ride
store using encrypted cloud backup and device-to-device transfer, subject to
your system settings, backup provider and available quota. This can include
precise recorded routes and saved board associations. Diagnostic logs, temporary
exports, derived schema caches, WebView data and app permission-history hints
are excluded. Android cloud Auto Backup has a 25 MB per-app limit and may skip
a store above that size; keep your own recording exports. Backups and restored
copies follow the operating system/provider's retention and security rules.
Other platforms may also include data in system backups or transfers.
Float View does not operate its own cloud-backup service.

## Online maps

Viewing a recorded route loads map images directly from the OpenStreetMap
Foundation's tile service. Requests include the map tile coordinates and zoom
level, your IP address and normal HTTP request metadata. The requested tiles
can reveal the area you are viewing, including precise locations at high zoom.
The app does not send the complete recording or a list of route coordinates to
the tile service. A map can appear automatically when you open a ride or session
view that includes a route. Tile requests are for displaying that map; recording
a ride alone does not need them.

The provider processes request logs for service operation/security and describes
anonymised aggregate usage analysis and published tile/app statistics. See its
[privacy policy](https://osmfoundation.org/wiki/Privacy_Policy) and
[tile policy](https://operations.osmfoundation.org/policies/tiles/). Float View does
not add an analytics SDK or send these requests to a developer-operated server.
The provider's tile servers use a global network of caches; the app also uses
normal on-device HTTP caching to avoid repeatedly downloading unchanged images.

Avoid views displaying maps if you do not want these requests. Hiding a map stops
its updates in that view; requests already started may still finish. Disabling
location recording does not prevent maps of existing or imported routes from
loading. Telemetry and route recording do not require tile downloads. Map imagery
is best-effort and is not provided as an offline download service.

## Ride Hermes

The optional Ride Hermes integration sends your sign-in details directly to Ride
Hermes when you sign in. Float View keeps the resulting token in protected device
storage. When you confirm an upload, Float View sends the selected ride’s GPS
route, timestamps, distance, board speed, altitude and GPS accuracy to Ride Hermes.
Ride Hermes controls the uploaded copy, including its visibility and use in trail
and leaderboard processing. Disconnecting removes the local sign-in. Manage
rides already uploaded through Ride Hermes.

## Speech and platform services

Optional spoken announcements use the operating system's text-to-speech service.
Float View does not record microphone audio or provide speech recognition.
Android announcements select an installed English voice marked by the speech
engine as not requiring a network connection; if none is available, the app
reports that speech needs attention. Voice downloads and the operating system
or selected engine's services are governed by their provider's settings and
policies.
Live Activities and notifications display ride information through the platform;
Float View does not use remote push notifications or a push server.

## Local diagnostic logs

Float View keeps bounded structured diagnostic logs on your device, including
failed connections before recording begins. These contain available app/build
and firmware facts, failure categories, connection/lifecycle events and timing
counts. They exclude routes, coordinates, names, device identifiers, raw packets,
full configurations, telemetry values and raw exception messages/stacks. Unknown
hardware facts remain unknown. Up to three incidents are retained for seven days,
within an 8 MiB journal/incident budget; recent memory context is bounded.

Settings → Help with a problem lets you save a troubleshooting ZIP using the system
save/share interface. Local logs expire automatically within seven days. Nothing
is automatically uploaded or submitted to GitHub. You choose whether to manually
write a GitHub issue and attach the file. Issues and attachments are public.
Saved/shared copies remain under your control. Capture may be incomplete after
interruption or storage failure. See [diagnostic instructions](docs/diagnostics.md).

## Files you share and support requests

Exports can contain board information, recorded firmware and connection history,
ride telemetry and precise route data.
Files you choose to export, share or import are handled by your selected file
provider or recipient under their own terms. Exported copies are not removed
when you delete the original recording in Float View.

Support is available through
[GitHub Issues](https://github.com/acheronfail/float-view/issues).
Issues and attachments in this repository are public. Do not post private route
files, addresses, credentials or other sensitive information. GitHub processes
account and request data under its own privacy policy. Opening source, support
or licence links also makes requests to the relevant website.

## TestFlight testing

Apple processes TestFlight installation, usage, crash and feedback information
and makes certain testing information available to the developer. Feedback,
screenshots and crash reports may include personal information. See
[TestFlight & Privacy](https://www.apple.com/legal/privacy/data/en/test-flight/).
The developer uses information received through TestFlight to investigate issues
and improve Float View, not for advertising or sale. Do not include private
route data in feedback unless you intend to share it for that investigation.

## Retention and your choices

Local data remains until you delete it using the app, clear its storage or remove
the installation, subject to platform backup and restore behavior. You can turn
off route recording, revoke Bluetooth/location permission in system settings and
delete recordings. Revoking a permission does not delete previously recorded
data. Keep your own exports before uninstalling or changing installation routes.

Development builds before the supported public baseline may reset earlier
development data as described in the README. This does not delete exported
copies, reset operating-system permissions or erase third-party backups.

The developer retains support and TestFlight information while needed to
investigate reported problems and maintain the project; public GitHub history
and third-party retention are controlled by those services. Contact the
maintainer through GitHub Issues for privacy questions without posting sensitive
details. This document will be updated when the app's data handling changes.
