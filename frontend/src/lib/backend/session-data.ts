import {
  type ConnectionContextEvent,
  MAX_SESSION_CURSOR_BYTES,
  MAX_SESSION_MARKER_ROWS,
  type SessionRideMarker,
  MAX_SESSION_DATA_FIELDS,
  MAX_SESSION_DATA_REQUEST_BYTES,
  MAX_SESSION_DATA_RESPONSE_BYTES,
  MAX_SESSION_EVENT_ROWS,
  MAX_SESSION_LOCATION_GAPS,
  MAX_SESSION_LOCATION_ROWS,
  MAX_SESSION_SAMPLE_ROWS,
  MAX_SESSION_SERIES_BUCKETS,
  MAX_SESSION_SERIES_OBSERVATIONS,
  type SessionFieldDescriptor,
  type SessionLocationPoint,
  type SessionPublishedSnapshot,
} from './contract.ts';

export type SessionDataKind = 'series' | 'samples' | 'events' | 'locations' | 'markers' | 'connectionContexts';
export type SessionDataRange = { startElapsedMs: number; endElapsedMs: number };
export type SessionGapPolicy = { thresholdSeconds: number | null };

export interface SessionDataRequestBase {
  kind: SessionDataKind;
  sessionId: string;
  snapshot: SessionPublishedSnapshot;
  range: SessionDataRange;
}

export interface SessionSeriesRequest extends SessionDataRequestBase {
  kind: 'series';
  fields: string[];
  buckets: number;
  gapPolicy: SessionGapPolicy;
}

export interface SessionSamplesRequest extends SessionDataRequestBase {
  kind: 'samples';
  fields: string[];
  mode: 'window';
  limit: number;
  cursor?: string | null;
}

export interface SessionEventsRequest extends SessionDataRequestBase {
  kind: 'events';
  limit: number;
  cursor?: string | null;
}

export interface SessionConnectionContextsRequest extends SessionDataRequestBase {
  kind: 'connectionContexts';
  limit: number;
  cursor?: string | null;
}
export interface SessionConnectionContextsResult {
  kind: 'connectionContexts';
  sessionId: string;
  snapshot: SessionPublishedSnapshot;
  range: SessionDataRange;
  contexts: ConnectionContextEvent[];
  nextCursor: string | null;
}

export interface SessionMarkersRequest extends SessionDataRequestBase {
  kind: 'markers';
  limit: number;
  cursor?: string | null;
}
export interface SessionMarkersResult {
  kind: 'markers';
  sessionId: string;
  snapshot: SessionPublishedSnapshot;
  range: SessionDataRange;
  markers: SessionRideMarker[];
  nextCursor: string | null;
}

export interface SessionLocationsRequest extends SessionDataRequestBase {
  kind: 'locations';
  limit: number;
  cursor?: string | null;
}

export type SessionDataRequest =
  | SessionSeriesRequest
  | SessionSamplesRequest
  | SessionEventsRequest
  | SessionLocationsRequest
  | SessionMarkersRequest
  | SessionConnectionContextsRequest;

export interface SessionSeriesColumn {
  elapsedMs: number[];
  sequence: number[];
  values: (number | null)[];
  generations: number[];
}

export interface SessionSeriesResult {
  kind: 'series';
  sessionId: string;
  snapshot: SessionPublishedSnapshot;
  range: SessionDataRange;
  gapPolicy: SessionGapPolicy;
  fields: SessionFieldDescriptor[];
  columns: Record<string, SessionSeriesColumn>;
}

export interface SessionSamplesResult {
  kind: 'samples';
  sessionId: string;
  snapshot: SessionPublishedSnapshot;
  range: SessionDataRange;
  mode: 'window';
  fields: SessionFieldDescriptor[];
  elapsedMs: number[];
  sequence: number[];
  values: Record<string, (number | null)[]>;
  nextCursor: string | null;
}

export interface SessionFaultDetails {
  rawCode: number;
  occurredElapsedMs: number | null;
}
export interface SessionTimeoutDetails {
  active: boolean;
  sourceTicks: number;
  occurredElapsedMs: number | null;
}
export interface SessionEventPage {
  timeouts?: (SessionTimeoutDetails | null)[];
  /** Present on current backends; old event fixtures remain readable. */
  faults?: (SessionFaultDetails | null)[];
  elapsedMs: number[];
  sequence: number[];
  sourceSampleSequence: number[];
  kinds: string[];
  values: string[];
}

