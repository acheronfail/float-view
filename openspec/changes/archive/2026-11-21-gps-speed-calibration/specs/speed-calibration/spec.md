# Speed calibration

## Purpose

Help riders calibrate effective wheel diameter using reliable phone speed observations and apply only an audited diameter change.

## ADDED Requirements

### Requirement: Explicit temporary calibration

A connected controller SHALL offer an explicit speed-calibration flow independent of route recording. Calibration SHALL remain owned by the shared service across view recreation, use bounded temporary observations, and stop when the rider finishes with an approved result, cancels, or reaches the deadline, disconnect or controller replacement. No calibration-only coordinates SHALL be persisted.

#### Scenario: Start and cancel

- **WHEN** a rider starts calibration with location access and later cancels
- **THEN** temporary capture starts and stops without changing route-recording settings or writing motor configuration

#### Scenario: Lifecycle interruption

- **WHEN** the controller disconnects or is replaced during calibration
- **THEN** the old calibration cannot collect observations or apply a result to the new connection

### Requirement: Quality-gated recommendation

Calibration SHALL compare time-aligned native speed estimates with board speed using bounded observation windows. Missing accuracy, stale/duplicate observations, wheelslip and unbounded telemetry gaps SHALL NOT count. Reported uncertainty SHALL contribute to aggregate result quality rather than require near-perfect individual fixes. A recommendation SHALL require sufficient consistent measurements; other motor settings remain outside calibration scope.

#### Scenario: Consistent correction

- **WHEN** enough eligible observations consistently measure phone speed at 96 percent of board speed
- **THEN** the recommendation is 96 percent of the starting wheel diameter with a clear review result

#### Scenario: Insufficient evidence

- **WHEN** observations are missing, inaccurate, inconsistent or insufficient
- **THEN** the flow identifies unavailable or inconsistent measurements without fabricating a recommendation or giving unrelated rider advice

#### Scenario: Usable imperfect observations

- **WHEN** native speed fixes have nonzero uncertainty and board updates arrive with bounded radio jitter
- **THEN** time-aligned measurements can advance progress and a recommendation requires aggregate accuracy and consistency checks

#### Scenario: Measurement count is not completion

- **WHEN** at least the minimum number of comparisons exists but aggregate uncertainty or consistency still fails
- **THEN** capture continues with a specific quality status, an approximate progress indication without a sample count or fixed-count promise, and no enabled Finish action until a result has passed all quality checks

#### Scenario: Stable result with optional refinement

- **WHEN** a recommendation first passes all quality checks
- **THEN** it remains available to finish immediately while capture continues, and later rejected or inconsistent observations cannot revoke it

### Requirement: Recommendation survives unsupported application

A valid recommendation SHALL display the recommended diameter in millimetres and simple manual VESC Tool guidance even when automatic application is unsupported. If the current diameter cannot be read, the flow SHALL allow the rider to supply it for an advisory result without granting write authority.

#### Scenario: Unknown configuration layout

- **WHEN** speed calibration succeeds but the controller configuration layout is unsupported
- **THEN** the rider sees the recommended diameter and manual instructions with no enabled Apply action

### Requirement: Narrow verified diameter application

An explicit Apply SHALL require an audited firmware/configuration layout, the original controller generation and route, fresh idle normal-mode authority and exclusive mutation ownership. It SHALL preserve all unrelated configuration, reject a changed starting diameter and verify full readback before reporting success. Arbitrary configuration bytes SHALL NOT be accepted from public callers.

#### Scenario: Supported application

- **WHEN** an eligible rider applies a recommendation after stopping
- **THEN** only the diameter is intentionally changed and success follows verified readback

#### Scenario: Uncertain write outcome

- **WHEN** acknowledgement or readback fails, differs, or the controller disconnects
- **THEN** success is withheld, no blind write retry occurs, and the UI explains that the board setting must be checked

### Requirement: Simple accessible calibration controls

The UI SHALL describe what calibration measures and display its current measurement status without unrelated rider advice or assumptions about other settings. Pointer and keyboard actions SHALL activate once; errors and unavailable Apply reasons SHALL preserve the recommendation. Restoring a view SHALL never replay Start, Finish or Apply.

#### Scenario: Review while moving

- **WHEN** a recommendation is available while the board is riding
- **THEN** Apply is disabled with an explanation that application requires an idle board and no mutation is sent

### Requirement: Observable measurement eligibility

During capture the backend SHALL publish a bounded status identifying missing GPS, missing board data, lack of movement, excessive uncertainty, changing speeds, aggregate uncertainty requiring more comparisons, or inconsistent GPS/board comparisons. Diagnostics SHALL record bounded counts and status without coordinates or raw speed values.

