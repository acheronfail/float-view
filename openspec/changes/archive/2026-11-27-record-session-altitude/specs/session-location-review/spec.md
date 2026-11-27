## ADDED Requirements

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
