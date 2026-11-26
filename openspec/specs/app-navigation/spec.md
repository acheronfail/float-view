# Application Navigation Specification

## Purpose

Define the routed application destinations, route-aware primary navigation, and focused connection, session, board, and settings flows.

## Requirements

### Requirement: Four primary application destinations

The frontend SHALL provide Home, Sessions, and Settings as primary destinations. Home SHALL own discovery and connection, Sessions SHALL own the saved-board index and saved-board history, and Settings SHALL own options that apply across the application. Boards SHALL NOT remain a primary destination; saved-board configuration SHALL be reachable from a saved-board history route and LiveView.

#### Scenario: Primary navigation

- **WHEN** the user selects a primary destination
- **THEN** the frontend navigates to Home, Sessions, or Settings without reloading the root document or reconnecting the backend client

#### Scenario: Saved-board subordinate route

- **WHEN** the user opens a saved board from Sessions
- **THEN** the frontend navigates to that board's history route without presenting Boards as a primary destination

### Requirement: Route-aware bottom tab bar

The frontend SHALL render primary tabs on exactly Home, Sessions, and Settings. Tabs SHALL map `connect` to Home, `sessions` to Sessions, and `settings` to Settings, with recognizable icons, lowercase labels and a visible selected state. Tabs SHALL use a verified usable side control region when available, otherwise the bottom edge. A Boards tab and Devices/Sessions segmented control MUST NOT remain.

#### Scenario: Top-level tab bar

- **WHEN** the user views Home, Sessions, or Settings without a usable side control region
- **THEN** the bottom tab bar presents the three icon-and-text destinations and identifies the current destination

#### Scenario: Select a tab

- **WHEN** the user selects `connect`, `sessions`, or `settings`
- **THEN** the frontend navigates to the mapped top-level route without reloading the document or reconnecting the backend client

#### Scenario: Subordinate route

- **WHEN** the user views Live, saved-board history, session detail, or board configuration
- **THEN** primary tabs are absent and the focused view supplies its own return navigation

#### Scenario: Superseded Boards navigation

- **WHEN** the routed application shell is rendered
- **THEN** no Boards tab, Boards top-level route, or Devices/Sessions segmented control is presented

#### Scenario: Side primary navigation

- **WHEN** the host provides a usable side control region
- **THEN** primary tabs occupy that region without overlapping system UI, and the content no longer reserves bottom-tab space

### Requirement: Home and live connection flow

Home SHALL show Bluetooth readiness, discovery, and connection controls when no board is active. Discovery SHALL include an advertising saved board whose exact platform identifier matches even when its advertisement omits the UART service, while unrelated advertisements remain hidden. An accepted explicit connection request, an automatic connection while Home is displayed, or a recovered active connection without a preferred restored destination SHALL navigate to a live view that represents connecting, identifying, selecting-controller, ready, reconnecting, disconnected, and failed backend states. During frontend startup, an eligible process-lifetime UI checkpoint destination SHALL take precedence over recovered Home-to-Live navigation. Foreground auto-connect SHALL preserve a displayed or restoring non-live destination; its lifecycle discovery SHALL not depend on mounting Home.

#### Scenario: Accepted connection

- **WHEN** the backend accepts a device connection request
- **THEN** the frontend navigates to the live view and renders subsequent identification, selection, and connection states from authoritative snapshots

#### Scenario: Recovered active connection

- **WHEN** the frontend reconnects after lifecycle recreation, `state.get` contains an active connection and no eligible checkpoint destination takes precedence
- **THEN** it replaces the inactive Home view with the live view without starting another native connection

#### Scenario: Restored non-live destination

- **WHEN** the frontend is recreated with an eligible Sessions, session detail, board history or Settings checkpoint while a connection remains active
- **THEN** it restores that destination without briefly navigating to Live, mounting Home for discovery or starting another native connection

#### Scenario: Recovered controller selection

- **WHEN** the recovered active connection is awaiting a controller choice and the chosen destination is Live
- **THEN** the live route presents that choice from authoritative candidates without returning to Home

#### Scenario: Recovered failed connection

- **WHEN** the recovered active connection is failed with a connection issue and the chosen destination is Live
- **THEN** the live route retains its configuration, retry, and disconnect actions without returning to Home

