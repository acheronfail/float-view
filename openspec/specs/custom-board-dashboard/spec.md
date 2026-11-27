# Custom Board Dashboard Specification

## Purpose

Let users compose one readable, responsive live dashboard per saved board using shared telemetry widgets and accessible touch and desktop editing.

## Requirements

### Requirement: Net consumption readings

Live boxes and Custom widgets SHALL offer Net watt-hours (`wattHoursNetWh`, Wh net) and Net amp-hours (`ampHoursNetAh`, Ah net), computed as drawn minus charged from the current sample. Both SHALL retain signed values, use the same units regardless of unit preference, and persist through existing settings and board-profile contracts on Apple and Android without altering other selections or supported stored data.

#### Scenario: Select and reload net readings

- **WHEN** a user selects either net reading in a Live box or Custom number/chart widget and saves
- **THEN** the selection survives reload and shows the same derived value in both views

#### Scenario: Consumption and regeneration

- **WHEN** drawn and charged watt-hours are 120 and 20
- **THEN** net watt-hours displays 100.0 Wh with the draw colour
- **WHEN** charged exceeds drawn
- **THEN** the net reading remains negative with the charging colour rather than clamping to zero
- **AND** Wh uses one decimal and Ah uses two; zero uses a neutral colour

#### Scenario: Missing telemetry and reconnect

- **WHEN** either source counter is missing or nonfinite, including while telemetry is unavailable after reconnect
- **THEN** the net reading is unavailable rather than assuming a zero counter or retaining a derived stale value
- **WHEN** both counters become available again
- **THEN** the net reading reflects their current difference

### Requirement: Saved-board custom dashboard

Custom View SHALL expose one dashboard for the active saved board alongside Live and Detailed. An absent configuration SHALL produce a useful default incorporating existing nonempty live-box choices. Custom edits SHALL NOT change the five Live View slots. Guest and standalone BMS connections SHALL retain their existing views without a custom editor.

#### Scenario: First use

- **WHEN** a saved board has no custom dashboard
- **THEN** Custom View presents a usable initial dashboard without requiring setup or writing a profile merely by opening the view

#### Scenario: Independent boards and Live View

- **WHEN** a user saves a custom dashboard for board A and later connects board B
- **THEN** board B uses its own configuration or defaults, and both boards retain their existing Live View box choices

#### Scenario: Profile read fails

- **WHEN** the selected board's dashboard cannot be loaded because of an operational failure
- **THEN** the view offers retry and does not treat the failed read as an absent dashboard or overwrite saved data with defaults

### Requirement: Composable widget catalogue

The widget picker SHALL offer ready-made configurations for readings, compatible number/bar/gauge/trend presentations, battery, temperatures, footpads, and existing lighting controls. Users SHALL be able to select content, compatible presentation and independent width/height from 1–4 cells. Duplicate readings SHALL be allowed with independent widget identities and configuration.

#### Scenario: Discover and stage a value

- **WHEN** the user searches Add widget or browses the value categories
- **THEN** every supported numeric reading is discoverable by its descriptive name with Number/1×1 defaults; visual panels and controls are clearly separate
- **WHEN** the user selects a value
- **THEN** compatible display choices, independent width/height and an accurate preview appear before creation
- **WHEN** the user cancels
- **THEN** no widget is appended, no layout is changed and no backend write occurs
- **WHEN** the user presses Add widget
- **THEN** exactly one selected widget is appended to the draft, with persistence still requiring dashboard Save

#### Scenario: Same reading in different forms

- **WHEN** a user adds motor current as a number and as a trend chart
- **THEN** both widgets render the same reading with consistent units and can be configured or removed independently

#### Scenario: Unsupported combination

- **WHEN** a selected content type cannot support a presentation, such as plotting a lighting toggle as a numeric gauge
- **THEN** configuration excludes that combination and invalid persisted combinations are rejected

### Requirement: Explicit presentation and meaningful ranges

Resizing SHALL preserve the chosen presentation and adapt its contents to available space. Gauges and bars SHALL use meaningful catalogue defaults or validated finite user ranges with minimum below maximum. Configuration SHALL identify the range's units. Unit preference changes SHALL convert displayed ranges without changing their physical meaning.

#### Scenario: Gauge-first composition

- **WHEN** a reading uses gauge presentation
- **THEN** the dial fills the available cell with its label, actual reading and units centred inside the arc rather than a separate prominent number above it
- **AND** range endpoints, unavailable values, semantic colours and out-of-range indication remain available

#### Scenario: Preview the chosen footprint

