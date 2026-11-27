import { randomBytes } from 'node:crypto';
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  type RefloatTune,
  MAX_MESSAGE_BYTES,
  MAX_SESSION_DATA_REQUEST_BYTES,
  MAX_SESSION_IMPORT_BYTES,
  MAX_APP_TRANSFER_BYTES,
} from '../src/lib/backend/contract.ts';
import { detailedSeriesValues, MockBackend } from './api-v1.ts';
import { validateSessionDataRequest, type SessionDataRequest } from '../src/lib/backend/session-data.ts';
import {
  decodeCursor,
  encodeCursor,
  paginateEvents,
  paginateSamples,
  reduceSeries,
  type ReferenceEvent,
  type ReferenceSample,
} from '../src/lib/backend/session-reference.ts';
import { gzip, crc32 } from 'node:zlib';
import { promisify } from 'node:util';

export const MOCK_BACKEND_PORT = 11003;
export const DEVELOPMENT_ORIGIN = 'http://127.0.0.1:11002';
const DEFAULT_PORT = MOCK_BACKEND_PORT;
const expectedOrigin = DEVELOPMENT_ORIGIN;
const gzipAsync = promisify(gzip);
let sessionToken = randomBytes(32).toString('base64url');
let mockRunning = false;
let activeMockBackend: MockBackend | undefined;

const app = express();
const server = createServer(app);
let wss = createWebSocketServer();

app.get('/api/bootstrap', (_request, response) => {
  response.set('Cache-Control', 'no-store').json({
    webSocketUrl: '/api/ws',
    sessionDataUrl: '/api/session-data',
    sessionExportUrl: '/api/session-export',
    sessionImportUrl: '/api/session-import',
    sessionToken,
    platform: 'web',
  });
});

