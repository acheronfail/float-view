# Live Board Dashboard Specification

## Purpose

Define the focused live-board experience, including responsive telemetry, connection and session state, board configuration, and safe disconnect controls.

## Requirements

### Requirement: Focused responsive live dashboard

The live-board screen SHALL remain subordinate without primary tabs. Live SHALL retain its fixed responsive widgets and five configurable boxes; Detailed SHALL group supported telemetry at stable readable positions; Custom SHALL use the saved board's configured widgets. All views SHALL keep unavailable placeholders and readable narrow layouts. Custom SHALL NOT be required to contain every telemetry field.

#### Scenario: First live sample

- **WHEN** a connected board publishes its first live sample
- **THEN** the selected view replaces applicable placeholders with available readings without changing configured widget order

#### Scenario: Before the first sample

- **WHEN** a connection is active but no sample is available
- **THEN** the selected view's structure remains visible with placeholders and without layout movement

#### Scenario: Narrow viewport

- **WHEN** the selected view is rendered on a narrow mobile viewport
- **THEN** its readings remain readable without horizontal page scrolling or unintended omission

#### Scenario: Future telemetry field

- **WHEN** the contract gains another supported live telemetry field
- **THEN** Detailed assigns it an intentional group rather than a catch-all field bucket, and existing custom layouts remain unchanged

### Requirement: Live connection-state presentation

The dashboard SHALL display the active connection's resolved board name, actual connection state, detected controller route, VESC version, Refloat package version, and VESC access mode when known. It SHALL label a direct route as direct and a CAN route with its CAN ID. A recognised test-version controller SHALL show read/write access beside the VESC and Refloat versions; read-only access SHALL retain a generic read-only label. Values SHALL render normally only while the connection is `ready`; every other active connection state SHALL retain and dim the latest sample. The view SHALL NOT display per-sample age or private controller identifiers.

#### Scenario: Direct connection

- **WHEN** authoritative state reports a ready direct controller
- **THEN** the live firmware information identifies the controller connection as direct

#### Scenario: CAN connection

- **WHEN** authoritative state reports a ready controller on CAN ID `42`
- **THEN** the live firmware information identifies the connection as CAN ID `42`

#### Scenario: Test firmware access label

- **WHEN** authoritative firmware information reports an audited nonzero test-version marker
- **THEN** the live firmware information shows `Read/write` beside the VESC and Refloat versions

#### Scenario: Transient reconnect

- **WHEN** a ready connection enters `reconnecting`
- **THEN** the status changes to reconnecting and the latest readings remain visible with dimmed presentation

#### Scenario: Reconnect succeeds

- **WHEN** a reconnecting connection returns to `ready`
- **THEN** the status returns to connected and readings return to normal presentation as persisted updates resume

#### Scenario: Unsupported firmware

- **WHEN** firmware identity is known and marked unsupported
- **THEN** the live view presents the stable unsupported-controller or unsupported-Refloat issue, starts no polling or new session, and retains any previously persisted sample in dimmed presentation

#### Scenario: Recoverable connection failure

- **WHEN** authoritative state contains a failed active connection and connection issue
- **THEN** the live view explains that bounded issue, keeps board configuration and disconnect available, and offers retry for the same device

#### Scenario: Retry after configuration

- **WHEN** the user corrects or clears the preferred CAN ID and activates retry
- **THEN** the frontend sends `device.connect` for the same failed `deviceId` once and follows the new authoritative generation

#### Scenario: Incomplete Board Profile

- **WHEN** the connected board's profile is incomplete
- **THEN** profile completeness does not block or add a warning to the live dashboard

### Requirement: Active-session live summary

The live view SHALL present the active saved session's sample count, riding elapsed time, total elapsed time, distance, maximum speed, maximum duty cycle, state, and integrity from the same authoritative snapshot as the latest persisted sample. When the connection is in guest mode and no active session exists, the live view SHALL present live telemetry and a clear temporary/no-history notice instead of session aggregates.

#### Scenario: Persisted sample updates summary

- **WHEN** a saved-mode sample is successfully persisted
- **THEN** the dashboard receives the resulting latest sample and current active-session aggregates in one newer authoritative snapshot

#### Scenario: Guest sample updates live view

- **WHEN** a guest sample is published for live display
- **THEN** the dashboard updates its telemetry, may show the current-ride `distanceM` value when Refloat supplies it, shows that the connection is not being saved or tracked, and renders no fabricated session aggregate or lifetime odometer value

#### Scenario: Unavailable aggregate

- **WHEN** an optional saved-session aggregate has not been established
- **THEN** its assigned cell displays a placeholder rather than a fabricated zero

### Requirement: Extensible live action menu

The live header SHALL provide one accessible menu trigger whose menu contains the current view switch, stateful Refloat package and flywheel actions, Charts… for an active saved session, Clear fatal error only when a Refloat 1.2.x fatal latch remains after its active firmware fault has ended, Shut down controller when the VESC core profile supports the command, Configure board when saved identity exists, Disconnect, and End ride for an active saved session. LED and headlight menu items SHALL be absent. Each remaining Refloat item SHALL display its last confirmed on/off state, SHALL be disabled unless its native preconditions are currently satisfied, and SHALL remain unavailable while its action is pending. Shutdown SHALL be unavailable unless authoritative controller-action state permits it. While authoritative state reports flywheel enabled, a non-dismissible full-application modal overlay SHALL replace access to normal application interaction and SHALL expose exactly one action, Disable, which requests the safety-gated flywheel-off transition. Disabling Refloat, enabling flywheel, and shutting down the controller SHALL require explicit contextual confirmation before the backend request is sent. Every menu, confirmation, and flywheel-overlay control SHALL retain native button semantics, use primary Pointer Events with cancellation and a guarded keyboard/assistive click path, avoid double activation, and manage focus within the modal surface.

#### Scenario: Open menu

- **WHEN** the user activates the live header menu trigger on a ready writable connection
- **THEN** a keyboard- and pointer-operable menu presents the applicable Refloat controls with confirmed state alongside the current view, configuration, disconnect and eligible End ride actions

#### Scenario: Saved identity pending

- **WHEN** an active connection has not yet produced a saved-device identity
- **THEN** Configure board is unavailable while applicable live-only Refloat controls, connection state, and disconnect remain usable

#### Scenario: Lighting unavailable

- **WHEN** Refloat INFO reports no lighting capability
- **THEN** configured lighting boxes show unavailable state and no lighting request is issued by the frontend

#### Scenario: Read-only or reconnecting connection

- **WHEN** firmware is read-only or the active connection is not ready
- **THEN** Refloat mutation actions are visibly unavailable while current retained state may remain displayed and disconnect remains usable

#### Scenario: Confirm package disablement

- **WHEN** the user chooses to disable an idle enabled Refloat package
- **THEN** an explicit warning explains that balancing will be disabled and sends the request only after confirmation

#### Scenario: Confirm flywheel engagement

- **WHEN** the user chooses to enable flywheel from an eligible idle normal state
- **THEN** an explicit warning requires the board to be disengaged, nose-up, and balanced before confirmation sends the request

#### Scenario: Flywheel mode actions

- **WHEN** authoritative state reports active flywheel mode
- **THEN** a non-dismissible modal overlay blocks the normal application, explains that the board must be disengaged, and presents a single **Disable** button that can issue only the flywheel-disable request

#### Scenario: Flywheel disable remains pending or fails

- **WHEN** Disable is activated while its mutation is pending or the exact command cannot be transmitted or confirmed
- **THEN** no other application action becomes available and the overlay remains until fresh authoritative telemetry reports flywheel disabled