export interface SessionEventsResult {
  kind: 'events';
  sessionId: string;
  snapshot: SessionPublishedSnapshot;
  range: SessionDataRange;
  page: SessionEventPage;
  nextCursor: string | null;
}

export interface SessionLocationsResult {
  kind: 'locations';
  sessionId: string;
  snapshot: SessionPublishedSnapshot;
  range: SessionDataRange;
  points: SessionLocationPoint[];
  gaps: Array<{
    startElapsedMs: number;
    endElapsedMs: number;
    reason: 'providerUnavailable' | 'permissionUnavailable' | 'noFix' | 'unknown';
  }>;
  nextCursor: string | null;
  locationBoundary: {
    lastSequence: number;
    lastElapsedMs: number;
  };
}

export type SessionDataResult =
  | SessionSeriesResult
  | SessionSamplesResult
  | SessionEventsResult
  | SessionLocationsResult
  | SessionMarkersResult
  | SessionConnectionContextsResult;

export class SessionDataProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionDataProtocolError';
  }
}

export interface SessionDataReadTiming {
  decodedBytes: number;
  bodyMs: number;
  parseMs: number;
}

const decodedByteSizes = new WeakMap<object, number>();

export function recordSessionDataDecodedBytes(value: SessionDataResult, bytes: number): void {
  decodedByteSizes.set(value, bytes);
}

export function sessionDataDecodedBytes(value: SessionDataResult): number | undefined {
  return decodedByteSizes.get(value);
}

function timestamp(): number {
  return globalThis.performance?.now() ?? Date.now();
}

const finiteInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function validateSessionDataRequest(value: unknown): SessionDataRequest {
  const encoded = JSON.stringify(value);
  if (!encoded || new TextEncoder().encode(encoded).byteLength > MAX_SESSION_DATA_REQUEST_BYTES) {
    throw new SessionDataProtocolError('Session-data request exceeds the body limit');
  }
  if (!value || typeof value !== 'object') throw new SessionDataProtocolError('Session-data request must be an object');
  const request = value as {
    kind?: unknown;
    sessionId?: unknown;
    snapshot?: unknown;
    range?: unknown;
    fields?: unknown;
    buckets?: unknown;
    gapPolicy?: SessionGapPolicy;
    mode?: unknown;
    limit?: unknown;
    cursor?: unknown;
  };
  if (
    request.kind !== 'series' &&
    request.kind !== 'samples' &&
    request.kind !== 'events' &&
    request.kind !== 'locations' &&
    request.kind !== 'markers' &&
    request.kind !== 'connectionContexts'
  ) {
    throw new SessionDataProtocolError('Unsupported session-data request kind');
  }
  if (typeof request.sessionId !== 'string' || request.sessionId.length === 0) {
    throw new SessionDataProtocolError('Session ID is required');
  }
  validateSnapshot(request.snapshot);
  validateRange(request.range);
  if (request.kind === 'series') {
    const fields = validateFields(request.fields);
    const buckets = request.buckets;
    if (!finiteInteger(buckets) || buckets < 1 || buckets > MAX_SESSION_SERIES_BUCKETS) {
      throw new SessionDataProtocolError('Series bucket count is out of bounds');
    }
    const gapPolicy = request.gapPolicy;
    if (
      !gapPolicy ||
      (gapPolicy.thresholdSeconds !== null &&
        (!finiteNumber(gapPolicy.thresholdSeconds) ||
          gapPolicy.thresholdSeconds < 0.1 ||
          gapPolicy.thresholdSeconds > 3_600))
    ) {
      throw new SessionDataProtocolError('Invalid history-gap policy');
    }
    return { ...request, fields, buckets } as SessionSeriesRequest;
  }
  if (request.kind === 'samples') {
    const fields = validateFields(request.fields);
    if (request.mode !== 'window') throw new SessionDataProtocolError('Invalid sample mode');
    const limit = request.limit;
    if (!finiteInteger(limit) || limit < 1 || limit > MAX_SESSION_SAMPLE_ROWS) {
      throw new SessionDataProtocolError('Sample page size is out of bounds');
    }
    if (request.cursor !== undefined && request.cursor !== null) validateCursor(request.cursor);
    return { ...request, fields, limit } as SessionSamplesRequest;
  }
  if (request.kind === 'connectionContexts') {
    if (!finiteInteger(request.limit) || request.limit < 1 || request.limit > 64)
      throw new SessionDataProtocolError('Connection context page size is out of bounds');
    if (request.cursor !== undefined && request.cursor !== null) validateCursor(request.cursor);
    return request as SessionConnectionContextsRequest;
  }
  if (request.kind === 'markers') {
    if (!finiteInteger(request.limit) || request.limit < 1 || request.limit > MAX_SESSION_MARKER_ROWS)
      throw new SessionDataProtocolError('Marker page size is out of bounds');
    if (request.cursor !== undefined && request.cursor !== null) validateCursor(request.cursor);
    return request as SessionMarkersRequest;
  }
  if (request.kind === 'locations') {
    const limit = request.limit;
    if (!finiteInteger(limit) || limit < 1 || limit > MAX_SESSION_LOCATION_ROWS) {
      throw new SessionDataProtocolError('Location page size is out of bounds');
    }
    if (request.cursor !== undefined && request.cursor !== null) validateCursor(request.cursor);
    return { ...request, limit } as SessionLocationsRequest;
  }
  const limit = request.limit;
  if (!finiteInteger(limit) || limit < 1 || limit > MAX_SESSION_EVENT_ROWS) {
    throw new SessionDataProtocolError('Event page size is out of bounds');
  }
  if (request.cursor !== undefined && request.cursor !== null) validateCursor(request.cursor);
  return { ...request, limit } as SessionEventsRequest;
}

