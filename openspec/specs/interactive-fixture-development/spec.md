# Interactive fixture development

## Purpose

Define the development-only SvelteKit control surface, serial coordinator, source-faithful VESC/Refloat simulation, and software verification contract for manually exercising Float View against the programmable ESP32 fixture.

## Requirements

### Requirement: Development-only fixture entry point

The repository SHALL provide `just fixture dev [port]` as the public entry point for a SvelteKit development server at `http://127.0.0.1:11004` that controls the programmable ESP32 fixture. The application MUST run only through the Vite development loop and MUST NOT introduce a production adapter, build artifact, preview command, separate package, separate lockfile, deployment, or production runtime.

#### Scenario: Start without a selected port

- **WHEN** a developer runs `just fixture dev` without a serial path
- **THEN** the loopback control application starts detached and presents the bounded set of enumerated serial ports for explicit selection

#### Scenario: Start with a selected port

- **WHEN** a developer runs `just fixture dev <port>`
- **THEN** the control application starts and attempts a bounded attachment to exactly that port

#### Scenario: Development hot replacement

- **WHEN** fixture browser UI source changes or its page reloads
- **THEN** Svelte hot replacement updates the control surface without replacing the server-side serial coordinator or interrupting an active BLE session

#### Scenario: Server source changes

- **WHEN** coordinator or other server-side fixture source changes
- **THEN** the developer restarts `just fixture dev` rather than retaining a coordinator instance created from obsolete server code

#### Scenario: No production fixture application

- **WHEN** repository production artifacts are built
- **THEN** no fixture control application is built, copied, packaged, or deployed

### Requirement: Exclusive server-side serial coordination

One server-side fixture coordinator SHALL exclusively own at most one selected serial port, perform the bounded `RESET`/`READY` attachment handshake, consume fixture events continuously, and serialize UI actions with serial-event handling. Browser code MUST NOT access Web Serial or communicate with the ESP32 directly.

#### Scenario: Serial attachment

- **WHEN** a developer explicitly attaches an available serial port
- **THEN** the coordinator opens only that port, resets it, confirms `READY` within a bounded deadline, and publishes an attached powered-off state

#### Scenario: Duplicate attachment

- **WHEN** browser reload, hot replacement, or a second control page resolves the fixture coordinator
- **THEN** all callers observe the same coordinator and no second owner opens the selected serial port

#### Scenario: Attachment failure

- **WHEN** the selected port cannot open, does not complete the fixture handshake, or emits invalid bounded protocol data
- **THEN** the coordinator closes any resource it opened and exposes an actionable detached error state

#### Scenario: Active serial loss

- **WHEN** the owned serial port fails, disappears, or emits malformed or out-of-bounds fixture control data after attachment
- **THEN** the coordinator closes its ownership, publishes detached powered-off unavailable state, preserves the last saved simulated-device configuration, and requires explicit reattachment

#### Scenario: Developer interruption

- **WHEN** the fixture development process is interrupted
- **THEN** it best-effort resets the fixture, turns off its diagnostic LED, closes its owned serial port, and exits within a bounded deadline

### Requirement: High-level interactive fixture state

The controller SHALL expose one atomic configuration action plus idempotent power on, power off, start riding, and stop riding actions while maintaining saved simulated-device configuration, desired power, observed BLE connection, and ride mode as distinct authoritative state.

#### Scenario: Power on

- **WHEN** an attached powered-off fixture receives power on
- **THEN** it begins advertising the canonical VESC UART BLE service and remains logically powered on

#### Scenario: Powered-on peer disconnects

- **WHEN** a BLE peer disconnects while desired power remains on
- **THEN** the coordinator re-advertises without changing ride mode

#### Scenario: Power off while connected

- **WHEN** a connected fixture receives power off
- **THEN** the coordinator stops advertising, disconnects the peer through reset, confirms readiness, and publishes powered-off disconnected state

#### Scenario: Start and stop riding

- **WHEN** a developer starts riding while the fixture is attached and powered on and later stops riding
- **THEN** telemetry requests after each action use riding and idle responses respectively without requiring reconnection

#### Scenario: Ride while powered off

- **WHEN** a developer attempts to start riding while the fixture is detached or powered off
- **THEN** the action is rejected without changing ride state or issuing a serial command