#### Scenario: Clearable fatal latch

- **WHEN** authoritative state reports a latched Refloat fatal error and no active firmware fault
- **THEN** the menu presents Clear fatal error and removes it after the confirmed clear publishes newer state

#### Scenario: Primary and keyboard activation

- **WHEN** a Refloat action is activated by primary pointer or keyboard/assistive click
- **THEN** exactly one backend request is issued, while non-primary activation and the guarded synthetic click do not double activate it

#### Scenario: Confirm controller shutdown

- **WHEN** the user chooses Shut down controller on an eligible idle connection
- **THEN** a modal warns that not every controller supports software shutdown, that unsupported hardware may remain on, and that the board must be stationary before **Shut down** sends exactly one request while **Cancel** sends none

#### Scenario: Shutdown transmission is not power confirmation

- **WHEN** the backend accepts a shutdown command but the connection remains available
- **THEN** the frontend does not claim that power-off succeeded and continues to render the authoritative connection after pending intent clears

#### Scenario: Shutdown causes transport loss

- **WHEN** an accepted shutdown powers off the controller and its attached transport
- **THEN** the live view exits through the normal user-initiated disconnect presentation without showing an automatic-reconnect failure

### Requirement: Live board-configuration sheet

Configure board SHALL open a modal bottom sheet that covers almost the entire viewport and renders the same board configuration editor as the routed Boards flow, including the optional preferred CAN ID. The sheet SHALL respect safe areas, contain focus, provide a close control, dismiss from Escape or backdrop activation, and restore focus to its trigger.

#### Scenario: Open live configuration

- **WHEN** the user selects Configure board for an identified active board
- **THEN** the sheet opens over the live dashboard and displays the board's resolved name, editable custom name, read-only platform Bluetooth identifier, optional preferred CAN ID, and remaining Board Profile fields

#### Scenario: Backdrop dismissal after text edit

- **WHEN** backdrop activation blurs a valid edited text field
- **THEN** the resulting save completes before the sheet dismisses and the updated authoritative value is visible after dismissal

#### Scenario: Reconnecting while configuring

- **WHEN** the active connection begins reconnecting while its configuration sheet is open
- **THEN** local board configuration remains usable and the underlying live status reflects reconnecting

### Requirement: Conditional disconnect confirmation

Disconnect SHALL proceed without confirmation only when the latest persisted ride state is exactly `idle`. Disconnect SHALL pause eligible saved rides; End ride SHALL always require confirmation before finalizing and disconnecting, including when idle. Confirmation copy SHALL distinguish these outcomes. A non-idle, unknown, or unavailable latest ride state SHALL require explicit confirmation before the disconnect request is sent.

#### Scenario: Idle disconnect

- **WHEN** the latest persisted ride state is `idle` and the user selects Disconnect
- **THEN** the frontend requests disconnect immediately and returns Home after authoritative state removes the active connection

#### Scenario: Riding disconnect

- **WHEN** the latest persisted ride state is not `idle` and the user selects Disconnect
- **THEN** the frontend requests confirmation and disconnects only after the user confirms

#### Scenario: No live sample

- **WHEN** no latest persisted sample is available and the user selects Disconnect
- **THEN** the frontend requests confirmation before disconnecting

### Requirement: Ambiguous controller prompt

The shared live view SHALL present an accessible modal controller-selection prompt whenever authoritative state is `selecting_controller`. It SHALL state how many VESC controllers were found, list every CAN-ID-sorted candidate's CAN ID and available display-safe identifying information, identify unsupported VESC versions, and require an explicit supported choice before sending `device.selectController`. Disconnect MUST remain available.

#### Scenario: Two controllers found

- **WHEN** state contains two current controller candidates
- **THEN** the prompt explains that two VESC controllers were found and renders both CAN IDs with their available hardware/model, firmware name, and VESC version

#### Scenario: Unsupported candidate

- **WHEN** a candidate has `vescSupported` false
- **THEN** the prompt keeps it visible with an unsupported explanation and disables its selection control

#### Scenario: Candidate activated

- **WHEN** the user activates one candidate with a primary pointer or keyboard
- **THEN** the frontend sends one selection request, prevents duplicate activation while pending, and follows subsequent authoritative state

### Requirement: Detailed live board telemetry

The shared live dashboard SHALL present available detailed telemetry in coherent groups for motion, electrical load, temperatures, rider input, control contributions, and accumulated values. It SHALL clearly distinguish measured, requested, directional, filtered, booster, and field-weakening currents in amperes and duty as a ratio. It SHALL NOT derive or display torque or current utilization. Missing values SHALL display as unavailable rather than zero.

#### Scenario: Detailed dynamic session

- **WHEN** a Refloat 1.2.3 session supplies full dynamic telemetry
- **THEN** the dashboard can display its IMU, footpad, current, ATR, tilt, remote, and core motor values without platform branching

#### Scenario: Legacy unavailable value

- **WHEN** the selected legacy detail level does not provide a field shown by the dashboard
- **THEN** that field is hidden or marked unavailable and is not displayed as zero

### Requirement: Live semantic board states

The live experience SHALL surface package state and mode, footpad state, wheelslip, darkride, charging, stop condition, setpoint adjustment or pushback type, alert reason, and bounded firmware fault with accessible text and non-color-only distinctions.

#### Scenario: Duty pushback

- **WHEN** telemetry reports running state, duty pushback, and a duty alert reason
- **THEN** the live view identifies duty pushback distinctly from high-voltage, low-voltage, temperature, speed, and firmware-fault states

#### Scenario: Wheelslip and footpad

- **WHEN** wheelslip is active and only one footpad side is engaged
- **THEN** both states are conveyed accessibly and neither is inferred solely from current or speed

### Requirement: Detailed historical telemetry review

Session review SHALL expose metadata first, then the same supported detailed fields through bounded authenticated columnar series and sample-window requests, plus observed semantic transitions through chronological event pages. It SHALL preserve nullability and units, allow inspection of fixture-generated scenes after disconnect, cap each data request to 16 fields/1,024 buckets/65,536 observations, cap sample pages at 2,000 rows and event pages at 500 rows, and disclose retained/pruned history metadata. The review SHALL compose compatible fields into metadata-defined visual chart groups without changing the independent field columns returned by the data service. Each chart group SHALL use one y-axis: either an explicitly defined fixed domain or a deterministic domain derived from all finite values in the group, including lines currently hidden from view. Display formatting SHALL be consistent between axis labels and tooltip values; bounded ratio fields SHALL be able to show their semantic percentage range without changing transported values. A multi-field group SHALL render one line per field and a legend below the plot. During inspection, each chart group SHALL render one tooltip at the shared elapsed position, with one newline-separated, field-colored value line for each visible field and a marker at that field’s corresponding y-position.

#### Scenario: Review field weakening

- **WHEN** a session includes field-weakening current and high duty
- **THEN** historical detail shows both raw series in their contract units, with each field assigned to its metadata-defined chart group

#### Scenario: Review bounded duty cycle

- **WHEN** a session contains duty-cycle ratios within the normal bounded range
- **THEN** the duty-cycle chart always includes `0%` and `100%` as its axis endpoints and tooltip values use the same percentage formatting

#### Scenario: Compare temperatures

- **WHEN** a session contains motor temperature and controller temperature
- **THEN** both fields appear as separate colored lines in one temperature chart with one shared °C axis, a legend underneath, and one consolidated tooltip containing separate colored lines for both values

#### Scenario: Hidden line does not change the shared scale

- **WHEN** one line in a multi-field chart is hidden through its legend
- **THEN** the remaining line is omitted from the SVG while the chart domain, ticks, viewport, series requests, and other line states remain stable