export function validateSessionDataResult(value: unknown, request: SessionDataRequest): SessionDataResult {
  if (!value || typeof value !== 'object') throw new SessionDataProtocolError('Session-data result must be an object');
  const result = value as Partial<SessionDataResult>;
  if (result.kind !== request.kind || result.sessionId !== request.sessionId) {
    throw new SessionDataProtocolError('Session-data result identity does not match the request');
  }
  validateSnapshot(result.snapshot);
  if (!sameSnapshot(result.snapshot, request.snapshot)) {
    throw new SessionDataProtocolError('Session-data snapshot changed during the request');
  }
  validateRange(result.range);
  if (
    result.range.startElapsedMs !== request.range.startElapsedMs ||
    result.range.endElapsedMs !== request.range.endElapsedMs
  ) {
    throw new SessionDataProtocolError('Session-data range does not match the request');
  }
  if (result.kind === 'connectionContexts') {
    if (
      !Array.isArray(result.contexts) ||
      result.contexts.length > (request as SessionConnectionContextsRequest).limit ||
      new TextEncoder().encode(JSON.stringify(value)).length > 262_144
    )
      throw new SessionDataProtocolError('Invalid connection context page');
    let previous: ConnectionContextEvent | undefined;
    for (const event of result.contexts) {
      validateConnectionContextEvent(event);
      if (
        event.elapsedMs < request.range.startElapsedMs ||
        event.elapsedMs > request.range.endElapsedMs ||
        event.sequence > request.snapshot.committedEventSequence ||
        (previous && (event.elapsedMs < previous.elapsedMs || event.sequence <= previous.sequence))
      )
        throw new SessionDataProtocolError('Invalid connection context ordering');
      previous = event;
    }
    if (result.nextCursor !== null) validateCursor(result.nextCursor);
    if (result.nextCursor && !result.contexts.length)
      throw new SessionDataProtocolError('Empty continuing context page');
    return result as SessionConnectionContextsResult;
  }
  if (result.kind === 'markers') {
    if (!Array.isArray(result.markers) || result.markers.length > (request as SessionMarkersRequest).limit)
      throw new SessionDataProtocolError('Invalid marker page');
    let previous: SessionRideMarker | undefined;
    for (const marker of result.markers) {
      validateRideMarker(marker);
      if (
        marker.elapsedMs < request.range.startElapsedMs ||
        marker.elapsedMs > request.range.endElapsedMs ||
        marker.sequence > request.snapshot.committedEventSequence ||
        (marker.location && marker.location.locationSequence > request.snapshot.committedLocationSequence) ||
        (previous &&
          (marker.elapsedMs < previous.elapsedMs ||
            (marker.elapsedMs === previous.elapsedMs && marker.sequence <= previous.sequence)))
      )
        throw new SessionDataProtocolError('Invalid marker ordering');
      previous = marker;
    }
    if (result.nextCursor !== null) validateCursor(result.nextCursor);
    return result as SessionMarkersResult;
  }
  if (result.kind === 'series')
    return validateSeriesResult(result as Partial<SessionSeriesResult>, request as SessionSeriesRequest);
  if (result.kind === 'samples')
    return validateSamplesResult(result as Partial<SessionSamplesResult>, request as SessionSamplesRequest);
  if (result.kind === 'locations') return validateLocationsResult(result as Partial<SessionLocationsResult>);
  return validateEventsResult(result as Partial<SessionEventsResult>);
}