#### Scenario: Duplicate ride action

- **WHEN** start riding is requested while already riding or stop riding is requested while already idle
- **THEN** the action is inert, and a repeated start does not reset the ride seed or sample index

#### Scenario: Action without serial

- **WHEN** a power or ride action requires an unavailable serial fixture
- **THEN** no serial command is issued and the complete state reports an actionable validation error

### Requirement: Composable source-faithful controller variants

The controller SHALL compose one stable THOR300 identity, one audited VESC firmware variant from 6.02, 6.05, 6.06, or 7.00, and one exact Refloat codec from 1.0.0–1.0.1, 1.1.0–1.1.2, or 1.2.0–1.2.3 at runtime. It MUST NOT implement the combinations as a registry of declared board profiles. Each selected controller/package pair SHALL reproduce its source version's identity, read protocol, exact product-control behavior, and version-applicable shutdown behavior rather than changing display labels alone.

#### Scenario: Variant matrix is available

- **WHEN** the control surface loads a complete state snapshot
- **THEN** it offers the audited controller firmware and Refloat values and identifies THOR300 VESC 6.06 with Refloat 1.2.3 as the default

#### Scenario: Configuration saved while powered off

- **WHEN** a developer saves any supported firmware/Refloat pair together with topology and CAN ID while the fixture is powered off and disconnected
- **THEN** the coordinator atomically applies the complete configuration, resets configuration-scoped framing, layout, telemetry, control state, and counters, advances the state revision once, and uses only the new composed identity on the next connection

#### Scenario: Configuration save while active

- **WHEN** a developer attempts to save any changed configuration field while advertising or connected
- **THEN** the server rejects the whole save without changing identity, forwarding, protocol, or control state

#### Scenario: VESC firmware response shape

- **WHEN** the native backend requests controller firmware from a composed audited variant
- **THEN** the response reports that exact version and uses the source-version `COMM_FW_VERSION` layout and version-applicable hardware-CRC tail

#### Scenario: Stable controller model identity

- **WHEN** any selected firmware variant answers controller firmware
- **THEN** it reports the deliberate THOR300 hardware name and VESC hardware type while only source-derived layout, version, and optional-tail fields vary

#### Scenario: Allowlisted controls only

- **WHEN** a normal stable runtime combination receives a source-correct Refloat product control
- **THEN** it applies the bounded semantic state change while unknown, motor-control, and unrelated mutation requests receive no response

#### Scenario: Test-version combinations permit guarded writes

- **WHEN** an audited test-version runtime combination receives any Refloat product-control request
- **THEN** it applies source-correct mutations under the same safety checks as release firmware

#### Scenario: Exact shutdown request

- **WHEN** a release or test VESC 6.05, 6.06, or 7.00 variant receives `[156, 0, 0]` through its selected route while simulated ride state is idle and package mode is not flywheel
- **THEN** it records one shutdown intent and simulates selected-controller disappearance without powering off the ESP32

#### Scenario: Unsupported shutdown shape

- **WHEN** VESC 6.02 or an unrecognised version receives shutdown, or any scenario receives forced, restart, malformed, retried, direct-CAN, or broadcast shutdown
- **THEN** the fixture rejects the request, preserves simulated controller state, and records one bounded diagnostic

### Requirement: Selectable direct and VESC Express topology

The controller SHALL expose each composed controller/package combination either as a directly connected BLE VESC or behind a VESC Express 6.05 BLE transport with a bounded configuration of one or more CAN-connected motor controllers. Controller firmware SHALL be selected from audited stable 6.02, 6.05, 6.06, and 7.00 variants that share one source-faithful `vescCoreReadOnly` identity implementation with version-applicable optional tails. Each Express controller SHALL have one unique canonical decimal CAN ID in the inclusive range `0` through `253`, with the common single-controller configuration defaulting to `1`. Interactive fixture development MAY present the common single-controller editor while conformance composes multiple controllers through the same simulator types.

#### Scenario: Direct controller discovery

- **WHEN** direct topology is selected and the native backend requests firmware
- **THEN** the BLE peer reports the selected controller firmware with VESC hardware type and accepts applicable Refloat requests without CAN forwarding

#### Scenario: Express controller discovery