- **WHEN** a user selects a size in widget configuration
- **THEN** the menu names its width and height in cells, and the preview uses the current dashboard’s cell size and effective footprint rather than stretching to the panel width
- **WHEN** a preview is too wide for the editor
- **THEN** it scales down uniformly without changing aspect ratio, internal layout dimensions or the saved footprint
- **AND** chart axis labels and responsive content remain the same as on the dashboard

#### Scenario: Fit narrow and short tiles

- **WHEN** a battery, temperature, reading or chart widget uses any supported width/height combination, including its configuration preview
- **THEN** its title, reading and visual fit without clipped bars or overlapping scale labels; auxiliary voltage/scale details appear only when there is sufficient space
- **AND** narrow chart axes reduce labels, unavailable readings remain identified and charging batteries retain an indication
- **AND** the trend presentation is labelled Chart in the editor without changing its stored identifier

#### Scenario: Resize a number

- **WHEN** a number widget is made large or its container widens
- **THEN** it remains a number widget with an appropriately scaled readable value rather than becoming a chart automatically

#### Scenario: Configure or exceed a range

- **WHEN** a user supplies an inverted or nonfinite range
- **THEN** saving is blocked with actionable feedback
- **WHEN** a valid reading exceeds the configured range
- **THEN** the actual value remains available and the visual communicates the limit without fabricating a smaller reading

### Requirement: One responsive ordered layout

The dashboard SHALL store order and preferred size rather than coordinates or device-specific layouts. Available view width SHALL determine usable column count and bounded widget spans. Narrow layouts SHALL scroll vertically without horizontal page scrolling; wide layouts SHALL bound widget and dashboard width.

#### Scenario: Narrow and wide screens

- **WHEN** the same dashboard is opened on a narrow phone and a wide desktop
- **THEN** four compact widgets share one row from 20rem available container width, with fewer columns on narrower screens, larger widgets use appropriate spans, and every widget remains reachable in the saved order

#### Scenario: Expanded fold and desktop layouts

- **WHEN** available dashboard width reaches 40rem or 72rem
- **THEN** the grid uses eight or twelve columns respectively, with a bounded 100rem custom-view shell
- **AND** widget spans, order and saved configuration remain unchanged, while normal Live view retains its existing width limit

#### Scenario: Fold, rotate or split screen

- **WHEN** available view dimensions change during use
- **THEN** the dashboard reflows without losing configuration, edit drafts, widget identity or retained chart history, and does not persist a replacement device layout

#### Scenario: Short landscape screen

- **WHEN** available height cannot contain the dashboard
- **THEN** widgets keep usable minimum heights and controls remain reachable through vertical scrolling

### Requirement: Compact grid packing

Placement SHALL use compact rectangular cells with row heights at 55% of column width bounded to 3.5–5rem, with explicit independent column/row spans from 1–4. Explicit widths SHALL clamp to available columns while row intent remains fixed. Placement SHALL advance in saved row order without backfilling earlier rows, keeping visual and DOM/keyboard traversal order aligned. Charts SHALL fit their allocated cells rather than increasing row heights.

#### Scenario: Independent short and tall footprints

- **WHEN** a user selects 2×1 or 4×1 for a battery, reading or control
- **THEN** it occupies one row without stretching to two rows and its content fits the allocated height
- **WHEN** a user selects 1×4
- **THEN** it occupies four rows even when available columns are fewer than four
- **WHEN** an untouched named size is loaded
- **THEN** compact retains its 1×1 span, medium 2×2 and large 4×2, with the prior narrow-container span clamping

#### Scenario: Mixed-size packing

- **WHEN** a four-column dashboard contains a medium widget followed by four compact widgets
- **THEN** the medium widget occupies a 2×2 area and the compact widgets fill the neighbouring 2×2 area in two rows, each using the same compact row height
- **WHEN** the user resizes the viewport or cancels a drag preview
- **THEN** placement recomputes from the same saved order and size intent without content stretching the compact row heights

### Requirement: Draft dashboard editing

A stationary press-and-hold on any widget SHALL create a local draft with add, remove, reorder, configure, Save and Cancel actions. Dashboard Save SHALL atomically persist the complete dashboard at the expected Board Profile revision. Cancel SHALL leave the saved dashboard unchanged. Leaving a dirty editor SHALL offer a discard decision; unavailable saves SHALL retain the draft with actionable feedback.

#### Scenario: Save or cancel multiple edits

- **WHEN** a user adds, resizes and removes widgets in one editing session
- **THEN** Save commits the resulting dashboard together, while Cancel discards all those edits