#### Scenario: Live route without a connection

- **WHEN** the live route is opened while authoritative state has no active connection
- **THEN** the frontend returns to Home

#### Scenario: Explicit disconnect

- **WHEN** the active board is disconnected from the live view
- **THEN** the frontend returns to Home after authoritative state reports no active connection

#### Scenario: Automatic connection during restoration

- **WHEN** foreground auto-connect admits a connection before or after a non-live checkpoint destination is restored
- **THEN** the frontend preserves that destination and reflects connection state through normal authoritative snapshots without navigation to Live

#### Scenario: Automatic connection from Home

- **WHEN** foreground auto-connect admits a connection while Home is displayed and no pending restored destination takes precedence
- **THEN** Home transitions to Live and renders the normal connection flow without submitting another connection command

### Requirement: Routed session browsing

Sessions SHALL list saved boards rather than a global session catalog. Selecting a saved board SHALL navigate to a board-history route that loads its bounded overall summary and board-filtered session pages grouped by local date. A saved board SHALL remain browsable and configurable when it has no currently discovered local Bluetooth association; connection initiation remains owned by the Home scan. Selecting a session from that route SHALL navigate to a detail view that retains metadata-first authenticated series/sample/event pages, export, deletion, and prune-state operations.

#### Scenario: Open saved-board history

- **WHEN** the user selects a saved board in Sessions
- **THEN** the frontend navigates to its board-history route and requests only sessions for that saved board

#### Scenario: Open session

- **WHEN** the user selects a listed session from a board-history date group
- **THEN** the frontend navigates to its detail view and requests that session by its opaque identifier

#### Scenario: Missing session

- **WHEN** a session detail route identifies a session the backend no longer has
- **THEN** the frontend returns to the owning board-history route when board identity is known, otherwise Sessions, and presents a useful not-found message

#### Scenario: Deleted session

- **WHEN** the user confirms deletion and the backend accepts it
- **THEN** the frontend returns to the owning board-history route when board identity is known and refreshes that board's summary and date groups

#### Scenario: No global session feed

- **WHEN** the user views Sessions
- **THEN** no `All sessions` group, global date grouping, or second session sub-tab is rendered

#### Scenario: Undiscovered saved board

- **WHEN** a saved board is absent from the current Home scan
- **THEN** its history and configuration remain available, but its board-history route does not start or offer a connection

### Requirement: Routed saved-board configuration

Saved-board configuration SHALL be reachable from the selected board's history-route menu and from the LiveView action menu. Both surfaces SHALL render the same Board Profile editor for the saved board's custom name and versioned profile, including an optional read-only local platform Bluetooth identifier, battery series cells, battery parallel cells, motor, and an optional preferred CAN ID from `0` through `253`. An imported board may have no local platform identifier and SHALL still be editable. There SHALL be no standalone Boards route required to edit a board.

#### Scenario: Open saved-board configuration

- **WHEN** the user selects Configure board from a saved board's history-route menu
- **THEN** the frontend opens the configuration sheet for that board and requests its Board Profile by opaque saved-board identifier

#### Scenario: Live configuration remains available

- **WHEN** the user selects Configure board from LiveView for an identified saved board
- **THEN** the same editor opens with the same revision-checked persistence behavior

#### Scenario: Configure board without discovery

- **WHEN** the user selects Configure board for an imported or otherwise undiscovered saved board
- **THEN** the same Board Profile editor opens without attempting Bluetooth connection, and an unavailable local platform identifier is not treated as an error

#### Scenario: Forget board from history

- **WHEN** the user opens a board-history menu for an inactive saved board
- **THEN** the menu includes `Forget board`, whose destructive confirmation states that all saved sessions for the board will also be removed and the action cannot be undone

#### Scenario: Forget board during active connection

- **WHEN** the selected board is actively connected
- **THEN** `Forget board` is unavailable and any raced backend request is rejected without deleting the board or its sessions

#### Scenario: Board profile field change

- **WHEN** a valid text, numeric, selection, or clearable preferred-CAN value commits in either configuration surface
- **THEN** the frontend immediately serializes the corresponding revision-checked update and renders the backend-returned authoritative value

#### Scenario: Multiple rapid changes

