# Session Location Review Specification

## Purpose

Define bounded historical location-track retrieval and synchronized map presentation in session review.

## Requirements

### Requirement: Bounded location-track review

The session-data plane SHALL provide an authenticated, bounded `locations` query using the session ID, published snapshot revision, cursor/limit, and elapsed-time range. Results SHALL include ordered location points, explicit gaps, the next cursor when present, and the location boundary read.

#### Scenario: Session with location data

- **WHEN** the frontend requests a valid location page against the current published snapshot
- **THEN** the backend returns only the requested bounded range and a continuation cursor when more rows remain

#### Scenario: Stale snapshot

- **WHEN** a location query names a superseded published snapshot
- **THEN** the backend returns the contract's bounded conflict/not-found result and the frontend refreshes session metadata before retrying

#### Scenario: Board-only session

- **WHEN** the session has no accepted location rows
- **THEN** the location query returns an empty bounded result and the session review remains fully usable without a map

### Requirement: Sticky map preview

The session view SHALL render a sticky map preview when the session metadata reports track location availability or a committed ride marker contains a recorded location. The map SHALL show recorded ride marker icons, the accepted base track when present, a travelled line through points up to the selected elapsed time, and a rider marker when an eligible point exists.

#### Scenario: Location-bearing session

- **WHEN** a historical session with location data is opened
- **THEN** the session view loads bounded location pages and presents a sticky map preview alongside the existing charts

#### Scenario: Board-only session

- **WHEN** a historical session has neither track location data nor recorded marker locations
- **THEN** the existing chart/session review renders without reserving an empty map or changing board-only behavior

#### Scenario: Sparse track

- **WHEN** a session contains gaps or only one accepted point
- **THEN** the map renders the accepted data and gap-aware travelled line without fabricating a route

#### Scenario: Marker positions without a track

- **WHEN** recorded marker positions exist but no base track remains
- **THEN** the map shows the marker positions without fabricating route segments or a rider position

### Requirement: Upstream rider visual treatment

The map SHALL reuse the rider icon asset and marker treatment from `vendor/float-view/src/assets/rider-icon.svg` and the upstream Float View map example, while preserving attribution for the selected tile provider.

#### Scenario: Rider marker

- **WHEN** the selected elapsed time has an eligible location point
- **THEN** the map displays the upstream rider icon at that point with the same bounded marker anchoring behavior

#### Scenario: Tile attribution

- **WHEN** the map is rendered with remote tiles
- **THEN** the required provider attribution remains visible and no geocoding or navigation control is added

### Requirement: Shared elapsed-time selection

The chart and map SHALL use one selected session-relative elapsed-time value. Selection changes SHALL update the travelled polyline and rider marker without issuing an unbounded network request for every pointer movement.

#### Scenario: Move chart selection

- **WHEN** the user moves the selected point in the historical charts
- **THEN** the map advances its travelled line and rider marker to the latest eligible location point at or before that elapsed time

#### Scenario: Gap boundary

- **WHEN** the selected time falls inside a location gap
- **THEN** the map keeps the last eligible travelled point and does not interpolate across the gap

#### Scenario: Gap-free pair

- **WHEN** the selected time lies between two adjacent points in the same gap-free segment and interpolation is permitted by the documented tolerance
- **THEN** the rider marker may be bounded-interpolated while the travelled line remains composed only of accepted track points

### Requirement: Deterministic CSV location projection

When `includeGpsLocationWhenExporting` is enabled, CSV export SHALL add `gpsAccuracy`, `gpsLongitude`, and `gpsLatitude` columns to telemetry rows by selecting the nearest eligible recorded location point within the documented tolerance and repeating that point's values across eligible rows. Equal-distance candidates SHALL be resolved by the lower location sequence, and rows without an eligible point SHALL contain blank GPS fields. CSV SHALL NOT interpolate coordinates; the independent location track remains available through session review and bounded location reads.

#### Scenario: Repeated nearest location

- **WHEN** a telemetry row has one or more recorded location points within the export tolerance and GPS export is enabled
- **THEN** the CSV row contains the nearest point's accuracy, longitude, and latitude, and adjacent eligible telemetry rows may repeat the same values

#### Scenario: Tie break

- **WHEN** two eligible location points are equally distant from a telemetry row
- **THEN** the CSV row uses the point with the lower location sequence

#### Scenario: No eligible point