- **WHEN** Express topology is selected with one controller on CAN ID `42`
- **THEN** the BLE peer first reports VESC Express 6.05 transport identity, CAN discovery returns `42`, and the selected controller identity and applicable Refloat responses are available through CAN-forward command `34` targeting `42`

#### Scenario: Multiple Express controllers

- **WHEN** conformance composes controllers at CAN IDs `17` and `42`
- **THEN** CAN discovery and forwarded firmware probes expose both independent source-faithful identities and route later responses only to the addressed controller

#### Scenario: Forward to another CAN ID

- **WHEN** Express topology is selected and a forwarded request targets an ID other than any configured controller
- **THEN** the simulator returns no controller response and records only a bounded high-level diagnostic

#### Scenario: Invalid CAN ID

- **WHEN** a developer submits `254`, `255`, a negative or fractional number, padded text, a non-decimal representation, nonnumeric input, or a duplicate ID
- **THEN** the server rejects the value without changing retained controller configuration or simulator state

#### Scenario: Direct topology retains CAN input

- **WHEN** direct topology is selected
- **THEN** the CAN-ID input is disabled, no CAN device is advertised, and the last valid Express CAN configuration remains visible and available for a later Express selection

#### Scenario: Topology configuration saved while powered off

- **WHEN** a developer includes changed topology or valid CAN configuration in the complete configuration saved while powered off and disconnected
- **THEN** the coordinator applies it with the firmware and Refloat selections and atomically resets topology-scoped framing, discovery, layout, telemetry, and counters before the next advertisement

#### Scenario: Topology configuration saved while active

- **WHEN** a developer attempts to save changed topology or CAN configuration while advertising or connected
- **THEN** the server rejects the complete save without changing the identity or forwarding path visible to the BLE peer

#### Scenario: Complete topology matrix

- **WHEN** software verification exercises every runtime-composed controller/package pair through direct and single-controller Express topology
- **THEN** table-driven Cartesian tests cover all twenty-four base configurations, with additional multi-controller and invalid/test-identity cases composed from the same controller types rather than separate simulator implementations

#### Scenario: Version-applicable identity suffix

- **WHEN** the fixture encodes audited VESC 6.02, 6.05, 6.06, or 7.00 identity
- **THEN** it emits the complete common identity baseline and the source-applicable bounded hardware-CRC suffix without using the CRC to choose protocol behavior

### Requirement: Version-specific Refloat protocol

Each Refloat codec SHALL implement the source-derived INFO and read-only telemetry protocol of exact package identity 1.0.0, 1.1.0, or 1.2.3. The native compatibility catalog SHALL treat all three exact packages as supported through their matching legacy or dynamic wire family.

#### Scenario: Refloat 1.0.0 INFO

- **WHEN** a client requests Refloat INFO from the 1.0.0 codec
- **THEN** the codec returns the legacy version-1 short INFO response encoding major/minor as `10` for Refloat 1.0.0 even when the request asks for INFO version 2

#### Scenario: Refloat 1.0.0 telemetry

- **WHEN** a client sends an allowlisted legacy realtime or compact all-data request to the 1.0.0 codec
- **THEN** the response uses the corresponding fixed legacy layout and the codec does not advertise dynamic commands 31 or 32

#### Scenario: Refloat 1.1.0 protocol

- **WHEN** a client requests INFO, realtime IDs, or realtime data from the 1.1.0 codec
- **THEN** the codec returns INFO version 2 with package version 1.1.0 and uses the 1.1 dynamic ID and float16 data layouts without the 1.2 alert tail

#### Scenario: Refloat 1.2.3 protocol

- **WHEN** a client requests INFO, realtime IDs, or realtime data from the 1.2.3 codec
- **THEN** the codec returns INFO version 2 with package version 1.2.3 and uses the 1.2 dynamic layout, mask, and bounded alert/fault tail

#### Scenario: Native compatibility matches fixture packages

- **WHEN** either native backend connects to any selected 1.0.0, 1.1.0, or 1.2.3 package
- **THEN** it selects the matching protocol family, reports source package 1.0.0 using its detectable wire version `1.0`, reaches `ready`, and requests only packets supported by that source-faithful codec

#### Scenario: Direct telemetry is supported