- **WHEN** multiple configuration fields commit before earlier writes finish
- **THEN** the frontend applies them in order against backend-returned revisions without losing a valid change to a self-created conflict

#### Scenario: Invalid CAN preference

- **WHEN** the user enters a fractional, negative, nonnumeric, or greater-than-253 value
- **THEN** the editor reports the validation error and does not send an invalid Board Profile update

### Requirement: Global settings destination

Settings SHALL contain application-wide preferences and app support tools grouped by purpose. Board-specific values MUST NOT be edited from Settings, and application-wide settings MUST NOT remain embedded in session browsing.

#### Scenario: Open global settings

- **WHEN** the user selects Settings
- **THEN** the frontend renders the theme, accent colour and units controls above six labelled destinations: Ride announcements, Ride recording, Connection & permissions, Data & backups, Help & diagnostics and About

#### Scenario: Native-owned option update

- **WHEN** the user changes a valid global option
- **THEN** the frontend sends a revision-checked settings patch and renders the backend-returned settings

### Requirement: Focused settings pages

Settings home SHALL show the theme, accent colour and units controls inline and navigation rows with short descriptions for the remaining categories. Ride totals SHALL remain in Sessions. Each category destination SHALL have a titled page and a return to Settings, retaining in-memory landing-page position and keyboard focus. Licences SHALL return to About. Recreated frontends SHALL use the existing Settings checkpoint without extending the wire contract.

#### Scenario: Open and return

- **WHEN** a user opens a category with touch or keyboard and returns by header, native or browser back
- **THEN** Settings retains its position and keyboard users regain focus on the category link

#### Scenario: Frontend reconstruction

- **WHEN** a frontend is recreated from a saved Settings checkpoint
- **THEN** Settings home opens without replaying any preference edit or support action

### Requirement: Settings progressive disclosure

Ride recording SHALL keep minimum ride distance, technical sampling and chart-gap controls in a collapsed Advanced recording section. Announcements SHALL group each alert with its associated options, disclose those options when enabled, and retain their saved values when disabled. Shared audio and testing controls SHALL be grouped separately. Boolean preferences SHALL use labelled Off / On segmented controls with guarded pointer and keyboard activation.

#### Scenario: Enable an alert

- **WHEN** a user enables speed, load or footpad announcements
- **THEN** its saved threshold or delay becomes editable beside that alert without resetting the value

#### Scenario: Invalid alert value

- **WHEN** a user disables an alert while its edited threshold is invalid
- **THEN** the invalid field and error remain reachable until corrected and saved, rather than hiding the correction path

#### Scenario: Recording detail

- **WHEN** a user opens Ride recording and expands Advanced recording
- **THEN** technical recording and chart-gap controls become available without changing their saved values

### Requirement: Settings permission entry points

Connection & permissions SHALL indicate when a required permission needs attention. Ride location recording SHALL link to the permissions page. Diagnostic recovery links SHALL open Help & diagnostics directly.

#### Scenario: Required permission unavailable

- **WHEN** a required permission is denied, restricted or limited, or its required service is off
- **THEN** the Settings category indicates attention is needed and opens the existing permission recovery controls

### Requirement: Route failure containment

Route parameters and navigation state SHALL remain bounded and MUST NOT be used as filesystem paths or trusted backend data. A failed detail request SHALL preserve the backend connection and other authoritative state.

#### Scenario: Invalid detail identifier

- **WHEN** a detail route contains an invalid, unknown, or stale opaque identifier
- **THEN** the frontend leaves the detail view without reconnecting the backend or discarding unrelated application state

### Requirement: Current ride access

The Live action menu SHALL offer Charts… and Sessions SHALL offer Current ride for an active saved session. Live SHALL NOT reserve dashboard space for a separate current-ride button. It SHALL open the shared session viewer without disconnecting or changing recording. The active viewer SHALL provide Back to Live and Recording or Reconnecting status. Guest connections SHALL NOT offer recorded current-ride review.

#### Scenario: Open and return

- **WHEN** a saved-mode rider opens Charts… from Live or Current ride from Sessions and returns to Live
- **THEN** the same connection and session remain active throughout

#### Scenario: Guest connection