app.post(['/api/session-import', '/api/app-import'], (request, response) => {
  response.set('Cache-Control', 'no-store');
  if (request.headers.origin !== expectedOrigin || request.headers['x-float-view-token'] !== sessionToken) {
    response.status(403).end();
    return;
  }
  const appImport = request.path === '/api/app-import';
  const maximum = appImport ? MAX_APP_TRANSFER_BYTES : MAX_SESSION_IMPORT_BYTES;
  if (Number(request.headers['content-length'] ?? 0) > maximum) {
    response.status(413).end();
    return;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  request.on('data', (chunk: Buffer) => {
    bytes += chunk.byteLength;
    if (bytes <= maximum) chunks.push(chunk);
  });
  request.on('end', () => {
    if (bytes > maximum) {
      response.status(413).end();
      return;
    }
    if (!activeMockBackend) {
      response.status(503).end();
      return;
    }
    try {
      if (appImport) {
        const entries = readStoredZip(Buffer.concat(chunks));
        const manifest = JSON.parse(entries.get('manifest.json')!.toString('utf8')) as ReturnType<
          MockBackend['appManifest']
        >;
        if (entries.size !== manifest.sessions.length + 1) throw new Error('Missing or unexpected entries');
        for (const [i, session] of manifest.sessions.entries()) {
          const archive = JSON.parse(
            entries.get(`sessions/${String(i + 1).padStart(5, '0')}.floatview`)!.toString('utf8')
          );
          if (archive.sessionId !== session.sessionId || archive.deviceHistoryId !== session.deviceHistoryId)
            throw new Error('Conflicting identity');
        }
        response.json(
          activeMockBackend.importAppManifest(manifest, request.headers['x-float-view-import-settings'] === 'true')
        );
        return;
      }
      const sessionId = activeMockBackend.importSession(Buffer.concat(chunks));
      response.type('application/json').json({ sessionId });
    } catch {
      response.status(400).end();
    }
  });
});

app.post(['/api/session-export', '/api/app-export'], (request, response) => {
  response.set('Cache-Control', 'no-store');
  if (request.headers.origin !== expectedOrigin || request.headers['x-float-view-token'] !== sessionToken) {
    response.status(403).end();
    return;
  }
  if (Number(request.headers['content-length'] ?? 0) > 16_384) {
    response.status(413).end();
    return;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  request.on('data', (chunk: Buffer) => {
    bytes += chunk.byteLength;
    if (bytes <= 16_384) chunks.push(chunk);
  });
  request.on('end', async () => {
    if (bytes > 16_384) {
      response.status(413).end();
      return;
    }
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      const appExport = request.path === '/api/app-export';
      if (appExport) {
        if (!activeMockBackend || Object.keys(payload).some((k) => k !== 'operationId'))
          throw new Error('Invalid request');
        const backend = activeMockBackend;
        const manifest = backend.appManifest();
        const operationId = payload.operationId;
        if (
          operationId !== undefined &&
          (typeof operationId !== 'string' || !backend.beginBoardExportProgress(operationId, 'app'))
        )
          throw new Error('Invalid export operation');
        const entries: { name: string; body: Buffer }[] = [
          { name: 'manifest.json', body: Buffer.from(JSON.stringify(manifest)) },
        ];
        for (const [i, sessionId] of backend.appSessionIds().entries()) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (typeof operationId === 'string' && !backend.advanceBoardExport(operationId, i + 1))
            throw new Error('Cancelled');
          entries.push({
            name: `sessions/${String(i + 1).padStart(5, '0')}.floatview`,
            body: createMockExport(sessionId, 'float-view-archive', backend.archiveIdentity(sessionId)).body,
          });
        }
        if (typeof operationId === 'string' && !backend.advanceBoardExport(operationId, manifest.sessions.length))
          throw new Error('Cancelled');
        response
          .set({
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="float-view-app-transfer.zip"',
          })
          .end(storedZip(entries));
        return;
      }
      const hasBoard = Object.hasOwn(payload, 'savedDeviceId');
      const selector = hasBoard ? payload.savedDeviceId : payload.sessionId;
      const format = payload.format === 'csv' || payload.format === 'float-view-archive' ? payload.format : undefined;
      if (
        (Object.hasOwn(payload, 'operationId') &&
          (!hasBoard ||
            typeof payload.operationId !== 'string' ||
            !/^[a-zA-Z0-9-]{1,128}$/.test(payload.operationId))) ||
        typeof selector !== 'string' ||
        !selector ||
        !format ||
        hasBoard === Object.hasOwn(payload, 'sessionId') ||
        Object.keys(payload).some((key) => !['sessionId', 'savedDeviceId', 'format', 'operationId'].includes(key))
      ) {
        response.status(400).end();
        return;
      }
      const sessions = hasBoard
        ? activeMockBackend?.boardExportSessions(selector)
        : activeMockBackend?.hasSession(selector)
          ? [selector]
          : null;
      if (!sessions) {
        response.status(404).end();
        return;
      }
      if (!sessions.length || sessions.length > 10_000) {
        response.status(400).end();
        return;
      }
      const backend = activeMockBackend!;
      const operationId = typeof payload.operationId === 'string' ? payload.operationId : undefined;
      if (operationId && !backend.beginBoardExportProgress(operationId, selector)) {
        response.status(400).end();
        return;
      }
      const artifacts: ReturnType<typeof createMockExport>[] = [];
      for (const [index, sessionId] of sessions.entries()) {
        if (operationId) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (!backend.advanceBoardExport(operationId, index + 1)) {
            response.status(400).end();
            return;
          }
        }
        artifacts.push(createMockExport(sessionId, format, backend.archiveIdentity(sessionId)));
      }
      const exported = hasBoard
        ? {
            fileName: `float-view-all-sessions-${format}.zip`,
            contentType: 'application/zip',
            body: storedZip(
              artifacts.map((artifact, index) => ({
                name: `${String(index + 1).padStart(5, '0')}-${artifact.fileName}`,
                body: artifact.body,
              }))
            ),
          }
        : artifacts[0]!;
      response.set({
        'Content-Type': exported.contentType,
        'Content-Disposition': `attachment; filename="${exported.fileName}"`,
      });
      response.status(200).end(exported.body);
    } catch {
      response.status(400).end();
    }
  });
});