- **WHEN** either native backend connects directly to a supported THOR300 and Refloat combination
- **THEN** the fixture answers direct identity, layout when applicable, and telemetry requests and the backend produces frontend riding telemetry without CAN forwarding

### Requirement: Read-only Refloat device simulation

While powered on, the coordinator SHALL answer the composed configuration's allowlisted VESC transport identity, optional CAN discovery, controller identity, Refloat identity, applicable telemetry reads, exact Refloat product controls, and exact eligible VESC-core shutdown for recognised release and test firmware through real BLE. It MUST NOT answer forced-shutdown, restart, broadcast-shutdown, motor-control, firmware-write, arbitrary persistent-configuration, tuning, recording, history, Handtest, remote, RC-move, unknown, or malformed requests. Audited test-version firmware SHALL permit the same guarded writes as release firmware.

#### Scenario: Native backend connects

- **WHEN** a production native backend discovers and connects to the advertising ESP32
- **THEN** the coordinator services its identity, topology, Refloat layout, telemetry, and eligible product-control requests using conformance-owned framing and fixtures

#### Scenario: Eligible control request

- **WHEN** the writable native peer sends a version-correct package, flywheel, lighting, or clear-fatal request
- **THEN** interactive mode updates its complete simulated control state and supplies the exact immediate or telemetry confirmation without commanding ESP32 motor hardware

#### Scenario: Mutation while flywheel is active

- **WHEN** simulated package mode is flywheel and the native peer sends any mutating request other than an eligible flywheel-disable command
- **THEN** interactive mode supplies no successful response and preserves all simulated state, while the exact flywheel-disable command may return the model to normal mode

#### Scenario: Unsafe request

- **WHEN** the native peer sends an unknown or prohibited mutating VESC request
- **THEN** interactive mode supplies no response, records a bounded actionable diagnostic without terminating its serial loop, and does not weaken canonical conformance's fail-fast request allowlist

#### Scenario: Canonical conformance remains deterministic

- **WHEN** automated physical conformance uses its fixture scenarios
- **THEN** scripted telemetry and control phases, exact fixture responses, cadence assertions, safety rejections, and cleanup behavior remain deterministic

#### Scenario: Shutdown does not power off the fixture

- **WHEN** automated physical conformance accepts an eligible shutdown request
- **THEN** the host-owned scenario models controller loss while the ESP32 remains powered, emits no motor action, and remains available for deterministic cleanup

### Requirement: Plausible interactive telemetry

The interactive simulator SHALL encode the selected Refloat codec's legacy or dynamic telemetry layout from one normalized sample model and generate bounded, seeded, smoothly varying values whose related fields remain coherent. Ride mode SHALL control the next telemetry response rather than running an unsolicited telemetry stream.

#### Scenario: Riding telemetry

- **WHEN** ride mode is riding and the native backend requests telemetry repeatedly
- **THEN** responses report a riding board state, both footpads active, nonzero speed and ERPM, correlated bounded load values, plausible pack voltage, and slowly changing temperatures

#### Scenario: Idle telemetry

- **WHEN** ride mode is idle and the native backend requests telemetry
- **THEN** the response reports idle state, inactive footpads, zero speed, ERPM, duty-related motion, and current while retaining plausible bounded voltage and temperature

#### Scenario: Smooth reproducible samples

- **WHEN** the same seeded ride receives the same sequence of telemetry requests
- **THEN** it produces the same values and adjacent samples remain within defined change bounds

#### Scenario: Equivalent values across package encodings

- **WHEN** equivalent seeded ride samples are encoded through Refloat 1.0.0, 1.1.0, and 1.2.3 response formats
- **THEN** decoding each format yields equivalent core state, footpad, voltage, duty, current, ERPM, speed, and temperature values within each format's precision

#### Scenario: Stop takes effect

- **WHEN** stop riding completes before the next telemetry request
- **THEN** that next response is idle rather than consuming a remaining scripted riding phase

### Requirement: Loopback authenticated control surface

The fixture development server SHALL bind only to `127.0.0.1:11004` and SHALL require exact Origin `http://127.0.0.1:11004` and a random per-process launch token supplied to the server-rendered control page for every state-changing request. Requests, bodies, responses, polling, diagnostics, queues, and retained state MUST be bounded.