#### Scenario: Missing or unavailable field

- **WHEN** a requested group column is absent, null, or split by a continuity gap
- **THEN** the affected line remains unavailable or broken without being replaced by zero, connected across the gap, or allowed to block other loaded lines in the group

#### Scenario: Recreated session route

- **WHEN** the session route or frontend controller is recreated
- **THEN** metadata-defined grouping and axis policies are rebuilt, all lines start visible, and no prior route’s hidden-line state or stale geometry is applied

### Requirement: Detailed telemetry interactions

Any interactive telemetry disclosure, group selector, chart control, session annotation control, or historical chart legend SHALL use native semantics, appropriate `touch-action`, primary Pointer Events with cancellation, and a guarded keyboard and assistive-technology click path without double activation. A chart legend item SHALL expose whether its associated line is visible, SHALL toggle only that line, and SHALL remain operable on desktop and touch clients. Hidden legend items SHALL be visibly greyed and struck through and SHALL also expose an equivalent non-color state. Legend state SHALL not change historical request bounds, viewport state, or backend data.

#### Scenario: Touch disclosure

- **WHEN** a primary touch pointer opens a detailed telemetry group in a frequently updating live view
- **THEN** it opens exactly once and remains operable while samples continue updating

#### Scenario: Non-primary activation

- **WHEN** a non-primary pointer or cancelled gesture targets a detailed telemetry control
- **THEN** no action is performed

#### Scenario: Prompt recovered

- **WHEN** the frontend is recreated while selection remains pending
- **THEN** the prompt is reconstructed from `state.get` without starting another connection or discovery request

#### Scenario: User disconnects instead

- **WHEN** the user chooses to disconnect while the prompt is visible
- **THEN** the frontend requests disconnection and closes the prompt when authoritative state removes the active connection

#### Scenario: Show or hide one chart line

- **WHEN** the user activates a legend item with a primary pointer, touch, keyboard, or assistive technology
- **THEN** the associated line toggles exactly once, the legend exposes the new pressed/visibility state, and all other lines remain unchanged

#### Scenario: Hidden legend item remains discoverable

- **WHEN** a line is hidden
- **THEN** its legend label remains present, greyed, and struck through, with accessible text indicating that activation will show the line again

#### Scenario: Hide every line

- **WHEN** the user hides every line in a multi-field chart
- **THEN** the chart and legend remain available, no line is rendered, and any legend item can restore its line without changing the shared viewport

#### Scenario: Consolidated multi-line tooltip

- **WHEN** inspection is active on a chart with multiple visible lines
- **THEN** exactly one tooltip is rendered for that chart, its value lines are separated vertically and colored to match their line tokens, and each value has a marker at the same elapsed x-position

### Requirement: Progressive responsive SVG chart groups

One route-scoped session controller SHALL own metadata, history revision, captured gap policy, the shared elapsed viewport, request generations, bounded cache, and independent loading/error state for series groups and events. After measuring a positive width it SHALL load the first visible stable group, use one reusable intersection boundary to prefetch nearby stable or extension groups for the current viewport, and abort or ignore obsolete work on resize, snapshot or revision replacement, gap-policy change, navigation, or frontend recreation. Stable groups SHALL contain at most nine fields and negotiated extensions SHALL be chunked into groups of at most eight. Cache ownership SHALL be bounded by both entry count and decoded bytes.

#### Scenario: Initial visible group

- **WHEN** metadata is available and the first chart group has a positive measured width
- **THEN** that group is requested before offscreen groups and produces a useful overview without waiting for the complete catalog

#### Scenario: Scroll to a later group

- **WHEN** a later group approaches the viewport after zoom or pan changed the shared range
- **THEN** the reusable loader requests that group for the newest snapshot, range, and measured resolution rather than the original overview

#### Scenario: Responsive resize

- **WHEN** the chart width changes repeatedly during layout or orientation changes
- **THEN** integer CSS-pixel bucket targets are coalesced and geometry converges on the latest width without fetching lossless history or duplicating equivalent requests

#### Scenario: Frontend recreation

- **WHEN** the WebView or route controller is replaced
- **THEN** native logging continues, obsolete requests/cache are released, and a new controller reconstructs metadata and visible history from the backend

### Requirement: Shared bounded historical viewport

All loaded charts SHALL share one inclusive elapsed viewport bounded by the published session range with a minimum one-millisecond span. Visible native buttons SHALL provide zoom in/out, pan earlier/later, and full-duration reset. During a pan or pinch, current bounded paths SHALL provide animation-frame transform/clip feedback without a series request per pointer move; after input settles, the controller SHALL abort the prior generation, request refined current-resolution geometry, and render only a response matching the newest session, history revision, snapshot, gap policy, fields, range, buckets, and generation. An uncached settled pan or zoom SHALL target 250 milliseconds on the iPhone 12 and Samsung Galaxy S9 reference devices; exceeding the target SHALL NOT turn a bounded cancellable operation into a correctness failure.

#### Scenario: Pinch into a short incident

- **WHEN** two touch contacts narrow a four-hour overview to a short elapsed range
- **THEN** the current SVG responds during the gesture and the settled chart replaces it with extrema-preserving range data within the target

#### Scenario: Range zoom

- **WHEN** a background drag selects an elapsed range near either session edge
- **THEN** the selected range remains clamped to the published session bounds, superseded work is cancelled, and the newest matching response wins

#### Scenario: Full-range reset

- **WHEN** reset is activated by pointer, keyboard, or assistive technology
- **THEN** all chart groups return to the published complete elapsed range through the same bounded request model

### Requirement: Synchronous crosshair tooltip presentation

Crosshair position SHALL map to elapsed time, and each loaded chart group SHALL derive its tooltip values synchronously from the loaded series at that position. One shared crosshair SHALL synchronize elapsed position across the charts without issuing an exact-value lookup request. Tooltips SHALL show the field label, formatted value, and unit, remain within the visible viewport, keep the inspected field markers visible, and not intercept plot pointers. Pointer leave SHALL dismiss the inspection, and newer series geometry SHALL keep the crosshair and tooltip position coherent.

#### Scenario: Shared chart inspection

- **WHEN** pointer or touch inspection activates an elapsed position
- **THEN** every chart with loaded data renders its own tooltip from the corresponding loaded series values at the shared position

#### Scenario: Tooltip near an edge

- **WHEN** inspection occurs near a chart edge
- **THEN** the tooltip repositions within the visible chart viewport without obscuring or capturing the plot pointer

### Requirement: Range-bound historical transition pages

The session feature SHALL request chronological transition pages for the current history revision, snapshot, and visible elapsed range, preserve deterministic order without duplicate rows, expose explicit continuation controls, and discard the cursor/page collection when the revision, snapshot, or range changes. It SHALL never automatically accumulate all session transitions in memory.

#### Scenario: Continue events

- **WHEN** more than 500 transitions exist in the visible range and the user requests continuation
- **THEN** the next validated page appends in chronological order without duplicates or loss

#### Scenario: Viewport changes during paging

- **WHEN** the user pans or zooms after one or more event pages loaded
- **THEN** old pages and cursors cannot populate the new range and the first new-range page becomes authoritative

### Requirement: Completed and growing session query compatibility

The route-scoped controller SHALL use one published metadata revision and snapshot for every historical request and SHALL be able to replace either with newer metadata without replacing its querying, caching, rendering, tooltip, or event model. A history-revision change SHALL abort and discard every older cache entry, cursor, and series response before refreshing. This change SHALL continue to enter history through the sessions screen; presenting active-session history from the live screen and presenting ride-prune controls are deferred.