function sameSnapshot(left: SessionPublishedSnapshot, right: SessionPublishedSnapshot): boolean {
  return (
    left.historyRevision === right.historyRevision &&
    left.committedSampleSequence === right.committedSampleSequence &&
    left.committedEventSequence === right.committedEventSequence &&
    left.committedElapsedMs === right.committedElapsedMs &&
    left.committedLocationSequence === right.committedLocationSequence &&
    left.committedLocationElapsedMs === right.committedLocationElapsedMs
  );
}

export async function readBoundedJson(response: Response, timing?: SessionDataReadTiming): Promise<unknown> {
  const bodyStarted = timestamp();
  if (!response.body) {
    const text = await response.text();
    const encodedBytes = new TextEncoder().encode(text).byteLength;
    if (timing) timing.decodedBytes = encodedBytes;
    if (timing) timing.bodyMs = timestamp() - bodyStarted;
    if (encodedBytes > MAX_SESSION_DATA_RESPONSE_BYTES) {
      throw new SessionDataProtocolError('Session-data response exceeds the decoded byte limit');
    }
    const parseStarted = timestamp();
    const value = JSON.parse(text);
    if (timing) timing.parseMs = timestamp() - parseStarted;
    return value;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_SESSION_DATA_RESPONSE_BYTES)
        throw new SessionDataProtocolError('Session-data response exceeds the decoded byte limit');
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (timing) timing.decodedBytes = total;
  if (timing) timing.bodyMs = timestamp() - bodyStarted;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parseStarted = timestamp();
  const value = JSON.parse(new TextDecoder().decode(merged));
  if (timing) timing.parseMs = timestamp() - parseStarted;
  return value;
}

function validateSnapshot(value: unknown): asserts value is SessionPublishedSnapshot {
  if (!value || typeof value !== 'object') throw new SessionDataProtocolError('Invalid published snapshot');
  const snapshot = value as SessionPublishedSnapshot;
  if (
    !finiteInteger(snapshot.historyRevision) ||
    !finiteInteger(snapshot.committedSampleSequence) ||
    !finiteInteger(snapshot.committedEventSequence) ||
    !finiteInteger(snapshot.committedElapsedMs) ||
    !finiteInteger(snapshot.committedLocationSequence) ||
    !finiteInteger(snapshot.committedLocationElapsedMs)
  ) {
    throw new SessionDataProtocolError('Published snapshot contains an unsafe integer');
  }
}

function validateRange(value: unknown): asserts value is SessionDataRange {
  if (!value || typeof value !== 'object') throw new SessionDataProtocolError('Invalid session-data range');
  const range = value as SessionDataRange;
  if (
    !finiteInteger(range.startElapsedMs) ||
    !finiteInteger(range.endElapsedMs) ||
    range.endElapsedMs < range.startElapsedMs
  ) {
    throw new SessionDataProtocolError('Invalid session-data range');
  }
}