#### Scenario: Valid local action

- **WHEN** the control page submits a bounded action with the expected loopback Origin and launch token
- **THEN** the server applies the action once and returns a complete state snapshot with a monotonically increasing revision

#### Scenario: Unauthorized action

- **WHEN** a mutation omits or changes the Origin or launch token
- **THEN** the server rejects it without changing coordinator or serial state

#### Scenario: Development port occupied

- **WHEN** the fixed fixture development port is unavailable
- **THEN** startup fails with an actionable diagnostic instead of binding another port or a non-loopback interface

#### Scenario: Bounded diagnostics

- **WHEN** serial, BLE, request, or action events continue for an extended development session
- **THEN** the control surface retains only bounded high-level diagnostics and counters without logging full telemetry, launch tokens, or Bluetooth identifiers

### Requirement: Observable and accessible manual controls

The Svelte control surface SHALL present serial attachment, one saved-configuration form containing direct or Express topology, retained Express CAN ID, controller firmware, and exact Refloat package, plus desired power, observed BLE connection, ride mode, current synthetic telemetry, bounded diagnostics, and request counters from complete authoritative snapshots. Interactive controls MUST retain native button semantics and support primary pointer and keyboard activation without double activation.

#### Scenario: State refresh

- **WHEN** the coordinator revision advances because of an action or serial event
- **THEN** bounded polling replaces the displayed state with the complete newer snapshot

#### Scenario: Unavailable action

- **WHEN** current state makes a control unavailable
- **THEN** the control is visibly disabled and does not issue a mutation

#### Scenario: Active configuration controls

- **WHEN** the fixture is advertising or connected
- **THEN** topology, CAN-ID, firmware, Refloat, and Save controls are visibly disabled while displaying the identity and forwarding path currently presented over BLE

#### Scenario: Atomic configuration form

- **WHEN** the developer edits one or more configuration fields and activates Save while powered off
- **THEN** the client submits all topology, CAN-ID, firmware, and Refloat fields in one mutation and replaces its form from the returned authoritative snapshot

#### Scenario: Ride control availability

- **WHEN** the fixture is detached, powered off, already riding, or already idle
- **THEN** start and stop controls are enabled only for their valid powered-on transition and cannot issue duplicate ride mutations

#### Scenario: Keyboard activation

- **WHEN** a focused enabled high-level control is activated from the keyboard
- **THEN** its action occurs exactly once

### Requirement: Software-only verification

The complete software gate SHALL type-check and test the fixture development server, ownership/import boundaries, coordinator, composable variant catalog, direct and CAN-forwarded request paths, version-specific protocol encoders, telemetry encoder, and Svelte controls without requiring an ESP32, native device, production fixture build, or deployed server.

#### Scenario: Repository verification

- **WHEN** `just verify` runs without physical hardware
- **THEN** fake serial controls exercise attachment and active loss, the table-generated Cartesian matrix, configurable CAN forwarding, atomic configuration, powered-on ride transitions, reconnect, version-specific interactive and canonical request policies, direct/older-package compatibility limits, telemetry relationships, UI-only HMR coordinator reuse, and cleanup while no fixture web artifact is built

#### Scenario: Physical use remains explicit

- **WHEN** a developer wants to use interactive real BLE simulation
- **THEN** they explicitly run the development command with a flashed ESP32 near a Bluetooth-capable selected native target

### Requirement: Editable scenario workbench

`just fixture dev` SHALL provide a manual scenario workbench that composes an editable BLE endpoint, at most 16 controller candidates, at most 64 discovered CAN IDs, audited VESC 6.02/6.05/6.06/7.00 identities, source-package identities, discovery behavior, notification fragmentation, and semantic telemetry state while a separately launched `just dev <platform>` application is operated by the developer. The workbench MUST NOT automatically drive the product, choose the product's active controller, assert product outcomes, or report pass/fail. Float View SHALL request telemetry from only its one selected route even when the scenario advertises multiple candidates; an audited test-version selection SHALL permit guarded writes.

#### Scenario: Reproduce a reported setup

- **WHEN** a developer configures an Express endpoint, a non-motor CAN node, two motor controllers, and a controller omitted from ping
- **THEN** the simulator answers the developer-operated application's requests according to that topology until the developer changes or powers off the scenario