app.post('/api/session-data', (request, response) => {
  response.set('Cache-Control', 'no-store');
  if (request.headers.origin !== expectedOrigin || request.headers['x-float-view-token'] !== sessionToken) {
    response.status(403).end();
    return;
  }
  let bytes = 0;
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => {
    bytes += chunk.byteLength;
    if (bytes > MAX_SESSION_DATA_REQUEST_BYTES) {
      request.destroy();
      response.status(413).end();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', async () => {
    try {
      const requestValue = validateSessionDataRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const body = JSON.stringify(mockSessionDataResult(requestValue));
      if (request.headers['accept-encoding']?.includes('gzip')) {
        response.set('Content-Encoding', 'gzip');
        response.set('Content-Type', 'application/json');
        response.end(await gzipAsync(Buffer.from(body, 'utf8')));
      } else {
        response.type('application/json').send(body);
      }
    } catch {
      response.status(400).json({ error: { code: 'invalid_request', message: 'Invalid session-data request' } });
    }
  });
});

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const origin = request.headers.origin;
  if (
    url.pathname !== '/api/ws' ||
    url.searchParams.get('token') !== sessionToken ||
    (origin !== expectedOrigin && origin !== undefined)
  ) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (webSocket) => {
    wss.emit('connection', webSocket, request);
  });
});

export function startMockServer(
  port = DEFAULT_PORT,
  options: {
    safetyDisclaimerAccepted?: boolean;
    autoConnectSavedDeviceId?: string | null;
    initialRefloatTunes?: RefloatTune[];
  } = {}
): Promise<number> {
  if (mockRunning) return Promise.reject(new Error('Mock server is already running'));
  sessionToken = randomBytes(32).toString('base64url');
  wss = createWebSocketServer(options);
  return new Promise((resolve, reject) => {
    const handleError = (error: Error) => reject(error);
    server.once('error', handleError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', handleError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Mock server did not bind a TCP port'));
        return;
      }
      mockRunning = true;
      resolve(address.port);
    });
  });
}

function createWebSocketServer(
  options: {
    safetyDisclaimerAccepted?: boolean;
    autoConnectSavedDeviceId?: string | null;
    initialRefloatTunes?: RefloatTune[];
  } = {}
) {
  const value = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const delivery = new WeakMap<import('ws').WebSocket, { sendingState: boolean; pendingState?: string }>();
  function sendNewestState(client: import('ws').WebSocket, payload: string) {
    const state = delivery.get(client) ?? { sendingState: false };
    delivery.set(client, state);
    if (state.sendingState) {
      state.pendingState = payload;
      return;
    }
    state.sendingState = true;
    client.send(payload, () => {
      state.sendingState = false;
      const pending = state.pendingState;
      state.pendingState = undefined;
      if (pending && client.readyState === client.OPEN) sendNewestState(client, pending);
    });
  }
  const backend = new MockBackend((event) => {
    const payload = JSON.stringify(event);
    for (const client of value.clients) {
      if (client.readyState === client.OPEN) sendNewestState(client, payload);
    }
  }, options);
  activeMockBackend = backend;
  let telemetryTimer: NodeJS.Timeout;
  const publishNextSample = () => {
    backend.publishTelemetry();
    telemetryTimer = setTimeout(publishNextSample, backend.telemetryCadenceMs);
    telemetryTimer.unref();
  };
  publishNextSample();
  value.once('close', () => {
    clearTimeout(telemetryTimer);
    if (activeMockBackend === backend) activeMockBackend = undefined;
  });
  let diagnosticClient = 0;
  value.on('connection', (webSocket) => {
    const owner = ++diagnosticClient;
    webSocket.on('close', () => backend.disconnectClient(owner));
    webSocket.on('message', (data) => {
      webSocket.send(JSON.stringify(backend.handlePayload(data.toString(), owner)));
    });
  });
  return value;
}