#### Scenario: Completed session

- **WHEN** the user opens a completed session
- **THEN** overview, zoom, retained-window, and event queries use its stable final revision and boundary and disclose whether the ride was pruned

#### Scenario: Future active-session entry point

- **WHEN** a future live-screen feature supplies newer active-session metadata
- **THEN** the existing historical controller can refresh the growing ride through the same protocol and rendering model

#### Scenario: Ride pruned outside the route

- **WHEN** refreshed metadata reports a newer history revision
- **THEN** the controller rejects every stale result and reconstructs the viewport from retained history without claiming that removed samples remain exact

### Requirement: Configurable historical continuity threshold

The shared settings UI SHALL expose an optional history-gap threshold stored in seconds. It SHALL accept only finite values from 0.1 through 3,600, SHALL allow the value to be cleared to automatic mode, and SHALL explain that automatic mode uses ride phase, persistence cadence, and retained pruning resolution. A settings revision SHALL invalidate series geometry whose cache key captured another gap policy without invalidating retained sample rows solely because continuity presentation changed.

#### Scenario: Set explicit threshold

- **WHEN** a user saves a valid threshold in seconds
- **THEN** subsequent chart requests and cache keys capture that value and gaps appear wherever an elapsed delta exceeds it

#### Scenario: Restore automatic gaps

- **WHEN** the user clears the configured value
- **THEN** subsequent charts use the phase- and resolution-aware derived default and explain that automatic mode is active

### Requirement: Live location option and warning

The live dashboard SHALL present a small non-blocking location option or warning whenever recording is disabled, permission is unresolved/denied, or location is unavailable while a board is connected. The warning SHALL not obscure board telemetry or prevent disconnect/configuration actions.

#### Scenario: Recording disabled

- **WHEN** a board is connected and `locationRecordingEnabled` is false
- **THEN** the live view offers the location-recording option without claiming that permission is missing

#### Scenario: Permission required

- **WHEN** recording is enabled but location permission is unresolved or denied
- **THEN** the live view shows a compact warning that identifies location recording as unavailable and provides the permission action

#### Scenario: Board-only fallback

- **WHEN** the user leaves location disabled or declines permission
- **THEN** the live dashboard continues presenting current board telemetry and session summaries with no map requirement

### Requirement: Re-prompt or settings activation

Activating the live location option/warning SHALL invoke the shared contract permission action. The frontend SHALL not perform platform detection; the backend SHALL choose an OS re-prompt when possible or platform settings navigation otherwise.

#### Scenario: Re-prompt available

- **WHEN** the user activates the warning and the OS allows another permission prompt
- **THEN** the native backend presents the prompt and publishes the resulting status

#### Scenario: Settings required

- **WHEN** the user activates the warning after a permanent denial or restricted state
- **THEN** the native backend presents the platform settings destination or reports a bounded unavailable error while board logging remains active

### Requirement: Location status recovery

The live dashboard SHALL derive its warning and option from complete authoritative state and SHALL recover it after a frontend recreation without storing permission state only in the WebView.

#### Scenario: Recreated live view

- **WHEN** the live WebView reconnects during an active session
- **THEN** it renders the current location status/action availability from `state.get` and does not require a new board connection

### Requirement: Conditional BMS menu action

The shared live-board menu SHALL contain one `BMS` action after at least one VBMS identity has been detected in the current connection generation and SHALL omit it while no BMS identity is known or status is `not_found`. The same frontend behavior SHALL apply on desktop and touch clients without platform branching.

#### Scenario: BMS becomes detected

- **WHEN** auxiliary discovery identifies a direct or CAN-routed VBMS
- **THEN** the next authoritative state causes the live menu to expose the BMS action

#### Scenario: No BMS detected

- **WHEN** auxiliary discovery is incomplete without a candidate or completes as `not_found`
- **THEN** the live menu contains no BMS action and controller telemetry remains unchanged

#### Scenario: Ambiguous or unavailable BMS

- **WHEN** detected BMS state is `ambiguous` or `unavailable`
- **THEN** the BMS action remains available so the user can inspect status and corrective guidance

### Requirement: Responsive BMS sheet presentation

Activating the BMS menu action SHALL open the shared responsive sheet/popover and render only authoritative BMS state. The presentation SHALL show route, status, observation freshness, summary voltage/current/state-of-charge/state-of-health values, cell voltages and balancing, sensor and device temperatures, humidity and pressure, session and lifetime counters, and optional data-version and status values, using explicit unavailable placeholders and the configured unit system where conversion applies.

#### Scenario: Attached BMS values

- **WHEN** the BMS sheet opens with an attached complete snapshot
- **THEN** readings have stable labels and bounded cell voltage rows follow the reported cell order

#### Scenario: Version 1 BMS temperatures

- **WHEN** BMS data version 1 reports the five fixed temperature readings
- **THEN** the temperature section groups the coldest and hottest cell probe readings and the individual probes under Battery cells, with individual probes in reported order
- **AND** the chip, MOSFET, ambient, and humidity sensor temperatures appear under BMS and environment, with chip and hottest-cell readings shown once each
- **AND** unavailable temperatures retain a visible placeholder

#### Scenario: Other BMS temperature layouts

- **WHEN** the data version is absent or unrecognized, or version 1 reports fewer than five temperature entries
- **THEN** the temperature section numbers the sensor readings in source order and shows the separate IC, highest cell, and humidity sensor readings

#### Scenario: Stale retained values

- **WHEN** status is unavailable and a prior snapshot remains
- **THEN** the sheet visibly marks the values stale and shows their age rather than presenting them as current

#### Scenario: Multiple BMS candidates

- **WHEN** status is ambiguous
- **THEN** the sheet lists bounded CAN-ID-sorted display-safe candidates, polls none, and directs the user to set `preferredBmsCanId` in Board Profile

#### Scenario: Frontend recreation with open route

- **WHEN** the WebView is recreated and navigates back to the live board while detected BMS state remains authoritative
- **THEN** the menu and newly opened sheet reconstruct without requesting historical or platform-specific BMS data

### Requirement: Accessible BMS interactions

The BMS menu action and sheet SHALL retain native button and dialog semantics, use primary Pointer Events with cancellation and a guarded keyboard or assistive-technology click path, prevent double activation, apply an appropriate `touch-action`, contain and restore focus, and keep dismissal usable on desktop and touch clients.

#### Scenario: Primary pointer activation

- **WHEN** a primary pointer activates the enabled BMS action in a frequently updating live view
- **THEN** exactly one sheet opens and the synthesized click does not activate it again

#### Scenario: Non-primary pointer activation

- **WHEN** a non-primary pointer activates the BMS action
- **THEN** no sheet opens

#### Scenario: Keyboard activation and dismissal

- **WHEN** a focused BMS action is activated by keyboard and the sheet is later dismissed
- **THEN** it opens exactly once, exposes meaningful dialog labeling, and restores focus to the invoking action

### Requirement: Dedicated standalone BMS page

The shared frontend SHALL route an active connection with authoritative `deviceKind: bms` to a dedicated full-page BMS experience that reuses the same BMS content component as the live-board sheet. The page SHALL present authoritative status, freshness, values, unavailable state, and units, expose disconnect, and omit board views, Refloat controls, controller shutdown, Board configuration, ride state, and session controls.

#### Scenario: Standalone BMS becomes classified

- **WHEN** an accepted asynchronous connection publishes `deviceKind: bms`
- **THEN** the frontend replace-navigates to the BMS page and renders the current authoritative BMS state

#### Scenario: Board connection remains live