- **WHEN** no location point falls within the export tolerance
- **THEN** the telemetry row contains blank GPS fields and the independent location track remains available through session review and bounded reads

#### Scenario: GPS export disabled

- **WHEN** the user exports a session while GPS export is disabled
- **THEN** the CSV omits the GPS columns regardless of whether the session contains location data

### Requirement: Explicit map filtering mode

Session review SHALL offer an off-by-default **Filter charts by map** toggle when a complete usable location track is available. The mode SHALL be transient to the open review. Enabling it SHALL filter every telemetry chart by the current map area; disabling it SHALL restore the preceding ordinary chart viewport.

#### Scenario: Enable from a zoomed chart

- **WHEN** the user enables filtering after zooming the ordinary charts
- **THEN** the current map bounds select intervals from the full loaded track, without intersecting the earlier chart viewport or automatically moving the map

#### Scenario: Disable or hide map

- **WHEN** the user disables filtering or hides the map
- **THEN** filtering turns off and the previous ordinary chart viewport and navigation become available

#### Scenario: Unavailable track

- **WHEN** only marker locations, no recorded fix before session end, incomplete track data, or a failed track load are available
- **THEN** spatial filtering is unavailable with an explanation, and ordinary session review remains usable

#### Scenario: Reopen review

- **WHEN** the user changes sessions or recreates the review
- **THEN** filtering starts disabled and no prior session's spatial selection is reused

### Requirement: Geographic selection preserves ride chronology

Map filtering SHALL include the portions of continuous recorded route segments inside the visible geographic bounds, ordered by original ride time. Boundary crossings SHALL be interpolated only within eligible continuous location segments. During explicit location gaps and excessive time gaps, chart selection SHALL hold the last recorded location until the next fix or session end. This selection policy SHALL NOT create map route edges or synthetic recorded coordinates.

#### Scenario: Repeated visits

- **WHEN** the route leaves and later re-enters the visible area
- **THEN** each visit produces its own ordered included interval and intervening out-of-area time is excluded

#### Scenario: Crossing with endpoints outside

- **WHEN** a continuous route edge crosses the visible area while both recorded endpoints lie outside it
- **THEN** the crossing portion is included using its interpolated entry and exit times

#### Scenario: Location gap after a recorded fix

- **WHEN** a time span lies after a recorded fix and before the next continuous segment or session end
- **THEN** that span is included exactly when the last recorded location is inside the map bounds, including when that fix is an isolated point
- **AND** adjacent included intervals are merged so GPS gaps alone do not introduce chart separators
- **AND** no route is interpolated across the gap

#### Scenario: No previous location

- **WHEN** a time span precedes the first recorded fix or the session has no fixes
- **THEN** that span is excluded without inferring a location from future fixes or markers

#### Scenario: Empty area

- **WHEN** no positive-duration route portion or held-location interval intersects the map
- **THEN** charts show an explicit empty-area state and offer a full-route reset instead of showing unfiltered or stale telemetry

### Requirement: Disjoint chart timeline

Filtered charts SHALL concatenate included intervals in chronological order, with width proportional to included duration and aligned dashed vertical separators between disjoint intervals. Data paths and tooltip interpolation SHALL not bridge excluded time. Inspection and labels SHALL retain original ride timestamps, and automatic value scales SHALL use only included telemetry.

#### Scenario: Multiple intervals

- **WHEN** the map includes two two-minute visits separated by ten excluded minutes
- **THEN** each visit receives equal chart duration width, the excluded ten minutes occupy no duration width, and a separator marks the discontinuity on every chart

#### Scenario: Inspect near a separator

- **WHEN** the user inspects either side of a separator
- **THEN** the chart resolves to the corresponding original ride time and updates the shared map selection without interpolating across the break

#### Scenario: Marker outside selection

- **WHEN** a selected marker or fault lies outside the included intervals
- **THEN** it does not expand the filtered charts or recenter the map, and chart inspection is cleared with an outside-filter indication

### Requirement: Map owns filtered chart navigation

While map filtering is enabled, every chart zoom and pan control and gesture SHALL be disabled, including drag, pinch, wheel, and keyboard navigation paths that change the viewport. Inspection and field visibility SHALL remain usable. Map-driven chart updates and chart selection SHALL not automatically change map bounds.

#### Scenario: Chart gesture during filtering