#### Scenario: Manual investigation

- **WHEN** the connected product reaches a state the developer wants to inspect
- **THEN** the workbench waits for manual actions and does not advance through a scripted test or select a controller on the product's behalf

#### Scenario: Audited controller version selection

- **WHEN** a developer selects VESC 6.02, 6.05, 6.06, or 7.00 while the scenario is powered off
- **THEN** the next identity response changes source-faithfully and composes with any audited Refloat release without duplicating a declared board profile

### Requirement: Bounded shareable scenario documents

The workbench SHALL import and export a versioned human-readable scenario document of at most 65,536 UTF-8 bytes containing topology, public simulated identities, discovery behavior, fragmentation, semantic telemetry baseline, coherent scene selection, and explicit overrides. Documents SHALL be strictly validated. Raw controller UUID bytes, serial paths, launch tokens, power state, and real Bluetooth identifiers MUST NOT be imported, exported, or displayed. A scenario-local controller alias of at most 64 UTF-8 bytes SHALL deterministically resolve to a private simulated UUID on the server.

#### Scenario: Share a bug reproduction

- **WHEN** a developer exports a valid configured scenario and another developer imports it
- **THEN** both workbenches expose equivalent wire identity, topology, discovery, and telemetry behavior without sharing a real controller identifier

#### Scenario: Invalid imported document

- **WHEN** a document is oversized, has an unsupported schema version, duplicate or invalid CAN IDs, excessive nodes, non-finite telemetry, or unknown privileged fields
- **THEN** the server rejects it atomically without changing the retained scenario or active simulator

### Requirement: Semantic telemetry scenes and overrides

The workbench SHALL own one version-independent semantic board-state model and project it into the exact selected Refloat wire family. It SHALL provide coherent manual scenes for idle, engaged, cruise, acceleration, braking, ATR, high current, high duty, field weakening, supported pushback states, temperatures, voltage states, wheelslip, footpad combinations, stop conditions, darkride, hand-test, flywheel, charging, and firmware fault. Developers SHALL be able to override bounded individual values, freeze or resume generated motion, and restore scene defaults.

#### Scenario: Coherent high-load scene

- **WHEN** a developer activates the hard-acceleration scene
- **THEN** requested and actual current, duty, voltage sag, pitch, ATR or torque contribution, and running state change together to a deterministic plausible baseline

#### Scenario: Expert override

- **WHEN** a developer pins controller temperature after choosing a coherent riding scene
- **THEN** subsequent generated samples retain that temperature while other unpinned values continue according to the scene

#### Scenario: Version projection

- **WHEN** the same semantic scene is selected for representative audited Refloat 1.0.x, 1.1.x, and 1.2.x releases
- **THEN** each response uses its source-faithful layout and reports unavailable values as absent rather than inventing equivalent bytes

#### Scenario: Legacy realtime compatibility

- **WHEN** a client sends Refloat 1.0.x command 1
- **THEN** the fixture returns the fixed-layout high-precision realtime response rather than encoding the compact command 10 layout under command 1

### Requirement: Manual connection and identity events

The workbench SHALL provide explicit bounded controls to disconnect and re-advertise, reconnect unchanged, move the same private controller identity to another valid CAN ID, replace a controller identity, change ping visibility, and select a supported notification-fragment bound. Identity or topology mutations that would make an in-flight response ambiguous SHALL occur only through a serialized disconnect-transition-re-advertise action or while powered off.

#### Scenario: Same controller moves

- **WHEN** a developer invokes the move-controller event during an active connection
- **THEN** the coordinator disconnects, applies the CAN-ID change while disconnected, and re-advertises with the same private UUID

#### Scenario: Replacement controller

- **WHEN** a developer invokes the replace-controller event
- **THEN** the next connection exposes a different private UUID at the configured route without exporting or logging either UUID

#### Scenario: Fragmented detailed response

- **WHEN** the fragment bound is set to 20 and a negotiated field-list response is larger than 20 bytes
- **THEN** the exact encoded response is delivered in ordered fragments of at most 20 bytes

### Requirement: Observable workbench state