#### Scenario: Empty dashboard

- **WHEN** the user removes every widget and saves
- **THEN** Custom View shows an intentional empty state with an Add action rather than silently restoring defaults

#### Scenario: Conflict or failed save

- **WHEN** the expected profile revision is stale or storage fails
- **THEN** no partial dashboard is committed, the draft remains available, and the user can retry or reload current values without silently overwriting newer profile changes

### Requirement: Hold to enter editing

A stationary primary-pointer hold anywhere on a widget SHALL enter editing without activating its ordinary control and SHALL allow dragging with the same pointer stream. Explicit Edit buttons SHALL be omitted. Keyboard and assistive users SHALL have a labelled widget action to enter editing, and empty dashboards SHALL offer Add.

#### Scenario: Enter editing from a lighting widget

- **WHEN** a user holds a lighting widget outside editing and continues moving the same pointer
- **THEN** editing begins, the lifted widget follows that pointer, and no lighting command is sent
- **WHEN** the user instead releases a stationary short tap outside editing
- **THEN** the ordinary lighting action runs exactly once

### Requirement: Rearrangement preview

The dragged widget SHALL follow the pointer with a lifted preview and a clear placement cue. Neighbouring widgets SHALL move into the proposed order, animating unless reduced motion is requested. Preview ordering SHALL remain transient until a completed drop.

#### Scenario: Preview and cancel placement

- **WHEN** a held widget moves over another widget
- **THEN** neighbouring widgets shift aside to show its proposed position
- **WHEN** the pointer is cancelled or the viewport resizes before dropping
- **THEN** the original draft ordering returns and the lifted preview is removed

### Requirement: Whole-widget edit gestures

In edit mode, a tap SHALL open that widget's configuration modal and a deliberate drag starting anywhere on its surface SHALL reorder it without a dedicated drag handle. Scroll gestures, cancelled pointers and non-primary pointers SHALL NOT open configuration, commit a drop or activate widget controls. A completed drag SHALL suppress its follow-up tap.

#### Scenario: Configure a lighting widget

- **WHEN** a user taps a headlights widget while editing
- **THEN** its configuration modal opens and no lighting command is sent

#### Scenario: Drag, scroll and cancel

- **WHEN** a user deliberately drags a widget, scrolls the dashboard or cancels an active pointer gesture
- **THEN** only the deliberate completed drag changes draft order, scrolling remains usable, and none of those gestures opens the widget modal

#### Scenario: Press and lift feedback

- **WHEN** a primary pointer starts a stationary hold
- **THEN** the widget acknowledges the press and lifts after 600ms to enter editing, or 300ms when already editing
- **AND** lifting adds an accent outline and raised shadow without moving neighbouring layout until dragging
- **WHEN** movement starts scrolling or the hold is cancelled
- **THEN** press feedback clears and no delayed lift occurs
- **WHEN** reduced motion is enabled
- **THEN** static press/lift cues remain without scaling or lift animation

#### Scenario: Stable drag placement

- **WHEN** a dragged widget causes neighbours of different sizes to reflow
- **THEN** stationary input, small pointer jitter and continued forward travel through that neighbour SHALL retain the proposed placement
- **AND** deliberately crossing back over the original insertion boundary can reverse the placement without a timed pause
- **AND** edge scrolling can continue advancing the placement
- **AND** release commits the visible placeholder and cancellation restores the draft order

#### Scenario: Resize during a drag

- **WHEN** the viewport changes during an active drag
- **THEN** the gesture is safely cancelled or reconciled without losing a widget, duplicating it or opening configuration

### Requirement: Accessible edit state and configuration

Edit mode SHALL visibly distinguish every widget with subtle wiggle and static editing cues, suppressing wiggle for reduced-motion preferences. Configuration modals SHALL expose content, compatible presentation, size, applicable ranges and a Save action that updates the draft. Removal SHALL be available through widget × buttons, without a duplicate modal action. They SHALL provide focus containment, labelled controls, dismissal and focus restoration.

#### Scenario: Keyboard and assistive operation

- **WHEN** a user edits without dragging
- **THEN** they can add, configure, move earlier/later, remove and save widgets with meaningful focus and reorder feedback

#### Scenario: Reduced motion

- **WHEN** reduced motion is requested
- **THEN** static borders and edit indicators identify editing without continuous animation or loss of functionality

### Requirement: Direct removal and keyboard ordering

Editing widget surfaces SHALL provide circular removal buttons and described Alt+Left/Right ordering shortcuts, without Move earlier/later buttons. Direct removal SHALL change only the draft and restore focus to an adjacent widget or Add when empty.