function validateFields(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_SESSION_DATA_FIELDS ||
    value.some(
      (field) => typeof field !== 'string' || field.length === 0 || new TextEncoder().encode(field).byteLength > 64
    )
  ) {
    throw new SessionDataProtocolError('Session-data fields are out of bounds');
  }
  const fields = [...value];
  if (new Set(fields).size !== fields.length) throw new SessionDataProtocolError('Session-data fields must be unique');
  return fields;
}

function validateCursor(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > MAX_SESSION_CURSOR_BYTES
  ) {
    throw new SessionDataProtocolError('Invalid session-data cursor');
  }
}

function validateSeriesResult(value: Partial<SessionSeriesResult>, request: SessionSeriesRequest): SessionSeriesResult {
  validateFieldDescriptors(value.fields, request.fields);
  if (!value.columns) throw new SessionDataProtocolError('Invalid series columns');
  if (value.gapPolicy?.thresholdSeconds !== request.gapPolicy.thresholdSeconds)
    throw new SessionDataProtocolError('Series gap policy changed');
  let observations = 0;
  const columns: Record<string, SessionSeriesColumn> = {};
  for (const field of request.fields) {
    const column = value.columns[field];
    if (
      !column ||
      !Array.isArray(column.elapsedMs) ||
      !Array.isArray(column.sequence) ||
      !Array.isArray(column.values) ||
      !Array.isArray(column.generations)
    ) {
      throw new SessionDataProtocolError('Missing requested series column');
    }
    const length = column.elapsedMs.length;
    if (column.sequence.length !== length || column.values.length !== length || column.generations.length !== length)
      throw new SessionDataProtocolError('Mismatched series arrays');
    observations += length;
    if (observations > MAX_SESSION_SERIES_OBSERVATIONS)
      throw new SessionDataProtocolError('Series observation bound exceeded');
    for (let i = 0; i < length; i += 1) {
      if (
        !finiteInteger(column.elapsedMs[i]) ||
        !finiteInteger(column.sequence[i]) ||
        !finiteInteger(column.generations[i]) ||
        (column.values[i] !== null && !finiteNumber(column.values[i]))
      )
        throw new SessionDataProtocolError('Invalid series value');
    }
    columns[field] = column;
  }
  return { ...(value as SessionSeriesResult), fields: value.fields, columns };
}

function validateSamplesResult(
  value: Partial<SessionSamplesResult>,
  request: SessionSamplesRequest
): SessionSamplesResult {
  if (
    !Array.isArray(value.elapsedMs) ||
    !Array.isArray(value.sequence) ||
    !value.values ||
    value.elapsedMs.length !== value.sequence.length ||
    value.elapsedMs.length > MAX_SESSION_SAMPLE_ROWS
  )
    throw new SessionDataProtocolError('Invalid sample columns');
  validateFieldDescriptors(value.fields, request.fields);
  for (const field of request.fields) {
    const column = value.values[field];
    if (
      !column ||
      column.length !== value.elapsedMs.length ||
      column.some((item) => item !== null && !finiteNumber(item))
    )
      throw new SessionDataProtocolError('Missing requested sample column');
  }
  value.elapsedMs.forEach((elapsed, index) => {
    if (!finiteInteger(elapsed) || !finiteInteger(value.sequence![index]))
      throw new SessionDataProtocolError('Invalid sample key');
  });
  if (value.nextCursor !== null && value.nextCursor !== undefined) validateCursor(value.nextCursor);
  return value as SessionSamplesResult;
}