function mockSessionDataResult(request: SessionDataRequest): Record<string, unknown> {
  if (request.snapshot.historyRevision !== 0) {
    throw new Error('Published session history revision is stale');
  }
  const source: ReferenceSample[] = [
    { elapsedMs: 0, sequence: 0, values: detailedSeriesValues({ packVoltageV: 60, speedKph: 0 }) },
    { elapsedMs: 60_000, sequence: 1, values: detailedSeriesValues({ packVoltageV: 55, speedKph: 20 }) },
  ].filter((row) => row.elapsedMs >= request.range.startElapsedMs && row.elapsedMs <= request.range.endElapsedMs);
  if (request.kind === 'markers' || request.kind === 'connectionContexts') {
    const key = JSON.stringify([request.kind, request.sessionId, request.snapshot, request.range]);
    const cursor = request.cursor ? JSON.parse(Buffer.from(request.cursor, 'base64url').toString()) : null;
    if (
      cursor &&
      (cursor.key !== key || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || cursor.offset > 1000)
    )
      throw new Error('Invalid marker cursor');
    const rows = (
      request.kind === 'markers'
        ? (activeMockBackend?.markerRows(request.sessionId) ?? [])
        : (activeMockBackend?.contextRows(request.sessionId) ?? [])
    ).filter(
      (m) =>
        m.sequence <= request.snapshot.committedEventSequence &&
        m.elapsedMs >= request.range.startElapsedMs &&
        m.elapsedMs <= request.range.endElapsedMs
    );
    const offset = cursor?.offset ?? 0;
    return {
      ...request,
      [request.kind === 'markers' ? 'markers' : 'contexts']: rows.slice(offset, offset + request.limit),
      nextCursor:
        offset + request.limit < rows.length
          ? Buffer.from(JSON.stringify({ key, offset: offset + request.limit })).toString('base64url')
          : null,
    };
  }
  if (request.kind === 'series') {
    return {
      kind: 'series',
      sessionId: request.sessionId,
      snapshot: request.snapshot,
      range: request.range,
      gapPolicy: request.gapPolicy,
      fields: request.fields.map((name) => ({
        name,
        source:
          name === 'motorLoad' || name === 'batteryLoad' || name === 'estimatedBatteryLevel' ? 'extension' : 'stable',
      })),
      columns: reduceSeries(source, request.fields, request.range, request.buckets, request.gapPolicy),
    };
  }
  if (request.kind === 'samples') {
    let nextCursor: string | null = null;
    const cursor = request.cursor ? decodeCursor(request.cursor) : null;
    if (
      cursor &&
      (cursor.sessionId !== request.sessionId ||
        JSON.stringify(cursor.snapshot) !== JSON.stringify(request.snapshot) ||
        JSON.stringify(cursor.range) !== JSON.stringify(request.range))
    ) {
      throw new Error('Cursor does not match the requested snapshot');
    }
    const page = paginateSamples(source, request.limit, cursor);
    const rows = page.rows;
    if (rows.length && rows.length < source.length) {
      const last = rows.at(-1)!;
      nextCursor = encodeCursor({
        sessionId: request.sessionId,
        snapshot: request.snapshot,
        range: request.range,
        elapsedMs: last.elapsedMs,
        sequence: last.sequence,
      });
    }
    return {
      kind: 'samples',
      sessionId: request.sessionId,
      snapshot: request.snapshot,
      range: request.range,
      mode: request.mode,
      fields: request.fields.map((name) => ({
        name,
        source:
          name === 'motorLoad' || name === 'batteryLoad' || name === 'estimatedBatteryLevel' ? 'extension' : 'stable',
      })),
      elapsedMs: rows.map((row) => row.elapsedMs),
      sequence: rows.map((row) => row.sequence),
      values: Object.fromEntries(
        request.fields.map((field) => [field, rows.map((row) => row.values[field as keyof typeof row.values] ?? null)])
      ),
      nextCursor,
    };
  }
  if (request.kind === 'locations') {
    if (request.sessionId !== 'session-1') {
      return {
        kind: 'locations',
        sessionId: request.sessionId,
        snapshot: request.snapshot,
        range: request.range,
        points: [],
        gaps: [],
        nextCursor: null,
        locationBoundary: { lastSequence: 0, lastElapsedMs: 0 },
      };
    }
    const points = [
      {
        locationSequence: 1,
        elapsedMs: 10_000,
        latitude: -33.8688,
        longitude: 151.2093,
        accuracyM: 4.5,
        altitudeM: 24,
        observedAt: '2026-01-01T00:00:10.000Z',
      },
      {
        locationSequence: 2,
        elapsedMs: 20_000,
        latitude: -33.869,
        longitude: 151.2098,
        accuracyM: null,
        altitudeM: 28,
        observedAt: '2026-01-01T00:00:20.000Z',
      },
      {
        locationSequence: 3,
        elapsedMs: 50_000,
        latitude: -33.87,
        longitude: 151.2105,
        accuracyM: 12,
        altitudeM: -3,
        observedAt: '2026-01-01T00:00:50.000Z',
      },
    ].filter(
      (point) => point.elapsedMs >= request.range.startElapsedMs && point.elapsedMs <= request.range.endElapsedMs
    );
    const gaps =
      request.range.startElapsedMs <= 20_000 && request.range.endElapsedMs >= 20_000
        ? [{ startElapsedMs: 20_001, endElapsedMs: 49_999, reason: 'noFix' as const }]
        : [];
    const cursor = request.cursor ? decodeCursor(request.cursor) : null;
    if (
      cursor &&
      (cursor.sessionId !== request.sessionId ||
        JSON.stringify(cursor.snapshot) !== JSON.stringify(request.snapshot) ||
        JSON.stringify(cursor.range) !== JSON.stringify(request.range))
    ) {
      throw new Error('Cursor does not match the requested snapshot');
    }
    const page = points.slice(cursor ? points.findIndex((point) => point.locationSequence > cursor.sequence) : 0);
    const rows = page.slice(0, request.limit);
    const last = rows.at(-1);
    return {
      kind: 'locations',
      sessionId: request.sessionId,
      snapshot: request.snapshot,
      range: request.range,
      points: rows,
      gaps,
      nextCursor:
        last && rows.length < page.length
          ? encodeCursor({
              sessionId: request.sessionId,
              snapshot: request.snapshot,
              range: request.range,
              elapsedMs: last.elapsedMs,
              sequence: last.locationSequence,
            })
          : null,
      locationBoundary: { lastSequence: 3, lastElapsedMs: 50_000 },
    };
  }
  const events: ReferenceEvent[] = [
    { sequence: 1, sourceSampleSequence: 0, elapsedMs: 0, kind: 'packageState', value: 'running' },
    { sequence: 2, sourceSampleSequence: 1, elapsedMs: 60_000, kind: 'packageState', value: 'stopped' },
  ].filter((event) => event.elapsedMs >= request.range.startElapsedMs && event.elapsedMs <= request.range.endElapsedMs);
  const cursor = request.cursor ? decodeCursor(request.cursor) : null;
  if (
    cursor &&
    (cursor.sessionId !== request.sessionId ||
      JSON.stringify(cursor.snapshot) !== JSON.stringify(request.snapshot) ||
      JSON.stringify(cursor.range) !== JSON.stringify(request.range))
  ) {
    throw new Error('Cursor does not match the requested snapshot');
  }
  const page = paginateEvents(events, request.limit, cursor);
  const last = page.rows.at(-1);
  return {
    kind: 'events',
    sessionId: request.sessionId,
    snapshot: request.snapshot,
    range: request.range,
    page: {
      elapsedMs: page.rows.map((event) => event.elapsedMs),
      sequence: page.rows.map((event) => event.sequence),
      sourceSampleSequence: page.rows.map((event) => event.sourceSampleSequence),
      faults: page.rows.map(() => null),
      kinds: page.rows.map((event) => event.kind),
      values: page.rows.map((event) => event.value),
    },
    nextCursor:
      last && page.rows.length < events.length
        ? encodeCursor({
            sessionId: request.sessionId,
            snapshot: request.snapshot,
            range: request.range,
            elapsedMs: last.elapsedMs,
            sequence: last.sequence,
          })
        : null,
  };
}