- **WHEN** the connection is in guest mode
- **THEN** Charts… and Current ride are absent

### Requirement: Ongoing ride review

The active viewer SHALL follow the growing persisted ride by default, using bounded consistent snapshots. Inspection SHALL pause following and preserve chart selections, field visibility and map position. Jump to live SHALL resume following. Refresh SHALL stop while hidden or unmounted, allow at most one metadata refresh in flight, and reject stale responses after navigation.

#### Scenario: Inspect and resume

- **WHEN** the user pans, zooms, selects a point, or navigates or filters the map
- **THEN** automatic following pauses until Jump to live, with recording continuing independently

#### Scenario: Growing ride

- **WHEN** the visible viewer follows an active ride
- **THEN** charts, markers, events and recorded location refresh at a bounded cadence without resetting field choices

#### Scenario: Reconnect and completion

- **WHEN** a connection reconnects or its session completes
- **THEN** existing history stays visible, reconnecting is indicated, and a retained completed session becomes ordinary review with final data

#### Scenario: Refresh failure or discarded ride

- **WHEN** refresh fails or a provisional ride is discarded at close
- **THEN** the viewer preserves the last successful data, reports the problem, and provides return navigation

#### Scenario: Hidden or replaced viewer

- **WHEN** the viewer is hidden, closed or replaced by another session
- **THEN** polling stops and outstanding responses cannot replace another session's data

### Requirement: Announcement settings controls

Settings SHALL provide independent speed/load switches and thresholds with explicit units, a shared repeat interval, announcement volume, audio readiness, and a test action. The same frontend SHALL support pointer and keyboard activation without duplicate actions. Validation and save/test failures SHALL preserve edits and remain visible. A test SHALL identify its selected speed, load or combined content even when both rules are off. Unavailable audio SHALL not silently disable the saved rule.

#### Scenario: Configure announcements

- **WHEN** users enable load and set 65 percent with a five-second repeat interval
- **THEN** Settings saves a revision-checked patch and presents authoritative accepted values

#### Scenario: Automatic announcement preference saving

- **WHEN** users change an announcement switch or slider, or commit a numeric input by changing or leaving it
- **THEN** valid preferences save automatically without a Save button; delayed saves preserve newer edits, and failures retain edits with an explicit retry action

#### Scenario: Invalid announcement numeric input

- **WHEN** a user commits an empty or out-of-range number, or a repeat interval that is not a whole number
- **THEN** a persistent danger-styled hint appears under that input with its valid range and current units, the field is marked invalid for assistive technology, and neither saving nor testing submits the invalid preferences
- **AND** correction clears the field's error immediately and valid committed preferences save automatically without native validation popovers

#### Scenario: Test after editing preferences

- **WHEN** users activate a test with valid uncommitted edits or a save in progress
- **THEN** the test waits for those preferences to save and does not play using older settings if saving fails

#### Scenario: Test feedback

- **WHEN** users activate a test by primary pointer or keyboard
- **THEN** exactly one test is sent, repeat activation is prevented while pending, and the terminal outcome is displayed without claiming that a finished utterance was necessarily heard

#### Scenario: Audio unavailable

- **WHEN** audio readiness is unavailable or a test cannot play
- **THEN** Settings explains the bounded reason or outcome and retains the user's announcement configuration and other working controls

### Requirement: Conditional audio lowering control

Settings SHALL show “Lower other audio while speaking” only when authoritative announcement audio state says lowering is adjustable. Helper text SHALL explain that music and other audio become quieter temporarily and that some apps may pause. Android and macOS SHALL hide this control while retaining announcement volume and other common settings. The frontend SHALL derive visibility from the mandatory state field, not detect the platform.

#### Scenario: iOS audio controls

- **WHEN** Settings receives adjustable lowering state
- **THEN** it shows the saved lowering switch and its explanation alongside announcement volume

#### Scenario: Android or macOS audio controls

- **WHEN** Settings receives automatic lowering state
- **THEN** it hides the lowering switch without hiding speech volume, thresholds, enable switches or testing

### Requirement: System voice settings action