function validateEventsResult(value: Partial<SessionEventsResult>): SessionEventsResult {
  const page = value.page;
  if (
    !page ||
    !Array.isArray(page.elapsedMs) ||
    page.elapsedMs.length > MAX_SESSION_EVENT_ROWS ||
    page.sequence.length !== page.elapsedMs.length ||
    page.sourceSampleSequence.length !== page.elapsedMs.length ||
    page.kinds.length !== page.elapsedMs.length ||
    page.values.length !== page.elapsedMs.length
  )
    throw new SessionDataProtocolError('Invalid event page');
  if (page.faults !== undefined && (!Array.isArray(page.faults) || page.faults.length !== page.elapsedMs.length))
    throw new SessionDataProtocolError('Invalid fault details');
  page.faults?.forEach((fault, i) => {
    if (
      fault !== null &&
      (page.kinds[i] !== 'firmwareFaultHistory' ||
        !finiteInteger(fault.rawCode) ||
        fault.rawCode > 255 ||
        (fault.occurredElapsedMs !== null &&
          (!finiteInteger(fault.occurredElapsedMs) || fault.occurredElapsedMs > page.elapsedMs[i]!)))
    )
      throw new SessionDataProtocolError('Invalid fault time');
  });
  if (page.timeouts !== undefined && (!Array.isArray(page.timeouts) || page.timeouts.length !== page.elapsedMs.length))
    throw new SessionDataProtocolError('Invalid timeout details');
  page.timeouts?.forEach((timeout, i) => {
    if (
      timeout !== null &&
      (page.kinds[i] !== 'imuTimeoutHistory' ||
        typeof timeout.active !== 'boolean' ||
        !finiteInteger(timeout.sourceTicks) ||
        timeout.sourceTicks > 0xffffffff ||
        (timeout.occurredElapsedMs !== null &&
          (!finiteInteger(timeout.occurredElapsedMs) || timeout.occurredElapsedMs > page.elapsedMs[i]!)))
    )
      throw new SessionDataProtocolError('Invalid timeout details');
  });
  page.elapsedMs.forEach((elapsed, index) => {
    if (
      !finiteInteger(elapsed) ||
      !finiteInteger(page.sequence[index]) ||
      !finiteInteger(page.sourceSampleSequence[index]) ||
      typeof page.kinds[index] !== 'string' ||
      typeof page.values[index] !== 'string'
    )
      throw new SessionDataProtocolError('Invalid event value');
  });
  if (value.nextCursor !== null && value.nextCursor !== undefined) validateCursor(value.nextCursor);
  return value as SessionEventsResult;
}

function validateLocationsResult(value: Partial<SessionLocationsResult>): SessionLocationsResult {
  if (!Array.isArray(value.points) || value.points.length > MAX_SESSION_LOCATION_ROWS) {
    throw new SessionDataProtocolError('Invalid location points');
  }
  if (!Array.isArray(value.gaps) || value.gaps.length > MAX_SESSION_LOCATION_GAPS) {
    throw new SessionDataProtocolError('Invalid location gaps');
  }
  if (
    !value.locationBoundary ||
    !finiteInteger(value.locationBoundary.lastSequence) ||
    !finiteInteger(value.locationBoundary.lastElapsedMs)
  ) {
    throw new SessionDataProtocolError('Invalid location boundary');
  }
  let previousSequence = -1;
  let previousElapsed = -1;
  for (const point of value.points) {
    if (
      !point ||
      typeof point !== 'object' ||
      !finiteInteger(point.locationSequence) ||
      point.locationSequence <= previousSequence ||
      !finiteInteger(point.elapsedMs) ||
      point.elapsedMs < previousElapsed ||
      typeof point.latitude !== 'number' ||
      !Number.isFinite(point.latitude) ||
      point.latitude < -90 ||
      point.latitude > 90 ||
      typeof point.longitude !== 'number' ||
      !Number.isFinite(point.longitude) ||
      point.longitude < -180 ||
      point.longitude > 180 ||
      (point.accuracyM !== null && (!finiteNumber(point.accuracyM) || point.accuracyM < 0)) ||
      (point.altitudeM !== null && !finiteNumber(point.altitudeM)) ||
      typeof point.observedAt !== 'string' ||
      point.observedAt.length === 0
    ) {
      throw new SessionDataProtocolError('Invalid location point');
    }
    previousSequence = point.locationSequence;
    previousElapsed = point.elapsedMs;
  }
  let previousGapEnd = -1;
  for (const gap of value.gaps) {
    if (
      !gap ||
      !finiteInteger(gap.startElapsedMs) ||
      !finiteInteger(gap.endElapsedMs) ||
      gap.endElapsedMs <= gap.startElapsedMs ||
      gap.startElapsedMs < previousGapEnd ||
      !['providerUnavailable', 'permissionUnavailable', 'noFix', 'unknown'].includes(gap.reason)
    ) {
      throw new SessionDataProtocolError('Invalid location gap');
    }
    previousGapEnd = gap.endElapsedMs;
  }
  if (value.nextCursor !== null && value.nextCursor !== undefined) validateCursor(value.nextCursor);
  return value as SessionLocationsResult;
}