#### Scenario: No usable speed

- **WHEN** GPS or board observations cannot contribute to calibration
- **THEN** the screen shows the corresponding measurement status and a diagnostic report can distinguish the missing source without exposing location

### Requirement: Glanceable collection

Collection SHALL show a large labelled board speed in preferred units, one prominent actionable state distinguishing low speed, changing speed and mismatched speeds. Before readiness, the screen SHALL omit sample counts, process explanations and completion reminders; low speed MAY show its minimum threshold. Brief pauses SHALL preserve comparisons. The backend SHALL publish its minimum comparison speed.

#### Scenario: Ordinary street speed variation

- **WHEN** speed changes between otherwise eligible stretches
- **THEN** comparisons pause without resetting collected evidence, and the screen identifies speed variation rather than implying an excessive absolute speed

#### Scenario: Large accessible status

- **WHEN** collection is active in metric or imperial units
- **THEN** speed and one concise state remain legible, and brief rejected intervals do not make the prominent state flicker

### Requirement: Bounded optional refinement

The UI SHALL enable Finish only after an estimate passes the existing quality checks and explain that more measurements may improve precision. Collection SHALL retain the approved estimate with the lowest modelled relative uncertainty and end when the rider finishes or the original three-minute deadline expires. At the deadline it SHALL retain the best approved result or report insufficient evidence. View recreation SHALL NOT reset the deadline. No accuracy guarantee SHALL be made.

#### Scenario: Deadline without convergence

- **WHEN** three minutes elapse without a quality-approved estimate
- **THEN** temporary calibration capture stops and the screen explains that no reliable estimate was obtained

### Requirement: Bounded observation influence

A small number of unusually low reported uncertainties SHALL NOT indefinitely prevent an otherwise consistent, sufficiently observed ride from completing. Aggregate diagnostics SHALL distinguish insufficient effective evidence, estimated uncertainty, outliers and drift without raw GPS speed, individual uncertainty observations or coordinates.

#### Scenario: GPS precision changes during capture

- **WHEN** a few nominally precise observations are followed by many agreeing eligible observations with larger uncertainty
- **THEN** the estimator bounds each reading's influence and may complete once independent evidence and aggregate quality pass

### Requirement: Retained calibration outcomes

Every completed attempt SHALL retain a bounded outcome incident with duration and rejection counts so a later export includes evidence for slow successes and unsuccessful attempts. Individual GPS observations SHALL NOT be persisted. Known historical diagnostic codes SHALL remain readable while their saved diagnostic format is supported.

#### Scenario: Later export after calibration

- **WHEN** a rider exports logs after a completed calibration attempt
- **THEN** the report includes its bounded outcome evidence, and supported records from earlier status vocabulary remain exportable without deleting the saved store

#### Scenario: Busy retained incident

- **WHEN** calibration completes near a recent incident whose event budget is full
- **THEN** its final outcome remains exportable within the existing diagnostic bounds and clipping is disclosed

### Requirement: Approximate calibration progress

The shared service SHALL publish an approximate progress value based on accepted evidence and aggregate uncertainty. It SHALL advance monotonically within an attempt, hold during measurement pauses and reach full when a recommendation first passes all existing quality checks. View recreation SHALL preserve it; a new attempt SHALL reset it. The UI SHALL show one themed bar labelled as approximate, without a sample target, countdown or extra process copy.

#### Scenario: More measurements still needed

- **WHEN** the minimum sample count is met but quality checks still fail
- **THEN** the progress indicator remains below full and collection continues under the existing deadline and quality rules

#### Scenario: GPS pause and view restoration

- **WHEN** GPS readings are temporarily rejected or the collection view is closed and reopened
- **THEN** the last progress estimate is retained without advancing from elapsed time

#### Scenario: Result available

- **WHEN** a recommendation passes the existing quality checks
- **THEN** progress reaches full and the rider can finish immediately or keep collecting eligible observations

#### Scenario: Deteriorating GPS after readiness

- **WHEN** later observations are rejected, inconsistent or produce a higher modelled relative uncertainty
- **THEN** the best approved recommendation remains available and Finish stops capture without writing configuration

#### Scenario: Deadline after readiness

- **WHEN** the original collection deadline arrives after a result was approved
- **THEN** capture stops with the best approved recommendation and no automatic motor configuration write

#### Scenario: Live status after readiness

- **WHEN** a result is available while capture continues and GPS or riding eligibility changes
- **THEN** the screen continues updating its live status, warning colour and applicable minimum-speed hint, while Finish remains available and the retained result is preserved