- **WHEN** the active connection publishes `deviceKind: board`
- **THEN** the frontend uses the existing live-board page and retains the BMS sheet for any auxiliary BMS

#### Scenario: Frontend recreation

- **WHEN** the WebView is recreated while a BMS-only connection remains active
- **THEN** bootstrap state routes directly to the BMS page without restarting native discovery or polling

#### Scenario: BMS disconnect

- **WHEN** the user activates disconnect from the standalone BMS page
- **THEN** the shared device disconnect method runs once and successful authoritative removal returns navigation to Home

#### Scenario: Route mismatch

- **WHEN** the BMS page observes no active connection or a board connection, or the live page observes a BMS connection
- **THEN** it replace-navigates to Home or the authoritative connection-kind route without exposing incompatible controls

### Requirement: Generated Refloat configuration experience

The live-board action surface SHALL present `Configure Refloat` after configuration discovery begins and `Tunes…` when an exact supported package identity is available. Configure Refloat SHALL open a full-height responsive editor generated from bounded normalized schema pages, with a native selector that presents one logical schema subgroup at a time, search scoped to the selected subgroup, typed controls, on-demand sanitized help, source selection between current and defaults, dirty and validation state, a bounded write diff, explicit persistent-write confirmation, operation progress, and unsaved-change handling. The editor SHALL combine consecutive or non-consecutive transport pages with the same exact group and subgroup identity into one ordered logical subgroup without changing complete-editor draft, validation, or write behavior. Each field SHALL expose a `(?)` help button instead of permanently rendering its description; activation SHALL open a non-urgent modal dialog containing that field's label and help text, with bounded dismissal, focus containment, and focus restoration. Persistent schema fields such as LEDs On and Headlights On SHALL be labelled as startup defaults, while the live boxes SHALL label the dedicated lighting controls as current runtime state. In flywheel mode schema/default inspection may remain available, but reading current, editing or saving from current, persistent write, and Tune apply SHALL be visibly unavailable until normal mode and a fresh current read are established. It SHALL never render raw XML or infer protocol encodings. Every interactive control MUST retain native semantics, primary-pointer cancellation behavior, guarded keyboard/assistive click behavior, and focus restoration without double activation.

#### Scenario: Open generated editor

- **WHEN** a user opens Configure Refloat on a ready supported connection
- **THEN** the editor loads current values, selects the first available logical subgroup, and renders only that subgroup's schema-defined fields with their types, choices, units, bounds, and steps

#### Scenario: Navigate schema subgroups

- **WHEN** the user selects another subgroup
- **THEN** the editor replaces the visible fields with that logical subgroup while preserving all draft values, validation state, dirty state, and schema order across the complete configuration

#### Scenario: Chunked logical subgroup

- **WHEN** one schema group and subgroup is delivered across multiple bounded transport pages
- **THEN** the selector exposes one option for that exact pair and the selected logical subgroup contains all of its fields in received order

#### Scenario: Ambiguous subgroup labels

- **WHEN** more than one schema group contains the same subgroup name
- **THEN** the selector qualifies those otherwise ambiguous option labels with their group and retains each exact group/subgroup pair as a distinct destination

#### Scenario: Search selected subgroup

- **WHEN** the user searches while a subgroup is selected
- **THEN** only that subgroup's fields are filtered using its group, subgroup, field name, label, and help text, navigation does not change, and an empty match is visibly reported

#### Scenario: Show field help

- **WHEN** the user activates a field's `(?)` help button by primary pointer, keyboard, or assistive click
- **THEN** exactly one modal dialog shows the field's presented label and sanitized help text, contains one explicit dismissal action, supports Escape and backdrop dismissal, contains focus while open, and restores focus to the triggering button when dismissed

#### Scenario: Load package defaults

- **WHEN** the user selects Read default values
- **THEN** the draft changes to the complete device-reported defaults, is visibly marked as not yet written, current board state remains unchanged, and the selected subgroup is retained

#### Scenario: Confirm persistent write

- **WHEN** an eligible valid draft differs from the latest current values, including values changed outside the selected subgroup
- **THEN** the UI presents a bounded complete field diff and warning and sends exactly one complete write only after explicit confirmation

#### Scenario: Invalid or read-only draft

- **WHEN** any field is invalid including a field outside the selected subgroup, the connection is not writable, safety state is ineligible, or schema/current identity is stale
- **THEN** Write is visibly unavailable and no mutation request is sent

#### Scenario: Reconnect while editing

- **WHEN** the board reconnects while an editor draft is dirty
- **THEN** editing becomes non-writable and the draft is not applied until the active schema/current identity is re-established and explicitly reconciled

#### Scenario: Schema replacement changes navigation

- **WHEN** schema replacement removes the selected exact group/subgroup identity
- **THEN** the editor falls back to the first available logical subgroup rather than retaining a stale selection

#### Scenario: Flywheel while editing

- **WHEN** authoritative state enters flywheel while the editor is open
- **THEN** current values and any current-based draft become stale, all device-write actions except the separate eligible flywheel-disable control are unavailable, and a fresh current read is required after normal mode returns

#### Scenario: Runtime and persistent lighting

- **WHEN** runtime lighting differs from `leds.on` or `leds.headlights_on` in the configuration
- **THEN** the UI presents the values as current runtime override and persistent startup default respectively rather than implying they have diverged accidentally

### Requirement: Exact-version Tunes experience

Tunes SHALL present bounded named full Refloat configurations applicable to the active exact package version and schema signature, support create/rename/describe/delete with revision-conflict recovery, show a bounded diff from current values, and apply only through the normal persistent-write confirmation and verification flow. UI copy SHALL identify these records as complete Refloat configurations and MUST NOT claim compatibility with upstream Refloat's curated QML Tune subset or migrations.

#### Scenario: Matching Tunes

- **WHEN** Tunes opens for a supported active package
- **THEN** it lists only applicable exact-version/signature records with bounded metadata

#### Scenario: Apply Tune

- **WHEN** the user confirms an eligible saved configuration whose values differ from a fresh normal-mode current revision
- **THEN** the frontend sends one apply request and reports success only after native readback verification

#### Scenario: Version changes

- **WHEN** the connected Refloat exact version changes
- **THEN** records from the former version disappear from the applicable list and are not silently transformed

### Requirement: Shared estimated battery percentage in live views

The live power widget and detailed view SHALL prefer the authoritative estimated fraction rounded to the same nearest integer percentage. For a saved board whose estimate is unavailable specifically because battery configuration is incomplete, both SHALL instead display the controller-reported fraction rounded identically when it is finite and in [0,1]. Text, widget fill, color thresholds, and accessible percentage SHALL use the selected source consistently. The primary detailed value and accessible widget value SHALL identify whether the percentage is estimated or controller-reported, and the detailed view SHALL retain the separate “Controller-reported battery level” raw value. Both SHALL retain existing stale/dimmed connection behavior, charging indication, and raw pack voltage. Widget per-cell voltage SHALL use the same resolved series count as estimation and be unavailable when no count can be resolved. Guests, BMS-only connections, and estimate failures other than incomplete configuration SHALL retain unavailable primary percentages rather than acquire this fallback.

#### Scenario: Controller percentage disagrees

- **WHEN** an active sample reports controller level 0.8 and the shared estimate is 0.5
- **THEN** both primary percentage displays and widget fill use 50 percent
- **AND** the detailed controller-reported field shows 80 percent

#### Scenario: Missing estimate

- **WHEN** a saved board lacks estimation configuration and reports battery level 0.8
- **THEN** both primary percentage displays and widget fill use 80 percent with controller-reported source semantics and a battery setup warning
- **AND** pack voltage remains visible and per-cell voltage is unavailable if no series count is resolved