#### Scenario: Direct widget removal

- **WHEN** a user activates a widget’s circular remove button using a primary tap or keyboard
- **THEN** only that widget is removed from the draft, configuration does not open, ordinary widget controls do not activate and focus moves to an adjacent widget or Add
- **WHEN** the removal pointer moves, is cancelled or is non-primary
- **THEN** no widget is removed
- **WHEN** the user cancels the dirty draft
- **THEN** the saved composition returns

#### Scenario: Keyboard ordering without configuration buttons

- **WHEN** a keyboard user focuses a widget’s configuration surface and presses Alt+Left or Alt+Right
- **THEN** it moves one position earlier or later within the draft, remains focused and announces its new position

### Requirement: Stationary editing toolbar

Add, Cancel and Save SHALL appear in a floating toolbar outside grid layout, with consistent bottom scroll clearance in viewing and editing. Entering or leaving editing SHALL preserve widget coordinates and scroll viewport geometry. The toolbar SHALL be absent during configuration, the picker and confirmation, with focus restored after dismissal.

#### Scenario: Enter editing while holding

- **WHEN** a user holds a widget to enter editing
- **THEN** that widget and the scroll viewport retain their positions and sizes, and the toolbar appears without displacing the grid

### Requirement: Unified reading colours

A custom reading widget SHALL use the same semantic colour for its text, bar fill, gauge stroke and single-series trend. Load-source changes SHALL update the complete widget from the authoritative winning source. Shared Live renderers SHALL retain their existing defaults.

#### Scenario: Load colour changes

- **WHEN** the authoritative winning load source changes between duty, motor and battery
- **THEN** the widget’s label, value, units, range and visual all adopt that source’s semantic colour together

### Requirement: Stable unavailable and reconnect presentation

Widgets SHALL retain their position, size and configuration when data is unavailable, unsupported or stale. They SHALL explain unavailable state without fabricating zero. Connection loss SHALL preserve the dashboard and dim retained readings consistently with Live View. Controls SHALL use authoritative availability, pending state and existing mutation gates outside editing.

#### Scenario: Missing or stale BMS

- **WHEN** a configured BMS widget loses fresh BMS data
- **THEN** it remains in place, indicates unavailable data and recovers in place when fresh data returns

#### Scenario: Reconnect

- **WHEN** the same board reconnects
- **THEN** its layout and surviving local draft remain intact while readings follow authoritative connection state and no action is replayed

#### Scenario: Board changes during editing

- **WHEN** the active saved-board identity changes or the board is removed
- **THEN** the old editor closes, no draft or late save result is applied to another board, and the new target loads its own dashboard

#### Scenario: Ordinary lighting activation

- **WHEN** an eligible lighting widget is activated outside edit mode
- **THEN** exactly one existing control request is sent and its confirmed state changes only through authoritative updates

### Requirement: Ride marker action widget

The widget catalogue and configuration SHALL offer a Save ride marker button with supported dimensions. Configuration SHALL persist through the shared Apple and Android profile contract, preserving existing dashboards. A primary tap or keyboard/assistive activation SHALL request exactly one marker for the displayed active saved session. Pending or unavailable capture SHALL disable activation, and confirmed success SHALL provide accessible visual feedback.

#### Scenario: Save and confirm

- **WHEN** a rider activates the button during an active saved session
- **THEN** it displays saving feedback and, only after durable confirmation, an accessible Marker saved message with a visible check and brief highlight
- **AND** reduced motion retains static confirmation without animation

#### Scenario: Failure and lifecycle

- **WHEN** saving fails or its outcome is unknown
- **THEN** concise failure or unconfirmed feedback appears without success or automatic retry
- **WHEN** session identity changes or the widget is destroyed
- **THEN** old feedback clears, timers are disposed and late results do not appear in the new session

#### Scenario: Configure and preserve

- **WHEN** a rider adds or resizes the marker button, saves the dashboard and reloads
- **THEN** its order, identity and dimensions persist and configuration previews do not create markers

#### Scenario: Input suppression

- **WHEN** the rider holds the button to edit, scrolls, cancels a pointer or uses a non-primary pointer
- **THEN** no marker is created, including in previews and dashboard editing
- **WHEN** a normal activation produces a synthesized click
- **THEN** it does not create a duplicate marker

### Requirement: Theme toggle widget