The control surface SHALL show the resolved topology, semantic state, values available in the selected Refloat family, request classification and route, response kind and fragmentation, counters, and bounded diagnostics. Controls SHALL retain native button semantics and consistent primary-pointer, cancellation, keyboard, and assistive-technology behavior.

#### Scenario: Unsupported source field

- **WHEN** a semantic value is not available in the selected package family
- **THEN** the control surface marks it unavailable instead of showing a transmitted value

#### Scenario: Touch and keyboard actions

- **WHEN** a primary touch pointer or keyboard user activates a state or connection control
- **THEN** the action runs exactly once, while non-primary and cancelled pointer activation do not mutate the workbench

### Requirement: Composable interactive VBMS topology

The fixture development coordinator SHALL extend its existing controller and transport composition with zero, one, or multiple independently routed source-faithful VBMS32 6.06 nodes, including a local direct-BMS topology where the motor controller is behind CAN. Canonical fixtures SHALL retain stock VESC BMS 6.00 separately. It MUST compose node behavior from typed identities and values rather than introduce a registry of complete board combinations.

#### Scenario: One CAN VBMS

- **WHEN** a developer configures one VBMS at CAN ID `42` with a direct controller or Express topology
- **THEN** the next powered-on connection advertises the configured controller topology and answers BMS identity and values only on route `42`

#### Scenario: Direct VBMS transport

- **WHEN** a developer selects the direct-VBMS topology and configures a motor-controller CAN ID
- **THEN** local firmware reports the VBMS identity, CAN discovery exposes the controller, direct command 96 returns BMS values, and controller requests require their CAN route

#### Scenario: Multiple VBMS nodes

- **WHEN** a developer configures multiple distinct valid VBMS CAN IDs
- **THEN** the coordinator exposes every identity deterministically and lets the native backend demonstrate ambiguity or configured selection

#### Scenario: Invalid or duplicate BMS IDs

- **WHEN** configuration supplies an out-of-range, duplicate, fractional, padded, or nondecimal BMS CAN ID or conflicts with another configured node
- **THEN** the complete save is rejected without changing retained simulator state

### Requirement: Plausible deterministic BMS values

The interactive simulator SHALL generate bounded seeded BMS values with coherent total voltage, per-cell voltages, balancing flags, input current, state of charge and health, temperatures, environmental readings, and monotonic counters. Values SHALL advance only when a matching request is received and SHALL support selectable legacy and extended response tails.

#### Scenario: Idle BMS request sequence

- **WHEN** the same saved configuration and seed receive the same sequence of BMS values requests
- **THEN** they return the same smoothly varying values and counters within source-derived bounds

#### Scenario: Coherent pack values

- **WHEN** the simulator returns a BMS snapshot
- **THEN** total voltage is coherent with bounded per-cell voltages, balancing flags match configured cells, and charge, health, temperature, humidity, and pressure remain plausible

#### Scenario: Legacy and extended variants

- **WHEN** a developer selects either supported response variant
- **THEN** the coordinator emits the exact fixed response or exact data-version-plus-status extension without changing shared normalized values

#### Scenario: Timeout and malformed modes

- **WHEN** the developer selects a bounded BMS timeout or malformed-response mode
- **THEN** only the matching configured BMS request is affected and controller identity and Refloat telemetry remain available

### Requirement: Observable BMS fixture controls

The fixture control surface SHALL expose bounded atomic BMS topology, CAN-ID, response-variant, values, and failure controls alongside existing controller configuration. It SHALL show BMS request counters and high-level route diagnostics without retaining full telemetry, UUIDs, or unbounded packet data.

#### Scenario: Active configuration lock

- **WHEN** the fixture is advertising or connected
- **THEN** BMS topology and value configuration controls are visibly disabled and a save cannot change active wire behavior

#### Scenario: Atomic powered-off save

- **WHEN** a developer saves valid controller and BMS configuration while powered off
- **THEN** the coordinator validates and applies the entire composition once, resets topology-scoped counters and framing, and publishes one newer complete fixture state

#### Scenario: Accessible BMS controls

- **WHEN** BMS controls are operated by primary pointer or keyboard
- **THEN** native control semantics are retained and each enabled action occurs exactly once

### Requirement: Version-specific disposable Refloat configuration