#### Scenario: Reported zero or unavailable value

- **WHEN** a saved board lacks estimation configuration
- **THEN** a reported fraction of zero displays 0 percent
- **AND** a missing, non-finite, or out-of-range reported fraction displays the unavailable placeholder without fabricated fill
- **AND** the battery setup warning remains available in either case

#### Scenario: Other estimate failures

- **WHEN** estimation is unavailable because of a series mismatch, missing voltage, or a guest or BMS-only connection
- **THEN** the primary percentage stays unavailable and the missing-configuration fallback and setup warning are not shown

#### Scenario: Connection becomes nonready

- **WHEN** the last sample and matching estimate are retained while reconnecting
- **THEN** both views retain the same selected percentage and source using their existing dimmed/stale presentation

### Requirement: Saved board battery estimation controls

The saved-board editor SHALL provide a Basic/Advanced segmented control shared with the battery-only modal. Basic SHALL offer a manufacturer-grouped select of named battery variants and a concise summary of actual configured values. Advanced SHALL offer bounded cell-profile choices, series/parallel inputs, optional full-pack capacity, and display-empty voltage per cell, explaining the 3.0 V default and that it changes the displayed estimate, not firmware protection thresholds. Selecting a preset SHALL use its configured generic profile internally when a dedicated curve is absent; Basic SHALL NOT display a generic/approximation label, missing-curve warning, or extra confirmation for this case. Controls SHALL use existing revisioned save behavior, be accessible to keyboard and primary-pointer input on desktop and touch, and preserve configuration across view recreation. Missing estimation configuration SHALL NOT introduce a general profile-completeness warning or block unrelated board operations; the contextual live battery setup warning SHALL remain distinct.

#### Scenario: Configure a saved board

- **WHEN** the user selects P45B, valid pack counts, and a valid empty voltage
- **THEN** the configuration is saved through the existing profile request and both live views use the resulting shared estimate

#### Scenario: Keyboard and touch configuration

- **WHEN** the user activates or changes an estimation control with keyboard or primary touch input
- **THEN** the intended interaction occurs once without duplicate saves caused by synthesized clicks

### Requirement: Contextual battery configuration modal

Both live views SHALL provide a small warning icon button next to the primary battery percentage when the saved board is missing estimation configuration. Its accessible name SHALL communicate that battery setup is required. Activating it SHALL open a modal explaining the board-reported fallback and presenting the same Basic/Advanced battery form as the full board editor: named preset selection and summary in Basic; cell profile, series count, parallel count, optional pack capacity, and display-empty voltage in Advanced, with identical validation and save semantics. The modal SHALL expose a title, focus containment, keyboard dismissal, and focus restoration. Only one board configuration modal SHALL be active at a time.

#### Scenario: Open battery setup

- **WHEN** the warning is activated by primary mouse, primary touch, keyboard, or assistive technology
- **THEN** exactly one battery configuration modal opens for that saved board with existing values populated
- **AND** unrelated board configuration controls are absent

#### Scenario: Cancelled or non-primary activation

- **WHEN** a pointer gesture is cancelled or a non-primary pointer activates the warning
- **THEN** no modal opens

#### Scenario: Configuration becomes complete

- **WHEN** valid battery settings are saved and the authoritative state supplies an estimate
- **THEN** both views switch to the estimate and remove the warning without reconnecting
- **AND** an already open battery modal remains open until dismissed

#### Scenario: Validation or persistence failure

- **WHEN** entered values are invalid, a save fails, or a profile revision conflicts
- **THEN** the user receives validation or save feedback and the UI does not claim those changes were saved
- **AND** percentage and warning changes follow accepted authoritative state only

#### Scenario: Close and reopen

- **WHEN** the user closes the modal after a valid edit
- **THEN** the pending field edit participates in the existing serialized save flow before ordinary closure completes
- **AND** focus returns to the warning or a stable Live control if the warning no longer exists
- **AND** reopening or recreating the view reads persisted configuration

#### Scenario: Telemetry and board lifecycle

- **WHEN** telemetry refreshes or the same saved board reconnects while the modal is open
- **THEN** unrelated updates do not erase in-progress input or multiply open editors
- **AND** if the active board identity changes or the edited board is removed, the editor is invalidated without applying its queued edits to another board

### Requirement: Named presets and non-destructive setup modes

An unconfigured battery or saved named preset SHALL open in Basic; an existing partial or custom battery without preset identity SHALL open in Advanced. Changing modes SHALL preserve drafts and saved values without issuing a save or resetting defaults, including preventing a toggle-induced blur from committing a field. Custom selection SHALL open Advanced without changing stored settings. An explicit named preset selection SHALL apply all battery defaults as one revisioned operation, preserve unrelated profile values, and retain its selected name across reopening and view recreation. The system SHALL NOT infer a branded preset from matching electrical settings or controller identity. Advanced S/P/profile changes departing from the preset SHALL clear the preset identity atomically; capacity and display-empty overrides SHALL retain it. Effective manual S/P changes SHALL clear prior capacity unless the same patch explicitly replaces it; curve-only changes SHALL retain capacity. Advanced SHALL offer an explicit reset to a named battery's defaults without relying on selecting an unchanged option. Basic SHALL summarize actual saved/draft values, including blank or overridden capacity, rather than silently restore nominal values. Failed saves SHALL remain visible as unsaved drafts; authoritative percentage changes SHALL use accepted state only.

#### Scenario: One-step named setup

- **WHEN** an unconfigured saved board selects Floatwheel ADV2
- **THEN** one save applies its identity, 20S2P counts, Samsung 50S profile, 10 Ah nominal capacity, and 3.0 V display-empty default
- **AND** both editors reopen with that name and the accepted values

#### Scenario: Preset without a dedicated curve

- **WHEN** a rider selects Funwheel X7S with P30B cells
- **THEN** setup applies 20S2P, 6 Ah nominal capacity, and the generic profile internally
- **AND** Basic shows the battery name and summary without a generic/approximation label, warning, or additional confirmation
- **AND** valid telemetry can produce an estimate without a missing-configuration warning

#### Scenario: Switching modes with a draft

- **WHEN** a user switches modes after entering a valid or invalid Advanced draft
- **THEN** the draft remains available, no field or preset is saved because of the switch, and switching back restores the same input

#### Scenario: Custom battery and overrides

- **WHEN** a user chooses Custom, edits S/P/profile, or overrides capacity or empty voltage
- **THEN** choosing Custom alone saves nothing, departing S/P/profile clears identity with the edit, effective count changes clear capacity unless explicitly replaced, and capacity/empty overrides retain identity
- **AND** returning to Basic preserves all values and never automatically selects a brand or restores defaults

#### Scenario: Equivalent packs and recreation

- **WHEN** two presets share the same electrical configuration and one is selected successfully
- **THEN** reopening identifies the selected preset by its persisted identity rather than substituting the other name

#### Scenario: Pending selection and failure

- **WHEN** a preset save is pending, rejected, or conflicts while telemetry continues
- **THEN** the draft and save status remain visible, no partial defaults are published, and the live percentage remains tied to accepted configuration
- **AND** rapid selections are serialized and board invalidation cannot redirect pending work

### Requirement: Pack capacity and temporal estimate explanation