/** Native location stand-ins; unavailable to WebSocket clients. */
export function simulateMockCalibrationLocation(): void {
  if (!activeMockBackend) return;
  const response = activeMockBackend.handle({ id: 1, method: 'state.get', params: {} }) as {
    result: import('../src/lib/backend/contract.ts').AppState;
  };
  activeMockBackend.simulatePermissions(
    response.result.permissions.map((p) =>
      p.permission === 'location' ? { ...p, status: 'granted', accuracy: 'precise', scope: 'always', action: null } : p
    )
  );
}
export function simulateMockSpeedCalibrationProgress(
  status: import('../src/lib/backend/contract.ts').SpeedCalibrationMeasurementStatus,
  acceptedSamples: number,
  progressPercent: number
): void {
  activeMockBackend?.simulateSpeedCalibrationProgress(status, acceptedSamples, progressPercent);
}

export function simulateMockSpeedCalibrationResult(mm: number, supported = true): void {
  activeMockBackend?.simulateSpeedCalibrationResult(mm, supported);
}

/** Native lifecycle stand-in for deterministic integration tests, independent of sockets. */
export function simulateMockForeground(foreground: boolean): void {
  activeMockBackend?.simulateForeground(foreground);
}

/** Read-only protocol-fault stand-in for connection warning rendering tests. */
export function simulateMockCanReplyConflict(): void {
  activeMockBackend?.simulateCanReplyConflict();
}