The interactive fixture SHALL compose each selected audited Refloat release with its exact source-derived compressed custom schema, signature, defaults, and mutable current configuration at index `0`. It SHALL implement commands 92–95 with source-correct chunks and complete signed values through the existing direct/CAN topology, validate full writes, reproduce documented firmware normalization, and make later command 93 reads reflect accepted values. Configuration state SHALL be disposable, bounded, non-actuating, reset when the selected package changes, and available to canonical scripted scenarios without moving scenario logic into ESP32 firmware.

#### Scenario: Schema chunk sequence

- **WHEN** a client requests bounded command-92 chunks for a selected exact package
- **THEN** the fixture returns the exact total length, requested offset, and source-derived bytes without serving another release's schema

#### Scenario: Current and defaults remain distinct

- **WHEN** an accepted write changes current state and the client subsequently requests commands 93 and 94
- **THEN** current reports the accepted canonical values while defaults remain the exact selected-release defaults

#### Scenario: Package selection changes

- **WHEN** the powered-off fixture is changed to another exact Refloat version
- **THEN** schema, signature, current/default values, and configuration counters reset atomically before the next advertisement

#### Scenario: No motor actuation

- **WHEN** any valid configuration write is accepted
- **THEN** only disposable simulated configuration state changes and no ESP32 pin or command can actuate a motor

### Requirement: Strict custom-configuration rejection

Custom-configuration mutations SHALL require audited writable firmware, index `0`, complete valid signatures/values and safe normal mode. The fixture SHALL reject unknown indexes, malformed/partial values, unsafe state, arbitrary app-data tuning, firmware/motor-control writes and motor configuration beyond audited diameter-only patches. Flywheel SHALL permit only eligible disable, withhold/invalidate current values and require a fresh command-93 read on return; schema/default reads remain available.

#### Scenario: Test firmware write

- **WHEN** a test-version fixture receives command 95
- **THEN** it applies a complete valid write only under the same version, signature, index, mode, and safety checks as release firmware

#### Scenario: Invalid signature

- **WHEN** command 95 contains a signature from another Refloat release
- **THEN** the fixture preserves all values and later current read returns the unchanged complete configuration

#### Scenario: Existing semantic controls

- **WHEN** a source-correct package, flywheel, lighting, or fatal control is received
- **THEN** its dedicated live-control behavior remains available and coordinated with, but not replaced by, the full configuration model

#### Scenario: Flywheel configuration isolation

- **WHEN** simulated flywheel mode is active and a client requests command 93, command 95, Tune apply, or another mutation
- **THEN** the fixture supplies no current snapshot or mutation success except for eligible flywheel disable and preserves disposable persistent configuration values

### Requirement: Read-only lighting refresh during flywheel simulation

The interactive and canonical fixture coordinator SHALL use the same source-faithful lighting model. While simulated flywheel mode is active it SHALL answer exact zero-mask legacy and stable lighting status queries from current disposable state, SHALL preserve that state, and SHALL continue to reject every nonzero-mask lighting mutation until eligible flywheel disable returns the package to normal mode.

#### Scenario: Interactive flywheel lighting refresh

- **WHEN** a connected native backend performs its bounded zero-mask lighting refresh while the interactive fixture is in flywheel mode
- **THEN** the coordinator returns current LED and headlight state without recording a mutation or changing either value

#### Scenario: Interactive flywheel lighting mutation

- **WHEN** the same peer sends a nonzero-mask LED or headlight mutation while flywheel mode remains active
- **THEN** the coordinator supplies no successful response and preserves all simulated state

### Requirement: Diameter-only motor fixture writes

The fixture SHALL accept motor configuration writes only for an audited layout, with idle normal-mode authority and unchanged bytes outside wheel diameter. Unknown layouts, malformed extents, invalid diameters and unrelated changes SHALL fail closed. Accepted changes SHALL affect only disposable simulated state.

#### Scenario: Narrow motor write

- **WHEN** an idle peer writes a valid diameter-only patch and reads motor configuration again
- **THEN** the fixture returns that diameter and preserves every unrelated serialized field

#### Scenario: Prohibited mutation

- **WHEN** a peer changes another motor field or writes while riding or in flywheel
- **THEN** the fixture rejects the request and preserves its configuration