Battery configuration SHALL offer optional full-pack capacity in Ah with validation from 0.1 through 200. Basic preset selection SHALL provide sourced nominal capacity when known and a summary of actual configured values; Basic SHALL NOT require capacity entry or expose a generic/approximation label or missing-curve warning. Advanced SHALL allow manual capacity entry, override, and clear, and explain that parallel cells multiply cell Ah while series cells do not. Advanced help or battery details SHALL explain that absent capacity uses a smoothed voltage estimate, while capacity enables charge tracking with gradual settled-voltage correction. Battery help or detailed presentation SHALL identify the current estimation method and provisional status without implying measured absolute accuracy. The full board editor and battery-only configuration surface SHALL use the same Basic/Advanced field semantics and revisioned persistence. Mode switches, reads, and reconnects SHALL NOT restore cleared or overridden capacity; explicit preset selection SHALL restore its defaults. Capacity SHALL NOT be inferred from a curve name or series count. Missing capacity SHALL NOT trigger the missing-configuration warning or controller-reported fallback. Both live views SHALL use the same authoritative temporal percentage, while raw voltage, raw controller percentage, charging state, and firmware alerts SHALL retain their existing responsiveness.

#### Scenario: Optional capacity entry

- **WHEN** a user enters 9 Ah for a 2P pack using 4.5 Ah cells
- **THEN** the saved capacity is 9 Ah regardless of series count and invalid entries receive validation feedback

#### Scenario: No capacity supplied

- **WHEN** an otherwise configured board has no capacity
- **THEN** its voltage-smoothed estimate remains available and no missing-configuration warning is added because of capacity

#### Scenario: Provisional estimate

- **WHEN** a connection starts under load or resumes after missing telemetry
- **THEN** battery help or details identifies the estimate as provisional until settled convergence

#### Scenario: Sudden voltage sag

- **WHEN** load sharply reduces measured voltage while the tracked percentage changes slowly
- **THEN** voltage and any firmware low-voltage alert update normally without waiting for percentage smoothing

#### Scenario: Shared controls and input

- **WHEN** capacity is edited from the full board editor or an available battery-only modal using primary pointer or keyboard
- **THEN** validation and saving behave identically, occur without duplicate activation, and accepted values survive view recreation

#### Scenario: Preset nominal capacity and override

- **WHEN** a rider selects an ADV2 preset
- **THEN** the saved pack capacity is 10 Ah and Basic summarizes nominal capacity without requiring manual cell calculations
- **WHEN** the rider changes capacity to 8.7 Ah or clears it in Advanced and returns to Basic
- **THEN** the entered value or absence remains through reconnect and view recreation, and no mode switch reapplies the nominal value

#### Scenario: Generic curve with capacity

- **WHEN** a preset with no dedicated curve has valid nominal capacity and observed current
- **THEN** the shared estimator can track charge with its generic voltage observation
- **AND** Basic shows its familiar battery name without generic/approximation wording or a missing-curve warning

#### Scenario: Deliberate preset reset

- **WHEN** a user explicitly re-selects a preset after overriding or clearing capacity
- **THEN** the preset's capacity and other battery defaults are restored in one accepted revision

### Requirement: Hold to configure live boxes

The five live boxes SHALL be configured by a primary-pointer hold, with no short-tap configuration. A completed hold SHALL NOT trigger a tap action. Movement, cancellation, lost capture, hiding and disposal SHALL cancel pending holds. Keyboard and assistive users SHALL have equivalent configuration access. New settings SHALL default to Empty, Wattage, Session timer, Odometer and centre Trip distance; Empty SHALL display Hold to set.

#### Scenario: Hold and cancel

- **WHEN** the user holds a box without moving
- **THEN** the shared picker opens once, while a short numeric tap, cancelled gesture, moved gesture or non-primary pointer opens nothing

#### Scenario: Keyboard configuration

- **WHEN** a keyboard or assistive user configures any box
- **THEN** the same picker and revisioned save flow are available with dismissal and focus restoration

### Requirement: Configurable runtime lighting boxes

The slot catalogue SHALL include Empty, Headlights and LEDs alongside numeric readings. Lighting boxes SHALL display confirmed runtime state and toggle on short tap through existing lighting requests. Unknown, unavailable, read-only, reconnecting and pending states SHALL block mutation while allowing configuration. A hold SHALL configure without changing lights. Accepted settings SHALL persist across frontend and host recreation.

#### Scenario: Tap and confirmation

- **WHEN** an eligible lighting box is tapped
- **THEN** exactly one request is sent, pending feedback retains the confirmed state, and only authoritative updates change the switch

#### Scenario: Hold lighting or failure

- **WHEN** the user holds a lighting box or its toggle request fails
- **THEN** holding opens configuration without toggling, and failure retains confirmed state with visible feedback

#### Scenario: Persist choices

- **WHEN** any combination of five valid numeric, empty or lighting choices is saved
- **THEN** both host integrations retain the exact choices and reject unknown fields or an invalid slot count

### Requirement: Maximum speed dashboard reading

Live slots and Custom widgets SHALL offer Max speed from the same authoritative current-ride peak. It SHALL use the selected speed units and one decimal place, show unavailable data consistently, and support the existing numeric widget presentations and revisioned settings/profile saves on both hosts.

#### Scenario: Shared metric and imperial display

- **WHEN** Max speed is selected in Live and Custom
- **THEN** both show the same current-ride peak in km/h or mph according to the unit preference

#### Scenario: Configuration and recreation

- **WHEN** a Max speed choice is saved and the view is recreated
- **THEN** the choice survives and displays the shared current-ride peak without starting another collector

### Requirement: Explicit live view selection

The live header SHALL expose directly selectable Live, Detailed and Custom choices for saved boards, indicate the selected view, and support hold-to-edit widgets in Custom. Guest connections SHALL retain Live and Detailed without Custom. Selecting a view SHALL NOT change connection, recording or telemetry policy.

#### Scenario: Select any eligible view

- **WHEN** a saved-board user opens the view choices
- **THEN** all three views are labelled and directly reachable without cycling through another view

#### Scenario: Guest connection

- **WHEN** the active connection is a guest
- **THEN** existing Live and Detailed views remain accessible and no durable dashboard is created

### Requirement: Parent-owned live warning overlay

Firmware-fault and Refloat-disabled warnings SHALL appear above Live, Detailed and Custom independently of widget selection and scrolling, with accessible text and existing action gates. Menus and dialogs SHALL NOT contain warning panels. Modal presentation SHALL conceal and disable the dashboard presenter without shifting its layout. Authoritative safety modals SHALL retain precedence.

#### Scenario: Dashboard without a gauge

- **WHEN** a firmware fault or Refloat-disabled state occurs in a custom dashboard with no gauge
- **THEN** the warning remains visible with its eligible action and is not duplicated in a widget

#### Scenario: Editing and safety precedence

- **WHEN** a warning appears while configuring a widget
- **THEN** warning panels are concealed and inert behind the modal, remain outside it and reappear on the dashboard after dismissal
- **WHEN** authoritative flywheel state requires its non-dismissible safety overlay
- **THEN** that overlay retains its existing exclusive interaction policy

### Requirement: Shared bounded live trend history

Custom charts and the live-chart overlay SHALL share one in-memory history for the active live screen, limited to 30 seconds and 1,500 points total. History SHALL consume existing delivered samples without additional telemetry requests, durable writes or background collection. Duplicate sample sequences SHALL NOT append duplicate points.

#### Scenario: Several chart widgets

- **WHEN** several custom charts and the live-chart overlay display the same connection
- **THEN** they read one retained sample history, and telemetry cadence, recording cadence and retained point capacity do not increase with chart count

#### Scenario: Switch views or edit

- **WHEN** the user changes live view, resizes, edits widgets or opens and closes the chart overlay
- **THEN** retained history remains available for the same connection within its time and point limits

