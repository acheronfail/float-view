import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { RefloatVersion } from '../fixture/refloat.ts';
import type { TelemetrySource } from '../fixture/telemetry.ts';
import { FixtureRun, type FixtureCommand } from '../fixture/session.ts';
import type { Target } from '../src/suite.ts';

type Effect = {
  effect: string;
  capture_id?: number;
  high_accuracy?: boolean;
  speech?: SpeechEffect;
  id?: number;
  delay_ms?: number;
  connection?: boolean;
  generation?: number;
  operation?: number;
  mode?: string;
  scan_id?: number;
  device_id?: string;
  bytes?: number[];
};
export type SpeechEffect = {
  id: number;
  battery: 'low' | 'overVoltage' | null;
  footpad: 'left' | 'right' | 'both' | null;
  load: { source: 'duty' | 'motor' | 'battery'; percent: number } | null;
  speed: number | null;
};
export function makeDirectTarget(options?: {
  telemetry: TelemetrySource;
  calibrationSpeedMps?: number;
  calibrationAccuracyMps?: number | ((observation: number) => number);
  calibrationAgeMs?: number;
  refloatVersion?: RefloatVersion;
  storageRoot?: string;
  onSpeech(speech: SpeechEffect): void;
}): Target {
  let child: ChildProcessWithoutNullStreams | undefined;
  let root: string | undefined;
  let endpoint: { url: string; origin: string } | undefined;
  let lifetime = 0,
    sequence = 0,
    request = 0;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  const timers = new Map<number, { timer: NodeJS.Timeout; connection: boolean }>();
  let polling: NodeJS.Timeout | undefined;
  let locationTimer: NodeJS.Timeout | undefined;
  let locationObservations = 0;
  let busy = false;
  let fixture = new FixtureRun();
  let session = fixture.create(options?.telemetry, options?.refloatVersion);
  let fixtureDevice: string | undefined;
  let operation = 0,
    generation = 0;
  async function simulate(command: FixtureCommand['command'], e: Effect) {
    if (command === 'connect') {
      generation++;
      fixtureDevice = e.device_id;
    }
    const reply = fixture.execute({
      run: fixture.id,
      session: session.id,
      operation: ++operation,
      generation,
      command,
      transport_operation: e.operation,
      response: e.mode === 'with_response',
      ...(fixtureDevice ? { device: fixtureDevice } : {}),
      ...(e.bytes ? { bytes: Buffer.from(e.bytes).toString('base64') } : {}),
    });
    for (const event of reply.events) {
      if (event.event === 'discovered')
        await fact({
          fact: 'discovered',
          scan_id: e.scan_id,
          device_id: event.device,
          name: event.name,
          rssi: event.rssi,
          advertises_uart: event.uart,
        });
      if (event.event === 'profile')
        await fact({ fact: 'profile', generation: e.generation, operation: e.generation, profile: event.profile });
      if (event.event === 'notifications')
        await fact({
          fact: 'notifications',
          generation: e.generation,
          operation: event.transport_operation,
          success: event.success,
        });
      if (event.event === 'writeProgress')
        await fact({
          fact: 'write_progress',
          generation: e.generation,
          operation: event.transport_operation,
          progress: event.progress,
        });
      if (event.event === 'link') await fact({ fact: 'link', generation: e.generation, state: event.state });
      if (event.event === 'bytes')
        await fact({ fact: 'bytes', generation: e.generation, bytes: Array.from(Buffer.from(event.bytes!, 'base64')) });
    }
  }
  function command(command: string, extra: object = {}): Promise<unknown> {
    if (pending.size >= 64) return Promise.reject(new Error('OS relay capacity'));
    const id = ++request;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Direct OS command deadline'));
      }, 4_500);
      pending.set(id, { resolve, reject, timer });
      child!.stdin.write(JSON.stringify({ id, command, ...extra }) + '\n');
    });
  }
  function fact(fact: object) {
    return command('fact', {
      envelope: {
        lifetime,
        sequence: ++sequence,
        monotonic_ms: Math.floor(performance.now()),
        epoch_ms: Date.now(),
        fact,
      },
    });
  }
  async function effect(e: Effect) {
    switch (e.effect) {
      case 'speak':
        if (options && e.speech) {
          options.onSpeech(e.speech);
          await fact({ fact: 'speech_finished', id: e.speech.id, outcome: 'finished' });
        }
        break;
      case 'scan':
        await simulate('scan', e);
        break;
      case 'stop_scan':
        await simulate('stopScan', e);
        break;
      case 'connect':
        await simulate('connect', e);
        break;
      case 'disconnect':
        await simulate('disconnect', e);
        break;
      case 'enable_notifications':
        await simulate('enableNotifications', e);
        break;
      case 'write':
        await simulate('write', e);
        break;
      case 'arm_timer': {
        const id = e.id!;
        timers.set(id, {
          connection: e.connection!,
          timer: setTimeout(() => {
            timers.delete(id);
            void fact({ fact: 'timer', id }).catch(fail);
          }, e.delay_ms),
        });
        break;
      }
      case 'cancel_timer':
        clearTimeout(timers.get(e.id!)?.timer);
        timers.delete(e.id!);
        break;
      case 'cancel_connection_timers':
        for (const [id, t] of timers)
          if (t.connection) {
            clearTimeout(t.timer);
            timers.delete(id);
          }
        break;
      case 'start_location':
        clearInterval(locationTimer);
        locationObservations = 0;
        if (!e.high_accuracy) {
          await fact({
            fact: 'location',
            capture_id: e.capture_id,
            latitude: -33.87,
            longitude: 151.21,
            accuracy_m: 5,
            altitude_m: -12,
            observed_at_ms: Date.now(),
          });
        }
        if (options?.calibrationSpeedMps !== undefined)
          locationTimer = setInterval(() => {
            void fact({
              fact: 'location_speed',
              capture_id: e.capture_id,
              speed_mps: options.calibrationSpeedMps,
              accuracy_mps:
                typeof options.calibrationAccuracyMps === 'function'
                  ? options.calibrationAccuracyMps(++locationObservations)
                  : (options.calibrationAccuracyMps ?? 0.1),
              age_ms: options.calibrationAgeMs ?? 0,
            }).catch(fail);
          }, 1_000);
        break;
      case 'stop_location':
        clearInterval(locationTimer);
        break;
      case 'recover_permission':
        await fact({ fact: 'ui_completed', id: e.id, success: false });
        break;
      case 'present_file':
        await fact({ fact: 'presentation_started', id: e.id, accepted: false });
        await fact({ fact: 'presentation_finished', id: e.id });
        break;
    }
  }
  function fail(error: unknown) {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error instanceof Error ? error : new Error(String(error)));
    }
    pending.clear();
  }
  return {
    name: 'direct',
    async start() {
      const repo = fileURLToPath(new URL('../../', import.meta.url));
      execFileSync(
        'cargo',
        [
          'build',
          '--locked',
          '--offline',
          '--manifest-path',
          join(repo, 'backends/core/Cargo.toml'),
          '-p',
          'float-view-loopback-server',
          '--example',
          'shared-service',
        ],
        { stdio: 'inherit' }
      );
      root = options?.storageRoot ?? mkdtempSync(join(tmpdir(), 'float-view-direct-'));
      sequence = 0;
      request = 0;
      fixture.close();
      fixture = new FixtureRun();
      session = fixture.create(options?.telemetry, options?.refloatVersion);
      operation = 0;
      generation = 0;
      fixtureDevice = undefined;
      child = spawn(join(repo, 'backends/core/target/debug/examples/shared-service'), [root], { stdio: 'pipe' });
      child.stderr.pipe(process.stderr);
      const ready = new Promise<void>((resolve, reject) => {
        // Bound cold native-process startup independently of measurement timing.
        const timeout = setTimeout(() => reject(new Error('Direct service readiness timeout')), 30_000);
        createInterface({ input: child!.stdout }).on('line', (line) => {
          const value = JSON.parse(line) as {
            event?: string;
            lifetime: number;
            url: string;
            origin: string;
            id: number;
            result: { Ok?: unknown; Err?: string };
          };
          if (value.event === 'ready') {
            lifetime = value.lifetime;
            endpoint = { url: value.url, origin: value.origin };
            clearTimeout(timeout);
            resolve();
            return;
          }
          const waiter = pending.get(value.id);
          clearTimeout(waiter?.timer);
          pending.delete(value.id);
          if (value.result.Err) waiter?.reject(new Error(value.result.Err));
          else waiter?.resolve(value.result.Ok);
        });
        child!.on('exit', (code) => {
          if (code) reject(new Error(`Direct service exited ${code}`));
        });
      });
      await ready;
      await fact({ fact: 'bluetooth', radio: 'poweredOn', scan: 'granted', connect: 'granted' });
      const granted = { access: 'granted', requestable: false, rationale: false };
      const unknown = { access: 'unknown', requestable: false, rationale: false };
      await fact({
        fact: 'permissions',
        observation: {
          platform: 'macos',
          bluetooth_scan: granted,
          bluetooth_connect: granted,
          location: granted,
          background_location: unknown,
          notifications: null,
          live_updates: null,
          accuracy: 'precise',
          scope: 'always',
          location_services: true,
          bluetooth_service: true,
          bluetooth_supported: true,
          background_option_label: null,
        },
      });
      await fact({ fact: 'storage', available_bytes: 1_000_000_000 });
      await fact({ fact: 'foreground', foreground: true });
      if (options)
        await fact({
          fact: 'speech_ready',
          state: {
            status: 'ready',
            reason: null,
            loweringControl: 'adjustable',
            voiceSettingsAvailable: false,
          },
        });
      polling = setInterval(() => {
        if (busy) return;
        busy = true;
        void command('drain', {
          envelope: {
            lifetime,
            sequence: ++sequence,
            monotonic_ms: Math.floor(performance.now()),
            epoch_ms: Date.now(),
            fact: { fact: 'clock' },
          },
        })
          .then(async (result) => {
            for (const e of (result as { effects: Effect[] }).effects) await effect(e);
          })
          .catch(fail)
          .finally(() => {
            busy = false;
          });
      }, 5);
      return endpoint!;
    },
    async background() {
      await fact({ fact: 'foreground', foreground: false });
    },
    async foreground() {
      await fact({ fact: 'foreground', foreground: true });
    },
    async endpoint() {
      if (!endpoint) throw new Error('Direct service not running');
      return endpoint;
    },
    async stop() {
      clearInterval(polling);
      clearInterval(locationTimer);
      fixture.close();
      for (const t of timers.values()) clearTimeout(t.timer);
      timers.clear();
      child?.stdin.end();
      if (child)
        await new Promise<void>((resolve) => {
          child!.once('exit', () => resolve());
          setTimeout(() => {
            child?.kill();
            resolve();
          }, 5_000).unref();
        });
      child = undefined;
      endpoint = undefined;
      if (root && !options?.storageRoot) rmSync(root, { recursive: true, force: true });
      root = undefined;
    },
  };
}
export const directTarget = makeDirectTarget();