Custom widget selection and configuration SHALL offer Light / dark mode with supported dimensions. Its identity, order and dimensions SHALL persist through the shared Apple and Android profile contract without changing existing dashboards. It SHALL use the same persisted appearance toggle as Live, independently of telemetry availability.

#### Scenario: Save and restore the widget

- **WHEN** a rider adds or resizes the theme widget, saves and reloads
- **THEN** the widget configuration is preserved and activation toggles appearance once

#### Scenario: Preview and edit suppression

- **WHEN** the widget is shown in a picker/configuration thumbnail, held to edit, dragged, scrolled, cancelled or activated by a non-primary pointer
- **THEN** appearance remains unchanged

#### Scenario: Interactive board preview

- **WHEN** the user normally activates the theme widget in a board's interactive preview
- **THEN** the app appearance toggles exactly once through the existing persisted preference

### Requirement: Board-scoped preview editing

Customise views SHALL use labelled example readings and shared renderers with normal tap/hold behavior. Live boxes SHALL open configuration on hold with immediate revisioned selection saves. Custom SHALL open in viewing mode and enter draft editing on hold, retaining existing add, configure, reorder, remove, Save and Cancel actions. Save or accepted Cancel SHALL return to viewing without leaving the preview.

#### Scenario: Edit and reopen offline

- **WHEN** the user changes a Live box or saves a Custom composition while disconnected and reopens the editor
- **THEN** the accepted choices remain for that board and the views retain independent configurations

#### Scenario: Preview controls

- **WHEN** the user taps, holds, cancels or uses non-primary input on preview lighting, theme or marker widgets
- **THEN** eligible short taps perform the documented preview interaction, holds enter editing without activation, cancelled/non-primary input does nothing, and no board command or ride marker is sent

#### Scenario: Default and unavailable profile

- **WHEN** a board has no Custom composition
- **THEN** its preview defaults incorporate that board's Live choices without saving merely on open
- **WHEN** a profile read fails
- **THEN** retry is offered without replacing the stored configuration with defaults

### Requirement: Isolated preview target and saves

The editor SHALL retain its selected saved-board target independently of connection changes and use no active-board readings. Preview view selection SHALL NOT change the next connected view. Leaving dirty Custom edits SHALL require a discard decision. Failed saves SHALL retain edits with feedback; stale revisions SHALL NOT silently overwrite newer Custom compositions.

#### Scenario: Another board or connection changes

- **WHEN** another board is active or connection state changes during editing
- **THEN** the editor retains its target and draft with fixed example readings, and any accepted save affects only that board

#### Scenario: Save failure or conflict

- **WHEN** a Live save fails or a Custom save fails or conflicts
- **THEN** actionable feedback appears, accepted data remains authoritative, and the user can retry or explicitly reload without silently losing Custom edits

#### Scenario: Switch or close a dirty editor

- **WHEN** the user switches away from dirty Custom edits or dismisses the editor
- **THEN** they can keep editing or explicitly discard, including through keyboard and native Back

### Requirement: Interactive preview action isolation

Interactive previews SHALL toggle headlights and LEDs only in temporary frontend state shared by both views for the selected board. Theme widgets SHALL use the app appearance preference. Ride markers SHALL remain unavailable without a real session. Picker/configuration thumbnails SHALL remain inert. Preview interactions SHALL never send device commands or create ride markers, even while another board is connected.

#### Scenario: Example lighting across views

- **WHEN** the user taps an example light switch and changes between Live and Custom
- **THEN** both views and duplicate controls show the same example switch state without changing the saved layout or sending a device command
- **WHEN** the user leaves the board preview and returns
- **THEN** example lighting resets to its initial state

#### Scenario: Live distance example

- **WHEN** the user taps a Live distance box in preview
- **THEN** it switches locally between ride distance and odometer without changing the saved box choice

#### Scenario: Edit and gesture suppression

- **WHEN** the user holds, drags, scrolls, cancels or uses a non-primary pointer on an interactive widget
- **THEN** no tap action runs and no theme or example switch state changes
- **WHEN** the user saves or cancels Custom edits
- **THEN** normal widget interaction resumes in the preview and dirty exits retain their existing discard guard

### Requirement: Custom elevation widget

The Custom View widget picker SHALL offer Elevation as a numeric reading or live trend. It SHALL use the current authorized route fix, follow the unit preference, and show unavailable when altitude is absent or stale. Live elevation trends SHALL use bounded in-memory history and break when readings are unavailable.

#### Scenario: Save and reopen an elevation widget

- **WHEN** the rider adds and saves an Elevation widget
- **THEN** the board layout restores the widget and it uses the current route fix for its next available reading