### Requirement: Live trend continuity and disposal

Trends SHALL preserve missingness and gaps, reject stale arrivals as fresh points, and avoid joining samples across connection generations. Device changes, new generations and sequence resets SHALL clear incompatible history. Leaving the live screen or destroying the frontend SHALL release history and timers. Recreation SHALL begin with empty history and SHALL NOT replay collection or controls.

#### Scenario: Reconnect or sample sequence reset

- **WHEN** a connection generation changes or sample sequence resets
- **THEN** old points are not joined to new samples, while the board's dashboard configuration remains intact

#### Scenario: Missing interval

- **WHEN** no fresh sample arrives for an interval longer than the existing live-chart continuity threshold
- **THEN** trends show a gap or waiting state rather than a fabricated continuous trace

#### Scenario: Frontend replacement or screen exit

- **WHEN** the live screen is disposed or the frontend is recreated
- **THEN** its history and timers are released, and recreated charts begin from fresh delivered samples without reading saved sessions to refill the live buffer

### Requirement: Live battery voltage warning presentation

Standard and custom battery widgets SHALL display the service-confirmed low/overVoltage warning independently of speech settings and cooldown. They SHALL show an icon, Battery low / Over voltage label, amber voltage and a full-track amber outline breathing over three seconds. High warnings SHALL add diagonal hatching. Warnings SHALL override charging animation, preserve actual fill/percentage and use no firmware fault display. Reduced motion SHALL keep steady warning cues.

#### Scenario: Low charge remains visible

- **WHEN** a low warning is confirmed at one percent charge
- **THEN** the whole track outline and Battery low label remain visible while the fill and value remain one percent

#### Scenario: High warning overrides charging

- **WHEN** an over-voltage warning is confirmed while charging
- **THEN** Over voltage, an amber outline and diagonal hatching replace the charging animation without changing the reported charge

#### Scenario: Speech is disabled

- **WHEN** battery speech is disabled, muted, unavailable or cooling down
- **THEN** a confirmed fresh warning remains visible in all battery widget sizes

#### Scenario: Recovery or invalid context

- **WHEN** the shared warning recovers, telemetry becomes stale or the connection/configuration is invalidated
- **THEN** the widget removes warning presentation according to the authoritative snapshot

#### Scenario: Reduced motion

- **WHEN** reduced motion is preferred
- **THEN** labels, steady outlines and high-voltage hatching remain with no warning animation

### Requirement: Independent visual voltage qualification

Visual battery warnings SHALL use fresh unrounded voltage from the ready selected non-BMS board independently of riding state, regen and speech eligibility. No frontend or host SHALL derive voltage thresholds. Speech thresholds, eligibility, confirmation and cooldown SHALL remain unchanged.

#### Scenario: Independent configuration availability

- **WHEN** a guest has valid Refloat limits but no cell profile, or a saved configured board has no valid Refloat limits
- **THEN** the guest can show low but cannot guess high; the configured saved board can show high without guessing low

### Requirement: Earlier low visual threshold

Low visuals SHALL use current resolved Refloat limits L < H and R = H − L, entering strictly below L + 0.25R after two continuous seconds, immediately at or below L. Low SHALL recover after two continuous seconds at or above L + 0.27R. Unavailable Refloat limits SHALL disable low independently of high.

#### Scenario: Earlier low visual without speech

- **WHEN** configured Refloat limits are 60/86 V and fresh voltage stays below 66.5 V but above 62.6 V for two seconds
- **THEN** the widget shows Battery low, including while stationary, without triggering low speech; recovery requires two continuous seconds at or above 67.02 V

### Requirement: Immediate above-full visual threshold

High visuals SHALL enter immediately strictly above the configured cell profile's zero-current full-charge voltage multiplied by its validated series count, independently of capped estimated percentage. High SHALL recover after two continuous seconds at or below 99.5% of that voltage and take priority over low. Missing, invalid or mismatched estimation configuration SHALL disable high independently of low.

#### Scenario: Immediate above-full visual

- **WHEN** a valid configured profile has a full-charge pack voltage of 84 V and the first fresh measurement is strictly above 84 V while stationary or drawing power
- **THEN** the widget immediately shows its high warning even if the estimated percentage is capped at 100, without triggering speech solely because of that visual state

#### Scenario: Equality and recovery

- **WHEN** voltage equals the full-charge voltage with no active warning, or an active high warning falls briefly below its recovery boundary
- **THEN** equality does not enter high and brief recovery does not clear it; sustained fresh recovery for two seconds clears it

### Requirement: Visual freshness and context isolation

Visual inputs SHALL be less than two seconds old. Gaps of at least two seconds and changed threshold, controller or connection context SHALL reset qualification. Profile edits that change or invalidate visual thresholds SHALL clear prior qualification and require subsequent fresh samples.

#### Scenario: Gap or profile edit

- **WHEN** observations stop for at least two seconds or the configured profile changes
- **THEN** prior warning qualification clears and the next sample cannot bridge confirmation or recovery across the gap or edit

### Requirement: IMU timeout warning and historical presentation

The live dashboard SHALL identify an active IMU timeout as a Refloat error without calling it a controller firmware fault or fatal latch. The existing history experience SHALL present timeout activation and clearing beside firmware faults under inclusive wording. A retained IMU stop reason SHALL remain visible as a stop reason after the active error clears.

#### Scenario: Concurrent alerts

- **WHEN** an IMU timeout and controller firmware fault are both active
- **THEN** the live warning and accessible status disclose both without hiding either or offering fatal clear solely for the timeout

#### Scenario: Cleared timeout history

- **WHEN** command 35 recovers a timeout activation and clearing during a saved ride or guest connection
- **THEN** the existing history list shows both with distinct labels and approximate or unavailable ride times, and remains discoverable after clearance

#### Scenario: Healthy connection

- **WHEN** beta2 reports inactive timeout with no fault, latch, or actual alert history
- **THEN** the history action is not shown solely because the timeout capability exists

#### Scenario: Retained stop and recreation

- **WHEN** a cleared timeout leaves stop condition `imuTimeout`, or the frontend is recreated after history was saved
- **THEN** the stop label and recorded history recover from authoritative state without asserting a currently active timeout

### Requirement: Explain battery configuration conflicts

For saved-board `series_mismatch` estimates, all live views SHALL explain that the selected battery's series count disagrees with the controller, the percentage is unavailable, and offer the battery configuration modal. Widgets SHALL identify the mismatch. The editor SHALL explain the conflict and show the controller count when known. Correcting configuration SHALL remove the warning without reconnecting.

#### Scenario: Wrong battery variant

- **WHEN** a user selects an 18S XR Classic battery for a controller reporting 15S
- **THEN** live views explain the cell-count mismatch and offer battery settings
- **AND** percentage remains unavailable rather than substituting controller charge
- **WHEN** the user selects a matching 15S battery
- **THEN** the warning disappears when the authoritative estimate becomes available

### Requirement: Detailed battery configuration

The detailed view SHALL show the saved battery name, series and parallel counts, cell profile and optional pack capacity alongside the controller-reported series count. Saved configuration SHALL remain visible during a series mismatch and refresh after profile revisions without polling on telemetry updates. Missing values and failed reads SHALL be explicit; switching boards SHALL never display the previous board's configuration.

#### Scenario: Inspect conflicting configuration

- **WHEN** the saved battery is 18S2P and the controller reports 15S
- **THEN** the detailed view shows both counts even though the estimate has no resolved series count
- **AND** the saved configuration remains distinct from controller facts
- **AND** both conflicting series-count rows use the warning accent until the mismatch is corrected