Announcement settings SHALL show a guarded Voice settings button only when
announcementAudio.voiceSettingsAvailable is true. It SHALL open the native
chooser via the authenticated backend, preserve unsaved edits, prevent duplicate
activation while pending and display launch failures. Help text SHALL explain
that users choose an English offline voice in device text-to-speech settings.
Returning SHALL refresh the selected engine/voice without restarting the app.

#### Scenario: Guarded voice settings activation

- **WHEN** a primary pointer or keyboard activates Voice settings
- **THEN** exactly one native launch is requested and failures remain visible without discarding announcement edits

### Requirement: Adaptive side controls

When a verified usable side region exists, the shared frontend SHALL place header actions and routed back controls there and release their former space for content. Foreground content and controls MUST avoid system-reserved regions. Control placement SHALL update with geometry changes and SHALL fall back to ordinary placement when safe geometry is unavailable or insufficient.

#### Scenario: Live controls

- **WHEN** Live is displayed with a usable side region
- **THEN** its header action buttons occupy that region while retaining their state, labels and actions

#### Scenario: Routed return navigation

- **WHEN** a subordinate page with a back control is displayed with a usable side region
- **THEN** its existing back destination is reachable from that region without a duplicate header control

#### Scenario: Resize or changed system obstruction

- **WHEN** the available region changes or disappears
- **THEN** controls update without a document reload, backend reconnection, lost focus or overlap with system UI

#### Scenario: Insufficient region

- **WHEN** the region cannot safely contain the controls
- **THEN** the application retains accessible ordinary controls rather than clipping or hiding navigation

#### Scenario: Input methods and overlays

- **WHEN** controls are activated by primary pointer, non-primary pointer, keyboard or assistive click, or a modal surface opens
- **THEN** existing activation guards, focus containment and dismissal behavior remain effective without duplicate activation or interactive controls behind the modal

### Requirement: Frontend browsing context

Within one frontend lifetime, routed pages SHALL retain bounded independent browsing positions. Returning through header, native or browser back, or switching primary tabs, SHALL restore retained context after required content loads without flashing the top. New destinations SHALL start at the top. Frontend recreation or cache eviction SHALL use normal initial presentation.

#### Scenario: Deep board history

- **WHEN** a user loads multiple session pages, opens a session and returns by any back control
- **THEN** the board history retains its loaded extent and restores the same visible session at the same viewport offset

#### Scenario: Independent destinations

- **WHEN** a user browses different boards or switches between primary tabs and returns
- **THEN** each retained destination restores its own position without applying another destination's offset

#### Scenario: Keyboard return

- **WHEN** a keyboard user opens a session and returns to its retained list
- **THEN** focus returns to the opened session link without changing the restored position

#### Scenario: New or evicted destination

- **WHEN** a user opens an unvisited destination, or returns after frontend recreation or bounded cache eviction
- **THEN** it renders normally from the top without backend persistence or replaying any action

### Requirement: Browsing restoration with changed content

Retained session lists SHALL reconcile catalog changes through fresh bounded reads, without reusing stale cursors. Restoration SHALL prefer a surviving visible session anchor and otherwise a nearby retained session or clamped position. Failed reads SHALL expose normal retry controls. Restoration SHALL release presentation on user interaction and SHALL NOT override subsequent user scrolling or move a newer destination.

#### Scenario: Changed catalog

- **WHEN** import or deletion changes the catalog while a user views a session
- **THEN** return loads fresh pages through the previously loaded extent and restores a surviving nearby session without resetting to the first page or displaying stale deleted rows

#### Scenario: Failed or interrupted restoration

- **WHEN** loading fails, the user interacts, or another navigation begins during restoration
- **THEN** restoration releases presentation and does not later move the new destination or override user scrolling

### Requirement: Native iOS edge back gesture

On iOS, a deliberate completed rightward swipe from the left screen edge SHALL invoke the shared Back action when a nested back destination is available. It SHALL preserve dismissal/save guards and retained browsing context. Primary destinations without a nested back control, short or reversed drags, vertical scrolling and cancelled gestures SHALL NOT navigate. The current page SHALL track eligible drags, settle back on cancellation, and slide away after accepted Back and parent restoration.

#### Scenario: Nested return

- **WHEN** a user completes an eligible edge swipe from session detail, board history or another nested page
- **THEN** the app performs the same return as its existing Back handler, including list-position restoration