- **WHEN** the user attempts chart zoom or pan while filtering is enabled
- **THEN** the included intervals and map bounds remain unchanged, and disabled navigation controls explain that the map controls the range

#### Scenario: Settle map movement

- **WHEN** map pan or zoom finishes
- **THEN** all charts use the new included intervals without chart-to-map recenter feedback

#### Scenario: Reset route

- **WHEN** the user requests full-route reset while filtering is enabled
- **THEN** the map fits the complete route and charts include all eligible located intervals while filtering remains enabled

### Requirement: Bounded and revision-consistent spatial review

Spatial filtering SHALL use complete bounded track data and bounded telemetry requests against one published snapshot. Superseded work SHALL be cancelled or ignored. Loading, failures, and resource limits SHALL be visible; partial data SHALL never be presented as a complete spatial result. A retry or disabling the filter SHALL remain available after failure.

#### Scenario: More than four location pages

- **WHEN** the complete track requires more than four pages within the supported review limits
- **THEN** all pages are considered before filtering is available, including portions near the end of the ride

#### Scenario: Resource limit

- **WHEN** track size, interval count, or decoded result size exceeds the supported limit
- **THEN** the view reports that filtering cannot complete and does not silently truncate or merge across excluded portions

#### Scenario: Rapid movement or teardown

- **WHEN** map bounds change again or review closes while queries are pending
- **THEN** obsolete results cannot overwrite the current view and pending work is released

#### Scenario: Transport or snapshot failure

- **WHEN** a filtered query fails, reconnects, or encounters a superseded snapshot
- **THEN** the view reports loading or failure, refreshes metadata when required, and retries with bounded attempts without mixing snapshots

### Requirement: Flywheel exclusion from session footpad fault overlays

Session review SHALL omit both one-footpad and both-footpads-off-at-speed markers during recorded flywheel intervals. Recorded mode transitions SHALL break footpad episode continuity without rewriting stored samples or events. Known non-flywheel mode SHALL end exclusion; absent or unknown mode SHALL not clear established exclusion. Sessions without mode history SHALL retain their existing behavior.

#### Scenario: Recorded flywheel motion

- **WHEN** retained speed samples exceed the footpad overlay threshold while recorded package mode is flywheel
- **THEN** neither footpad overlay produces a marker regardless of recorded footpad contact

#### Scenario: Mode and footpad history across pages

- **WHEN** mode and footpad transitions or exact speed samples span read pages, including transitions sharing a timestamp
- **THEN** exclusion uses elapsed time and source sample sequence, never a future transition, and pagination does not duplicate an episode

#### Scenario: Exit and sparse retained samples

- **WHEN** a known non-flywheel transition follows flywheel, including when no speed sample remains inside that interval
- **THEN** the next qualifying non-flywheel speed sample starts a new footpad episode without extending the pre-flywheel episode

#### Scenario: Missing mode history

- **WHEN** a recording contains no package-mode transitions or contains unknown mode after an established flywheel transition
- **THEN** no-history recordings retain ordinary detection, while established flywheel exclusion persists until known non-flywheel mode is recorded

#### Scenario: Existing recordings

- **WHEN** a saved or imported recording is reopened with the footpad overlays enabled
- **THEN** derived markers apply the same exclusion while raw telemetry, mode events, firmware faults, ride statistics and GPS records remain unchanged

### Requirement: Elevation chart for recorded altitude

Session review SHALL show an elevation chart when its loaded track contains recorded altitude and label the WGS84 height reference. The chart SHALL share the session elapsed-time viewport, selection, and map-filter intervals. It SHALL break the plot at missing altitude, location gaps, and excluded intervals.

#### Scenario: Session with altitude

- **WHEN** a finished or current session has recorded altitude in its loaded location track
- **THEN** the chart plots its available values at their elapsed times and can show a single valid point

#### Scenario: Session without altitude

- **WHEN** a session has no recorded altitude
- **THEN** the view omits the elevation chart

#### Scenario: Missing or excluded data

- **WHEN** altitude points are separated by a missing altitude, a location gap, or excluded map time
- **THEN** the chart draws no connecting path across the break

#### Scenario: Inspect or navigate a session

- **WHEN** the rider inspects the elevation chart or changes the shared viewport or map filter
- **THEN** its plot and selection use the same elapsed-time timeline as the other historical charts and the map uses the selected time