function validateFieldDescriptors(
  value: unknown,
  requested: readonly string[]
): asserts value is SessionFieldDescriptor[] {
  if (!Array.isArray(value) || value.length !== requested.length)
    throw new SessionDataProtocolError('Invalid field descriptors');
  value.forEach((descriptor, index) => {
    if (
      !descriptor ||
      typeof descriptor !== 'object' ||
      (descriptor as SessionFieldDescriptor).name !== requested[index] ||
      ((descriptor as SessionFieldDescriptor).source !== 'stable' &&
        (descriptor as SessionFieldDescriptor).source !== 'extension')
    ) {
      throw new SessionDataProtocolError('Field descriptor does not match the request');
    }
  });
}

export function validateRideMarker(value: unknown): asserts value is SessionRideMarker {
  const m = value as SessionRideMarker | null;
  if (
    !m ||
    !finiteInteger(m.sequence) ||
    m.sequence === 0 ||
    !finiteInteger(m.elapsedMs) ||
    !finiteInteger(m.observedAtMs) ||
    typeof m.operationId !== 'string' ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(m.operationId)
  )
    throw new SessionDataProtocolError('Invalid marker');
  if (m.location !== null) {
    const p = m.location;
    if (
      !p ||
      !finiteInteger(p.locationSequence) ||
      !p.locationSequence ||
      !finiteInteger(p.elapsedMs) ||
      p.elapsedMs > m.elapsedMs ||
      m.elapsedMs - p.elapsedMs > 10_000 ||
      !finiteInteger(p.observedAtMs) ||
      p.observedAtMs > m.observedAtMs ||
      m.observedAtMs - p.observedAtMs > 10_000 ||
      !finiteNumber(p.latitude) ||
      Math.abs(p.latitude) > 90 ||
      !finiteNumber(p.longitude) ||
      Math.abs(p.longitude) > 180 ||
      (p.accuracyM !== null && (!finiteNumber(p.accuracyM) || p.accuracyM < 0))
    )
      throw new SessionDataProtocolError('Invalid marker location');
  }
}

export function validateConnectionContextEvent(value: unknown): asserts value is ConnectionContextEvent {
  const fail = (): never => {
    throw new SessionDataProtocolError('Invalid connection context');
  };
  const object = (value: unknown, keys: string[]): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) return fail();
    return record;
  };
  const event = object(value, ['sequence', 'elapsedMs', 'observedAtMs', 'context']);
  if (
    ![event.sequence, event.elapsedMs, event.observedAtMs].every(finiteInteger) ||
    Number(event.sequence) < 1 ||
    Number(event.elapsedMs) < 0 ||
    Number(event.observedAtMs) < 0
  )
    fail();
  const context = object(event.context, ['version', 'refloatVersion', 'controller', 'transport', 'connection']);
  const versionParts =
    typeof context.refloatVersion === 'string'
      ? /^(\d{1,3})\.(\d{1,3})(?:\.(\d{1,3})(?:-([A-Za-z0-9.+-]{1,20}))?)?$/.exec(context.refloatVersion)
      : null;
  if (
    context.version !== 1 ||
    !versionParts ||
    versionParts.slice(1, 4).some((part) => part !== undefined && Number(part) > 255)
  )
    fail();
  for (const firmware of [context.controller, context.transport]) {
    const f = object(firmware, ['major', 'minor', 'testVersion', 'hardwareName', 'firmwareName']);
    if (![f.major, f.minor, f.testVersion].every((v) => finiteInteger(v) && v >= 0 && v <= 255)) fail();
    for (const name of [f.hardwareName, f.firmwareName])
      if (name !== null && (typeof name !== 'string' || new TextEncoder().encode(name).length > 128)) fail();
  }
  const route = context.connection as Record<string, unknown> | null;
  if (route?.kind === 'direct') object(route, ['kind']);
  else if (route?.kind === 'can') {
    object(route, ['kind', 'canId']);
    if (!finiteInteger(route.canId) || route.canId < 0 || route.canId > 253) fail();
  } else fail();
  if (new TextEncoder().encode(JSON.stringify(event)).length > 4096) fail();
}
