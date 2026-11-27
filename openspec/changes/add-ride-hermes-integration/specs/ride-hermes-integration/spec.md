# Ride Hermes Integration

## Purpose

Allow riders to link a Ride Hermes account and submit a completed Float View session to Hermes for processing.

## ADDED Requirements

### Requirement: Hermes account sign-in and disconnect

Float View SHALL offer Ride Hermes email-and-password sign-in in the Integrations subsection of Settings when configured. A linked account SHALL persist through app restarts using protected token storage. Disconnecting SHALL remove the local credential and cancel unsent submissions for that account. The password SHALL be used only for the active sign-in and SHALL NOT be retained.

#### Scenario: Sign in and restart

- **WHEN** Hermes authenticates the rider and supplies a usable account identity and token
- **THEN** Settings displays the linked account and restores it after restart

#### Scenario: Sign-in canceled or refused

- **WHEN** the rider cancels the prompt or Hermes refuses sign-in
- **THEN** no account is linked by that attempt and the rider can start a new attempt

#### Scenario: Disconnect or expired credential

- **WHEN** the rider disconnects or Hermes rejects the saved credential as expired or revoked
- **THEN** Float View stops sending for that credential and requires sign-in before another submission

### Requirement: Explicit consent for a completed ride

The session action menu SHALL offer **Upload to Ride Hermes** when an account is linked. Float View SHALL submit one eligible completed session only after confirmation that identifies the destination account, the recorded GPS route, and the ride measurements to be shared. Confirmation SHALL apply to the prepared session revision and linked account. Session review SHALL explain why a ride cannot be sent when eligibility fails.

#### Scenario: Consent changes with ride or account

- **WHEN** the session revision or linked account changes after the confirmation is prepared
- **THEN** Float View requires a new confirmation before sending

#### Scenario: Missing route or unsupported payload

- **WHEN** a session is active, has no usable route, or cannot meet the partner's payload requirements
- **THEN** Float View explains why submission is unavailable and sends no ride request

### Requirement: Recorded track and board speed

The upload SHALL use accepted GPS observations and recorded board speed matched on the session's elapsed clock within one second. It SHALL send matched board speed in mph and altitude and horizontal accuracy in metres, using zero for missing altitude or accuracy on the wire. The upload SHALL exclude points without a fresh speed match and SHALL use observed coordinates and timestamps.

#### Scenario: Match board speed to a GPS point

- **WHEN** a GPS point has an eligible nearby board-speed sample in the same continuous span
- **THEN** the transmitted speed comes from the nearest eligible sample, with equal-distance ties resolved by lower sample sequence, and is converted to mph independently of display units

#### Scenario: Gap or missing measurement

- **WHEN** the route includes a recorded gap or a point lacks eligible speed, altitude, or accuracy
- **THEN** the upload keeps the observed timing, skips unmatched speed points, and leaves the local track unchanged

### Requirement: Bounded eligible upload

The backend SHALL require a completed ride with at least three matched points, 60 seconds of included track, and 100 metres of logged distance. It SHALL cap submissions at 2,000 recorded location points and 384 KiB and use Hermes defaults for vehicle and visibility.

#### Scenario: Oversized route

- **WHEN** the prepared route exceeds the upload bounds
- **THEN** the backend reports the limit and sends no request

### Requirement: Account-scoped upload results

Float View SHALL show sending, confirmed, failed, and uncertain outcomes for the linked account and session. It SHALL retain a confirmed Hermes ride ID across restart and SHALL NOT report trail or leaderboard processing as complete based only on the upload receipt.

#### Scenario: Acknowledged receipt

- **WHEN** Hermes returns a usable ride ID
- **THEN** Float View persists the receipt for the submitting account and shows that the ride was accepted

#### Scenario: Late response after account change

- **WHEN** an earlier account's upload response arrives after switching accounts
- **THEN** it does not update the visible result for the replacement account

### Requirement: Safe submission recovery

Float View SHALL prevent concurrent submissions of the same ride by the same account and SHALL NOT automatically repeat a request whose outcome is uncertain. It SHALL use Hermes-supported reconciliation or idempotency when available. Otherwise, it SHALL explain that the upload could not be confirmed, prompt the rider to check the outcome in Hermes, and send again only when the rider explicitly retries.

#### Scenario: Repeated submission

- **WHEN** a rider repeats the send action during an in-flight attempt or after a confirmed receipt
- **THEN** Float View shows the existing attempt or receipt without creating another upload

#### Scenario: Lost response or restart during submission

- **WHEN** submission may have reached Hermes and the app has no confirmed receipt
- **THEN** the next view recovers the uncertain outcome, offers a link to Ride Hermes, and offers an explicit retry