#### Scenario: Guarded surface

- **WHEN** an eligible edge swipe completes while a dismissible surface or guarded editor is above a nested page
- **THEN** shared dismissal and save guards handle the request before any parent navigation

#### Scenario: Ineligible gesture

- **WHEN** the gesture is short, reversed, cancelled, primarily vertical or starts away from the left edge
- **THEN** no Back action is dispatched

#### Scenario: Primary destination or frontend reconstruction

- **WHEN** no nested back destination is available, or a new frontend has not published its presentation readiness
- **THEN** the native edge gesture remains disabled without using browser history or stale presentation state

#### Scenario: Interactive feedback and guarded completion

- **WHEN** an eligible edge drag begins and moves
- **THEN** the current viewport follows the finger over a neutral back affordance without reflowing its charts or fixed controls
- **AND** release completes the slide only after accepted parent navigation and restored presentation; cancellation, failed navigation or surface dismissal settles the moving layer back and removes it

#### Scenario: Interrupted presentation

- **WHEN** the app backgrounds, the document changes, or snapshot capture fails during a gesture
- **THEN** temporary presentation is bounded and cleaned up, without stale callbacks moving a new document or replaying Back

#### Scenario: Reduced motion

- **WHEN** Reduce Motion is enabled
- **THEN** direct finger tracking remains available and automatic settling uses reduced motion

### Requirement: Focused permission presentation

Connection & permissions SHALL lead with permission status and place Reconnecting afterward. Granted permissions without an active limitation SHALL start compact, with details available on demand. Permissions needing attention SHALL initially expose guidance and recovery. Unchanged snapshots SHALL preserve manual disclosure choices; changed facts SHALL re-evaluate the default without prompting.

#### Scenario: Inspect granted permission

- **WHEN** a user expands or collapses a granted permission and unchanged permission facts arrive in a new snapshot
- **THEN** its status remains visible, the chosen disclosure is preserved and no OS permission action occurs

#### Scenario: Permission needs attention

- **WHEN** authorization or relevant OS facts change to require attention
- **THEN** the current explanation and supported recovery action become visible without replaying a permission request

### Requirement: Saved-board view customisation entry points

Saved-board history menus in Sessions SHALL offer Configure board before Customise views. Board/Connect menus SHALL NOT offer Customise views. The focused editor SHALL show the board's name and a view/preview-values subtitle, omit a separate board card and content-level selector, work without discovery or connection, including imported boards, and return to board history through guarded dismissal.

#### Scenario: Open without a board connection

- **WHEN** the user selects Customise views from a saved board's history menu
- **THEN** its name appears in the title with a preview-values subtitle and access to both editable views, without a separate board card, scanning or connecting

#### Scenario: Connected board menu

- **WHEN** the user opens the Board/Connect menu for a connected saved board
- **THEN** Customise views is absent and the normal Live and Custom views remain available

#### Scenario: Customise a connected board from Sessions

- **WHEN** the user selects Customise views from the board's history menu in Sessions while connected
- **THEN** the preview editor opens without changing connection or recording, and guarded dismissal returns to board history

#### Scenario: Dismiss or lose the target

- **WHEN** the user closes the editor or its target board is removed
- **THEN** normal dismissal protects dirty edits, removal invalidates the target, and no late operation applies to another board

### Requirement: Preview view navigation

The editor SHALL open Custom for a saved Custom preference and Live for a saved Live, Detailed or absent preference. Its header dots menu SHALL offer only switching to the other editable view and Back, using normal guarded navigation. Switching previews SHALL NOT change the saved preference or expose the connected Live action overlay. Navigation controls SHALL NOT reserve space inside the dashboard viewport.

#### Scenario: Open and switch previews

- **WHEN** a user opens Customise views from a saved board's history menu in Sessions
- **THEN** the saved editable preference opens directly, with Detailed or absent preferences falling back to Live
- **WHEN** the user selects the other view from the header menu
- **THEN** the preview changes without persisting a new default or inserting a selector into the content

#### Scenario: Back or switch with a dirty draft

- **WHEN** the user chooses Back or switches away from dirty Custom edits through the preview menu
- **THEN** the existing discard decision protects the draft and the menu contains no connection, firmware or recording actions