export function getMockBootstrap(port: number) {
  return {
    webSocketUrl: `ws://127.0.0.1:${port}/api/ws?token=${encodeURIComponent(sessionToken)}`,
    sessionExportUrl: '/api/session-export',
    sessionImportUrl: '/api/session-import',
    origin: expectedOrigin,
    platform: 'web' as const,
  };
}

function storedZip(entries: { name: string; body: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(entry.body), 14);
    local.writeUInt32LE(entry.body.length, 18);
    local.writeUInt32LE(entry.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    local.copy(central, 16, 14, 26);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, entry.body);
    centrals.push(central, name);
    offset += local.length + name.length + entry.body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function createMockExport(
  sessionId: string,
  format: 'float-view-archive' | 'csv',
  identity: { deviceHistoryId: string; displayName: string } | null
): { fileName: string; contentType: string; body: Buffer } {
  const fileName = `float-view-${sessionId}.${format === 'csv' ? 'csv.zip' : 'floatview'}`;
  if (format === 'csv') {
    // Fixed DEFLATE payload; replace its entry name to match the download.
    const fixture = Buffer.from(
      'UEsDBBQAAAAIAAAAIVzeTEUlOgAAAEAAAAAIAAAAcmlkZS5jc3YrTi0sTc1LTtVJzUksKE5Nic8t1ikuSAUysgsydFIyi0sSgbLxuVwGOmDIZahjZgAEOkYGOsYGBlwAUEsBAhQDFAAAAAgAAAAhXN5MRSU6AAAAQAAAAAgAAAAAAAAAAAAAAIABAAAAAHJpZGUuY3N2UEsFBgAAAAABAAEANgAAAGAAAAAAAA==',
      'base64'
    );
    const name = Buffer.from(fileName.slice(0, -'.zip'.length), 'utf8');
    const local = Buffer.from(fixture.subarray(0, 30));
    const end = Buffer.from(fixture.subarray(-22));
    const centralOffset = end.readUInt32LE(16);
    const central = Buffer.from(fixture.subarray(centralOffset, centralOffset + 46));
    const compressed = fixture.subarray(30 + local.readUInt16LE(26), centralOffset);
    local.writeUInt16LE(name.length, 26);
    central.writeUInt16LE(name.length, 28);
    end.writeUInt32LE(central.length + name.length, 12);
    end.writeUInt32LE(local.length + name.length + compressed.length, 16);
    return {
      fileName,
      contentType: 'application/zip',
      body: Buffer.concat([local, name, compressed, central, name, end]),
    };
  }

  if (!identity) throw new Error('Session was not found');
  return {
    fileName,
    contentType: 'application/octet-stream',
    body: Buffer.from(JSON.stringify({ sessionId, ...identity }), 'utf8'),
  };
}

export function stopMockServer(): Promise<void> {
  for (const client of wss.clients) client.terminate();
  return new Promise((resolve, reject) => {
    wss.close((webSocketError) => {
      server.close((serverError) => {
        const error = webSocketError ?? serverError;
        if (error) reject(error);
        else {
          mockRunning = false;
          resolve();
        }
      });
    });
  });
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  startMockServer().then((port) => console.log(`Mock server started on ${port}`));
}

/** Canonical connection-recovery browser fixture; no HTTP test endpoint. */
export function simulateConnectionFailure(
  code: import('../src/lib/backend/contract.ts').ConnectionIssueCode,
  message: string,
  compatibility?: import('../src/lib/backend/contract.ts').RefloatCompatibility
) {
  activeMockBackend?.simulateConnectionFailure(code, message, compatibility);
}

// Mock archives use stored ZIP entries; production also supports DEFLATE.
function readStoredZip(bytes: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    if (entries.size > 10000 || bytes.readUInt16LE(offset + 8) !== 0) throw new Error('Unsupported ZIP');
    const size = bytes.readUInt32LE(offset + 18),
      nameLength = bytes.readUInt16LE(offset + 26),
      extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extra,
      end = start + size;
    if (end > bytes.length || entries.has(name)) throw new Error('Invalid ZIP entry');
    const body = bytes.subarray(start, end);
    if (crc32(body) !== bytes.readUInt32LE(offset + 14)) throw new Error('ZIP checksum mismatch');
    entries.set(name, body);
    offset = end;
  }
  if (!entries.size || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP directory');
  return entries;
}
