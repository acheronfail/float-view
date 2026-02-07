<script lang="ts">
  import { onMount } from 'svelte';
  import { demoFile, demoRow } from '../lib/parse/float-control';
  import { RowKey } from '../lib/parse/types';
  import type { RowWithIndex } from '../lib/parse/types';
  import { parse, supportedMimeTypeString } from '../lib/parse';
  import Picker from './Picker.svelte';
  import Button from './Button.svelte';
  import Input from './Input.svelte';
  import VideoOverlay from './VideoOverlay.svelte';
  import { SvgImage } from './Renderer/svg';
  import rollSvg from '../assets/roll.svg?raw';
  import pitchSvg from '../assets/pitch.svg?raw';
  import riderIconSvg from '../assets/rider-icon.svg?raw';
  import {
    type WorkerCommand,
    type WorkerMessage,
    type TypedWorker,
    BoardPosition3d,
    type Renderer,
  } from './Renderer/types';
  import { createRenderer } from './Renderer/render';
  import { drawVideoOverlayHud } from './Renderer/2d';
  import WebMWriter from '../lib/webm-writer2.js';
  import Pill from './Pill.svelte';
  import {
    OVERLAY_FIELD_DEFS,
    DEFAULT_OVERLAY_FIELDS,
    DEFAULT_OVERLAY_POSITION,
    getDefaultItemPositions,
    type OverlayPosition,
    type FieldPositions,
  } from './Renderer/overlay';

  const defaultFps = 20;
  const defaultWidth = 1080;
  const defaultHeight = 1440;
  const defaultGapThresholdSecs = 60;

  class SavedState<T> {
    private readonly k: string;
    public v = $state<T>(undefined as unknown as T);
    public readonly default: T;

    constructor(key: string, defaultValue: T) {
      this.k = key;
      this.v = defaultValue;
      this.default = defaultValue;

      const saved = localStorage.getItem(this.k);
      if (saved !== null) {
        try {
          this.v = JSON.parse(saved);
        } catch (e) {
          console.warn(`Failed to parse saved state for ${this.k}:`, e);
          this.v = defaultValue;
        }
      }

      $effect(() => {
        localStorage.setItem(this.k, JSON.stringify(this.v));
      });
    }
  }

  // DOM elements
  let elDemoContainer = $state<HTMLDivElement | null>(null);
  let elProgressBar1 = $state<HTMLProgressElement | null>(null);
  let elProgressBar2 = $state<HTMLProgressElement | null>(null);
  let elProgressText1 = $state<HTMLPreElement | null>(null);
  let elProgressText2 = $state<HTMLPreElement | null>(null);
  let elLogOutput = $state<HTMLPreElement | null>(null);

  // state
  let isRendering = $state(false);

  // mode: render (board animation) vs overlay (stats on video)
  let renderMode = new SavedState<'render' | 'overlay'>('renderMode', 'render');

  // output folder (persisted to IndexedDB so it survives reload)
  const OUTPUT_HANDLE_DB = 'float-renderer-output';
  const OUTPUT_HANDLE_KEY = 'outputDirectory';

  let outputDirectoryHandle = $state<FileSystemDirectoryHandle | null>(null);
  let outputDirectoryName = $derived(outputDirectoryHandle?.name ?? null);

  function saveOutputHandle(handle: FileSystemDirectoryHandle): void {
    try {
      const req = indexedDB.open(OUTPUT_HANDLE_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => {
        req.result.transaction('handles', 'readwrite').objectStore('handles').put(handle, OUTPUT_HANDLE_KEY);
      };
    } catch (e) {
      console.warn('Could not save output folder:', e);
    }
  }

  function loadOutputHandle(): Promise<FileSystemDirectoryHandle | null> {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(OUTPUT_HANDLE_DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('handles');
        req.onsuccess = () => {
          const tx = req.result.transaction('handles', 'readonly');
          const get = tx.objectStore('handles').get(OUTPUT_HANDLE_KEY);
          get.onsuccess = () => resolve(get.result ?? null);
          get.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async function chooseOutputFolder(): Promise<FileSystemDirectoryHandle | null> {
    try {
      const dir = await window.showDirectoryPicker({
        id: 'output',
        mode: 'readwrite',
        startIn: 'videos',
      });
      outputDirectoryHandle = dir;
      saveOutputHandle(dir);
      return dir;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.error(e);
      return null;
    }
  }

  async function getOutputDirectory(): Promise<FileSystemDirectoryHandle | null> {
    if (outputDirectoryHandle) {
      try {
        if ('requestPermission' in outputDirectoryHandle && (outputDirectoryHandle as FileSystemDirectoryHandle).requestPermission) {
          const perm = await (outputDirectoryHandle as FileSystemDirectoryHandle).requestPermission({ mode: 'readwrite' });
          if (perm !== 'granted') {
            outputDirectoryHandle = null;
            return await chooseOutputFolder();
          }
        }
        return outputDirectoryHandle;
      } catch {
        outputDirectoryHandle = null;
        return await chooseOutputFolder();
      }
    }
    return await chooseOutputFolder();
  }

  // saved user input
  let interpolate = new SavedState('interpolate', false);
  let showRemoteTilt = new SavedState('showRemoteTilt', false);
  let use3dRenderer = new SavedState('use3dRenderer', false);
  let boardPosition3d = new SavedState('boardPosition3d', BoardPosition3d.BackRight);
  let boardPosition3dRaised = new SavedState('boardPosition3dRaised', false);
  let renderInUi = import.meta.env.DEV ? new SavedState('renderInUi', false) : { v: false };
  let fullscreenPreview = import.meta.env.DEV ? new SavedState('fullscreenPreview', false) : { v: false };
  let backgroundColor = new SavedState('backgroundColor', '#1e293b');
  let inputFps = new SavedState('inputFps', '');
  let inputWidth = new SavedState('inputWidth', '');
  let inputHeight = new SavedState('inputHeight', '');
  let inputGapThresholdSecs = new SavedState('inputGapThresholdSecs', '');

  // other user input
  let filename = $state('');
  let inputFile = $state<File | undefined>(import.meta.env.DEV ? demoFile : undefined);
  let inputStartingIndex = $state('');
  let inputEndingIndex = $state('');

  // Video overlay: overlay ride stats on an imported video (preview + export as new file)
  let overlayVideoFile = $state<File | undefined>(undefined);
  let overlayVideoUrl = $state<string | undefined>(undefined);
  let overlayTimeOffset = $state(0);
  let overlayRows = $state<RowWithIndex[]>([]);
  let overlaySelectedRowIndex = $state(0);
  let overlayFieldsEnabled = new SavedState<Record<string, boolean>>('overlayFields', DEFAULT_OVERLAY_FIELDS);
  let overlayPosition = new SavedState<OverlayPosition>('overlayPosition', DEFAULT_OVERLAY_POSITION);
  let overlayFieldPositions = new SavedState<FieldPositions>('overlayFieldPositions', {});

  const overlayItemsForPreview = $derived.by(() => {
    const row = overlayRows[overlaySelectedRowIndex] ?? overlayRows[0];
    if (!row) return [];
    const enabled = OVERLAY_FIELD_DEFS.filter((def) => overlayFieldsEnabled.v[def.id]);
    const defaultPositions = getDefaultItemPositions(overlayPosition.v, enabled.length);
    return enabled.map((def, i) => {
      const pos = overlayFieldPositions.v[def.id] ?? defaultPositions[i]!;
      return {
        id: def.id,
        label: def.label,
        value: def.getValue(row),
        x: pos.x,
        y: pos.y,
      };
    });
  });

  $effect(() => {
    const f = overlayVideoFile;
    const url = f ? URL.createObjectURL(f) : undefined;
    overlayVideoUrl = url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  });

  $effect(() => {
    const rideFile = inputFile;
    const videoFile = overlayVideoFile;
    if (!rideFile || !videoFile) {
      overlayRows = [];
      return;
    }
    parse(rideFile).then((result) => {
      overlayRows = result.data;
    }).catch(() => {
      overlayRows = [];
    });
  });

  function rowAtTime(rows: RowWithIndex[], rideTime: number): RowWithIndex {
    if (rows.length === 0) return null!;
    if (rideTime <= rows[0]![RowKey.Time]) return rows[0]!;
    if (rideTime >= rows[rows.length - 1]![RowKey.Time]) return rows[rows.length - 1]!;
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (rows[mid]![RowKey.Time] <= rideTime) lo = mid;
      else hi = mid;
    }
    const tLo = rows[lo]![RowKey.Time];
    const tHi = rows[hi]![RowKey.Time];
    return rideTime - tLo <= tHi - rideTime ? rows[lo]! : rows[hi]!;
  }

  async function renderVideoWithOverlay() {
    if (!overlayVideoUrl || !inputFile || overlayRows.length === 0) {
      alert('Please load both a ride file and a video first.');
      return;
    }
    const dir = await getOutputDirectory();
    if (!dir) return;
    Notification.requestPermission();
    const overlayFilename = filename ? `${filename} - overlay` : 'ride-overlay';

    const video = document.createElement('video');
    video.src = overlayVideoUrl;
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video'));
    });

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const duration = video.duration;
    const totalFrames = Math.ceil(duration * fps);
    const frameDurationMicros = (1_000_000 / fps) | 0;

    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d')!;

    const fileHandle = await dir!.getFileHandle(`${overlayFilename}.webm`, { create: true });
    const fileWritableStream = await fileHandle.createWritable();
    const webmWriter = new WebMWriter({
      fileWriter: fileWritableStream,
      codec: 'VP8',
      width: vw,
      height: vh,
      frameRate: fps,
    });

    const encoderConfig: VideoEncoderConfig = {
      codec: 'vp8',
      width: vw,
      height: vh,
      bitrate: 2_000_000,
      framerate: fps,
    };
    const { supported } = await VideoEncoder.isConfigSupported(encoderConfig);
    if (!supported) {
      await fileWritableStream.close();
      alert('VP8 encoding is not supported in this browser.');
      return;
    }

    const encoder = new VideoEncoder({
      output: (chunk) => webmWriter.addFrame(chunk),
      error: (e) => console.error('Video overlay encoder error:', e),
    });
    encoder.configure(encoderConfig);

    isRendering = true;
    if (elProgressBar1 && elProgressBar2 && elProgressText1 && elProgressText2) {
      elProgressBar1.max = 1;
      elProgressBar1.value = 0;
      elProgressBar2.max = totalFrames;
      elProgressBar2.value = 0;
      elProgressText1.textContent = 'Video overlay';
      elProgressText2.textContent = '0% (0 frames)';
    }

    function seekVideo(t: number): Promise<void> {
      return new Promise((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = t;
      });
    }

    try {
      for (let i = 0; i < totalFrames && isRendering; i++) {
        const T = i / fps;
        const rideTime = T - overlayTimeOffset;
        const row = rowAtTime(overlayRows, rideTime);
        await seekVideo(T);
        ctx.drawImage(video, 0, 0);
        const enabled = OVERLAY_FIELD_DEFS.filter((def) => overlayFieldsEnabled.v[def.id]);
        const defaultPositions = getDefaultItemPositions(overlayPosition.v, enabled.length);
        const hudItems = enabled.map((def, i) => {
          const pos = overlayFieldPositions.v[def.id] ?? defaultPositions[i]!;
          return { label: def.label, value: def.getValue(row), x: pos.x, y: pos.y };
        });
        drawVideoOverlayHud(ctx, vw, vh, { items: hudItems });
        const frame = new VideoFrame(canvas, { timestamp: i * frameDurationMicros });
        encoder.encode(frame, { keyFrame: i % 30 === 0 });
        frame.close();
        if (elProgressBar2 && elProgressText2) {
          elProgressBar2.value = i + 1;
          elProgressText2.textContent = `${(((i + 1) / totalFrames) * 100).toFixed(1)}% (${i + 1} frames)`;
        }
        if (i % 30 === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      await encoder.flush();
      encoder.close();
      await webmWriter.complete();
      await fileWritableStream.close();
      if (elProgressBar1 && elProgressBar2) {
        elProgressBar1.value = elProgressBar1.max;
        elProgressBar2.value = elProgressBar2.max;
      }
      if (elLogOutput) elLogOutput.textContent += 'Video overlay export finished.\n';
      if (Notification.permission === 'granted') {
        new Notification('Video overlay export finished');
      }
    } catch (err) {
      console.error('Video overlay export failed:', err);
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      isRendering = false;
    }
  }

  // derived values
  let startingIndex = $derived(inputStartingIndex ? parseInt(inputStartingIndex, 10) : 0);
  let endingIndex = $derived(inputEndingIndex ? parseInt(inputEndingIndex, 10) : 0);
  let fps = $derived(inputFps.v ? parseInt(inputFps.v, 10) : defaultFps);
  let width = $derived(inputWidth.v ? parseInt(inputWidth.v, 10) : defaultWidth);
  let height = $derived(inputHeight.v ? parseInt(inputHeight.v, 10) : defaultHeight);
  let gapThresholdSecs = $derived(
    inputGapThresholdSecs.v ? parseInt(inputGapThresholdSecs.v, 10) : defaultGapThresholdSecs,
  );

  // when relevant values change, update debug (only in render mode)
  $effect(() => {
    if (renderMode.v !== 'render') return;
    width;
    height;
    showRemoteTilt.v;
    use3dRenderer.v;
    renderInUi.v;
    boardPosition3d.v;
    boardPosition3dRaised.v;
    backgroundColor.v;
    drawDebug();
  });

  const createWorker = (): TypedWorker<WorkerCommand, WorkerMessage> =>
    new Worker(new URL('./Renderer/worker.ts', import.meta.url), { type: 'module' });

  let worker = createWorker();

  // when file changes, send it to the worker
  $effect(() => {
    if (inputFile) {
      if (elLogOutput) elLogOutput.textContent = '';
      filename = inputFile.name.replace(/(\.(zip|csv|json))+$/, '');
      worker.postMessage({ type: 'file', inputFile, startingIndex, endingIndex, fps, gapThresholdSecs });
    }
  });

  let lastProgressFrameCount = 0;
  let lastProgressUpdate = 0;
  let pendingUpdate = false;
  worker.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'complete':
        elProgressBar1!.value = elProgressBar1!.max;
        elProgressBar2!.value = elProgressBar2!.max;
        elLogOutput!.textContent += `Finished rendering!\n`;

        isRendering = false;

        if (Notification.permission === 'granted') {
          const humanTime = new Date(msg.totalMilliseconds).toISOString().substr(11, 8);
          new Notification('Rendering complete!', { body: `Rendered in ${humanTime} (hh:mm:ss)` });
        }
        return;
      case 'progress': {
        elProgressBar1!.value = msg.currentVideoIndex + msg.currentVideoProgress;
        elProgressBar1!.max = msg.videosTotal;

        elProgressBar2!.value = msg.currentVideoProgress;
        elProgressBar2!.max = 1;

        const durationSinceLastUpdate = performance.now() - lastProgressUpdate;
        const framesSinceLastUpdate = msg.framesGenerated - lastProgressFrameCount;
        const fps = Math.round(framesSinceLastUpdate / (durationSinceLastUpdate / 1000));
        const pct = Math.min(100, msg.currentVideoProgress * 100).toFixed(1);

        elProgressText1!.textContent = `Segment ${msg.currentVideoIndex + 1} of ${msg.videosTotal}`;
        elProgressText2!.textContent = `${pct}% (${msg.framesGenerated} frames) (${fps} fps)`;

        lastProgressFrameCount = msg.framesGenerated;
        lastProgressUpdate = performance.now();
        pendingUpdate = false;
        return;
      }
      case 'log':
        if (elLogOutput) {
          elLogOutput.textContent += msg.message + '\n';
          elLogOutput.scrollTop = elLogOutput.scrollHeight;
        } else {
          console.debug(msg.message);
        }
        return;
      case 'fatal':
        alert(`Error: ${msg.message}`);
        isRendering = false;
        return;
      default:
        console.warn('Unknown message from worker', msg);
        return;
    }
  });

  async function chooseOutputAndRender() {
    if (!filename) {
      alert('Please enter a filename!');
      return;
    }
    const directoryHandle = await getOutputDirectory();
    if (!directoryHandle) return;
    Notification.requestPermission();

    const canvas = document.createElement('canvas').transferControlToOffscreen();
    isRendering = true;
    worker.postMessage(
      {
        type: 'start',
        directoryHandle: directoryHandle,
        fps,
        width,
        height,
        canvas,
        backgroundColor: backgroundColor.v,
        boardPosition3d: boardPosition3d.v,
        boardPosition3dRaised: boardPosition3dRaised.v,
        interpolate: interpolate.v,
        drawRemoteTilt: showRemoteTilt.v,
        use3dRenderer: use3dRenderer.v,
        filename,
      },
      [canvas],
    );

    lastProgressUpdate = performance.now();

    while (isRendering) {
      if (!pendingUpdate) {
        worker.postMessage({ type: 'update' });
        pendingUpdate = true;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  function stop() {
    worker.postMessage({ type: 'stop' });
    elLogOutput!.textContent += `Cancelled!\n`;
    isRendering = false;
  }

  function clear() {
    stop();
    elLogOutput!.textContent = '';
    inputFile = undefined;
  }

  let ready = false;
  let renderer: Renderer | null = null;
  async function drawDebug() {
    if (elDemoContainer && ready) {
      elDemoContainer.innerHTML = '';
      const canvas = elDemoContainer.appendChild(document.createElement('canvas'));
      canvas.classList.add('h-full');
      canvas.width = width;
      canvas.height = height;

      if (renderer) {
        renderer.close();
        renderer = null;
      }

      if (renderInUi.v) {
        renderer = await createRenderer(
          canvas,
          {
            backgroundColor: backgroundColor.v,
            boardPosition3d: boardPosition3d.v,
            boardPosition3dRaised: boardPosition3dRaised.v,
            drawRemoteTilt: showRemoteTilt.v,
            images,
          },
          use3dRenderer.v,
        );
        await renderer.draw(demoRow);

        if (use3dRenderer.v) {
          requestAnimationFrame(function loop() {
            if (!renderInUi.v || !renderer) return;
            renderer.draw(demoRow).then(() => requestAnimationFrame(loop));
          });
        }
      } else {
        const offscreen = canvas.transferControlToOffscreen();
        worker.postMessage(
          {
            type: 'draw',
            canvas: offscreen,
            data: demoRow,
            backgroundColor: backgroundColor.v,
            boardPosition3d: boardPosition3d.v,
            boardPosition3dRaised: boardPosition3dRaised.v,
            drawRemoteTilt: showRemoteTilt.v,
            use3dRenderer: use3dRenderer.v,
          },
          [offscreen],
        );
      }
    }
  }

  const images: Record<string, ImageBitmap> = {};
  onMount(async () => {
    const savedHandle = await loadOutputHandle();
    if (savedHandle) outputDirectoryHandle = savedHandle;

    // NOTE: web workers can't render SVGs, even though the spec says they should
    // so we render them in the UI thread here to a bitmap, and pass that to the worker
    // See: https://stackoverflow.com/a/79196371/5552584
    const generateBitmap = async (name: string, svgXml: string, width: number, height: number) => {
      const svgImg = await SvgImage.create(svgXml);
      images[name] = await svgImg.bitmap(width, height);

      const image = await svgImg.bitmap(width, height);
      worker.postMessage({ type: 'image', name, image }, [image]);
    };

    await Promise.all([generateBitmap('roll', rollSvg, 200, 180), generateBitmap('pitch', pitchSvg, 500, 500)]);

    ready = true;
    drawDebug();
  });
</script>

<Picker bind:file={inputFile} />

{#snippet outputSettings()}
  <h2 class="text-lg font-semibold text-slate-100 mb-4">🎬 Output Settings</h2>
  <div class="space-y-1">
    <Input id="filename" label="Filename (without extension)" type="text" placeholder="myRide" bind:value={filename} />
    <Input
      id="fps"
      label="FPS"
      type="number"
      defaultValue={inputFps.v}
      placeholder={`${defaultFps}`}
      onblur={(e) => (inputFps.v = e.currentTarget.value)}
    />
    <Input
      id="gapThresholdSecs"
      label="Gap threshold (seconds)"
      type="number"
      defaultValue={inputGapThresholdSecs.v}
      placeholder={`${defaultGapThresholdSecs}`}
      onblur={(e) => (inputGapThresholdSecs.v = e.currentTarget.value)}
    />
    <Input
      id="width"
      label="Width (px)"
      type="number"
      defaultValue={inputWidth.v}
      placeholder={`${defaultWidth}`}
      onblur={(e) => (inputWidth.v = e.currentTarget.value)}
    />
    <Input
      id="height"
      label="Height (px)"
      type="number"
      defaultValue={inputHeight.v}
      placeholder={`${defaultHeight}`}
      onblur={(e) => (inputHeight.v = e.currentTarget.value)}
    />
    <Input
      id="backgroundColor"
      label="Background Color"
      type="text"
      placeholder={backgroundColor.default}
      defaultValue={backgroundColor.v}
      onblur={(e) => {
        backgroundColor.v = e.currentTarget.value;
        if (!backgroundColor.v.trim()) {
          backgroundColor.v = backgroundColor.default;
          e.currentTarget.value = backgroundColor.v;
        }
      }}
    />
    <Input
      id="startingIndex"
      label="Starting index"
      type="number"
      placeholder="0"
      onblur={(e) => (inputStartingIndex = e.currentTarget.value)}
    />
    <Input
      id="endingIndex"
      label="Ending index (0 = end of file)"
      type="number"
      placeholder="0"
      onblur={(e) => (inputEndingIndex = e.currentTarget.value)}
    />
    <Input
      id="interpolate"
      type="checkbox"
      bind:checked={interpolate.v}
      label="Interpolate data points (smooth transitions)"
    />
    <Input id="showRemoteTilt" type="checkbox" bind:checked={showRemoteTilt.v} label="Show Remote Tilt" />
    <div class="flex flex-row justify-between gap-2">
      <Pill text="beta" appearance="lime" />
      <Input class="grow" id="use3dRenderer" type="checkbox" bind:checked={use3dRenderer.v} label="3D Renderer" />
    </div>
    {#if use3dRenderer.v}
      <div class="flex items-center justify-between space-x-2">
        <label for="boardPosition3d"><Pill text="beta" appearance="lime" /> View board from:</label>
        <select bind:value={boardPosition3d.v} id="boardPosition3d" class="bg-slate-950/50 border rounded-lg px-2">
          {#each Object.values(BoardPosition3d) as position}
            <option value={position}>{position.charAt(0).toUpperCase() + position.slice(1)}</option>
          {/each}
        </select>
      </div>
      <div class="flex flex-row justify-between gap-2">
        <Pill text="beta" appearance="lime" />
        <Input
          class="grow"
          id="boardPosition3dRaised"
          type="checkbox"
          bind:checked={boardPosition3dRaised.v}
          label="Lift Camera Up"
        />
      </div>
    {/if}
    {#if import.meta.env.DEV}
      <div class="flex items-center justify-center space-x-2">
        <Pill text="dev" appearance="amber" />
        <Input
          class="grow"
          id="renderInWorker"
          type="checkbox"
          bind:checked={renderInUi.v}
          label="Render in UI thread"
        />
      </div>
    {/if}
  </div>
{/snippet}

<div class="bg-slate-900 min-h-screen">
  {#if fullscreenPreview.v}
    <div class="flex flex-row items-center h-screen w-screen">
      <div
        class="bg-slate-800/50 border space-y-5 min-h-[400px] m-4 w-full border-slate-700/50 rounded-lg p-6 shadow-lg backdrop-blur-sm"
      >
        <div class="flex flex-row justify-between">
          <div>
            {#if renderInUi.v}
              <Pill text="live" appearance="rose" class="animate-pulse" />
            {/if}
          </div>
          <Button onclick={() => (fullscreenPreview.v = false)}>Exit fullscreen</Button>
        </div>
        {@render outputSettings()}
      </div>
      <div class="h-screen" bind:this={elDemoContainer}></div>
    </div>
  {:else}
    <div class="max-w-7xl p-6 m-auto bg-slate-900">
      <!-- Hero Section with Styled Title -->
      <div class="text-center space-y-4 pb-2">
        <div class="flex justify-center items-center space-x-4">
          <div class="self-end">{@html riderIconSvg}</div>
          <div class="relative">
            <h1
              class="text-6xl md:text-7xl font-black text-transparent bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 bg-clip-text tracking-tight leading-none"
            >
              Float Renderer
            </h1>
            <div
              class="absolute -inset-1 bg-gradient-to-r from-blue-600/20 via-purple-600/20 to-pink-600/20 blur-2xl -z-10 rounded-full"
            ></div>
          </div>
          <div class="scale-x-[-1] self-end">{@html riderIconSvg}</div>
        </div>
        <div class="relative max-w-2xl mx-auto">
          <p class="text-xl md:text-2xl text-slate-300 font-light tracking-wide">
            {renderMode.v === 'overlay' ? 'Overlay' : 'Convert'} your
            <span class="text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text font-semibold"
              >recorded ride</span
            >
            into a
            <span class="text-transparent bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text font-semibold"
              >realtime video</span
            >
          </p>
          <div class="flex justify-center mt-4">
            <div class="flex space-x-1"></div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <!-- Left Column: Configuration -->
        <div class="space-y-3">
          <!-- Header Section -->
          <div class="bg-amber-900/20 border border-amber-700/30 rounded-lg p-4 backdrop-blur-sm">
            <div class="flex items-start space-x-3">
              <div class="flex-shrink-0">
                <svg class="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fill-rule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clip-rule="evenodd"
                  />
                </svg>
              </div>
              <div>
                <h3 class="text-sm font-medium text-amber-200">Please Note!</h3>
                <div class="mt-1 text-sm text-amber-300/80">
                  <p>
                    This feature is currently experimental and may have bugs. Only works in Chromium-based browsers
                    (Chrome, Edge, etc.) due to File System Access API requirements.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <!-- Mode: Render vs Overlay -->
          <div class="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 shadow-lg backdrop-blur-sm">
            <h2 class="text-sm font-semibold text-slate-300 mb-2">Mode</h2>
            <div class="flex rounded-lg overflow-hidden border border-slate-600 bg-slate-900/50 p-0.5">
              <button
                type="button"
                class="flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors {renderMode.v === 'render'
                  ? 'bg-slate-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'}"
                onclick={() => (renderMode.v = 'render')}
              >
                Render
              </button>
              <button
                type="button"
                class="flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors {renderMode.v === 'overlay'
                  ? 'bg-slate-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'}"
                onclick={() => (renderMode.v = 'overlay')}
              >
                Overlay
              </button>
            </div>
          </div>

          <!-- Output folder (shared) -->
          <div class="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 shadow-lg backdrop-blur-sm">
            <h2 class="text-sm font-semibold text-slate-300 mb-2">Output folder</h2>
            <div class="flex flex-wrap items-center gap-2">
              <Button onclick={() => chooseOutputFolder()} class="bg-slate-600 hover:bg-slate-500 text-white text-sm">
                {outputDirectoryName ? 'Change folder' : 'Choose folder'}
              </Button>
              <span class="text-sm font-mono text-slate-400 truncate max-w-[200px]" title={outputDirectoryName ?? ''}>
                {outputDirectoryName ?? 'No folder selected'}
              </span>
            </div>
          </div>

          <!-- Ride file (overlay mode only) -->
          {#if renderMode.v === 'overlay'}
            <div class="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 shadow-lg backdrop-blur-sm">
              <h2 class="text-sm font-semibold text-slate-300 mb-2">Ride file</h2>
              <div class="flex flex-wrap items-center gap-2">
                <label
                  class="cursor-pointer inline-flex items-center gap-2 rounded bg-slate-600 hover:bg-slate-500 px-3 py-2 text-sm font-medium text-white w-fit"
                >
                  {inputFile ? 'Change ride file' : 'Choose ride file'}
                  <input
                    type="file"
                    accept={supportedMimeTypeString}
                    class="hidden"
                    onchange={(e) => {
                      const f = e.currentTarget.files?.[0];
                      if (f) inputFile = f;
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
                <Button
                  onclick={() => clear()}
                  class="disabled:opacity-50 disabled:cursor-not-allowed bg-slate-600/80 hover:bg-slate-600 text-white text-sm"
                  disabled={!inputFile}
                >
                  📁 Clear file
                </Button>
                <span
                  class="text-sm font-mono text-slate-400 truncate max-w-[200px]"
                  title={inputFile?.name ?? ''}
                >
                  {inputFile?.name ?? 'No ride file selected'}
                </span>
              </div>
            </div>
          {/if}

          <!-- Actions (content by mode) -->
          <div class="bg-slate-800/50 border border-slate-700/50 rounded-lg p-6 shadow-lg backdrop-blur-sm">
            <h2 class="text-lg font-semibold text-slate-100 mb-4">🎯 Actions</h2>
            {#if renderMode.v === 'render'}
              <div class="space-y-3">
                <Button
                  onclick={() => chooseOutputAndRender()}
                  class="w-full bg-blue-600/80 hover:bg-blue-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-blue-500/25 {isRendering
                    ? 'opacity-50 cursor-not-allowed'
                    : ''}"
                  disabled={isRendering}
                >
                  {isRendering ? '🎬 Rendering...' : '🎬 Render'}
                </Button>
                <div class="grid grid-cols-2 gap-3">
                  <Button
                    onclick={() => stop()}
                    class="disabled:opacity-50 disabled:cursor-not-allowed w-full bg-red-600/80 hover:bg-red-600 text-white font-medium py-2 px-4 rounded-lg"
                    disabled={!isRendering}
                  >
                    ❌ Cancel
                  </Button>
                  <Button
                    onclick={() => clear()}
                    class="disabled:opacity-50 disabled:cursor-not-allowed w-full bg-slate-600/80 hover:bg-slate-600 text-white font-medium py-2 px-4 rounded-lg"
                    disabled={!inputFile}
                  >
                    📁 Clear file
                  </Button>
                </div>
              </div>
            {:else}
              <div class="space-y-3">
                {#if overlayVideoUrl && overlayRows.length > 0}
                  <Button
                    onclick={() => renderVideoWithOverlay()}
                    class="w-full bg-blue-600/80 hover:bg-blue-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-blue-500/25 {isRendering
                      ? 'opacity-50 cursor-not-allowed'
                      : ''}"
                    disabled={isRendering}
                  >
                    {isRendering ? '🎬 Exporting…' : '🎬 Export video with overlay'}
                  </Button>
                  <div class="grid grid-cols-2 gap-3">
                    <Button
                      onclick={() => (isRendering = false)}
                      class="disabled:opacity-50 disabled:cursor-not-allowed w-full bg-red-600/80 hover:bg-red-600 text-white font-medium py-2 px-4 rounded-lg"
                      disabled={!isRendering}
                    >
                      ❌ Cancel
                    </Button>
                    <Button
                      onclick={() => (overlayVideoFile = undefined)}
                      class="disabled:opacity-50 disabled:cursor-not-allowed w-full bg-slate-600/80 hover:bg-slate-600 text-white font-medium py-2 px-4 rounded-lg"
                      disabled={!overlayVideoFile}
                    >
                      📁 Clear video
                    </Button>
                  </div>
                {:else}
                  {#if !inputFile}
                    <p class="text-sm text-slate-500">Load a ride file above first.</p>
                  {:else}
                    <label class="cursor-pointer inline-flex items-center gap-2 rounded bg-cyan-600 hover:bg-cyan-500 px-3 py-2 text-sm font-medium text-white w-fit">
                      Load video
                      <input
                        type="file"
                        accept="video/*"
                        class="hidden"
                        onchange={(e) => {
                          const f = e.currentTarget.files?.[0];
                          if (f) overlayVideoFile = f;
                          e.currentTarget.value = '';
                        }}
                      />
                    </label>
                  {/if}
                {/if}
              </div>
            {/if}
          </div>

          <!-- Progress Section -->
          <div class="bg-slate-800/50 border border-slate-700/50 rounded-lg p-6 shadow-lg backdrop-blur-sm">
            <h2 class="text-lg font-semibold text-slate-100 mb-4">📈 Progress</h2>
            <div class="space-y-4">
              <div class="space-y-2">
                <div class="flex justify-between items-center text-sm">
                  <span class="text-slate-300">Segments</span>
                  <pre
                    bind:this={elProgressText1}
                    class="text-xs font-mono text-slate-300 bg-slate-700/50 px-2 py-1 rounded">...</pre>
                </div>
                <progress
                  bind:this={elProgressBar1}
                  class="w-full h-3 rounded-lg overflow-hidden bg-slate-700/50 [&::-webkit-progress-bar]:bg-slate-700/50 [&::-webkit-progress-value]:bg-blue-500 [&::-moz-progress-bar]:bg-blue-500"
                ></progress>
                <div class="flex justify-between items-center text-sm">
                  <span class="text-slate-300">Progress</span>
                  <pre
                    bind:this={elProgressText2}
                    class="text-xs font-mono text-slate-300 bg-slate-700/50 px-2 py-1 rounded">...</pre>
                </div>
                <progress
                  bind:this={elProgressBar2}
                  class="w-full h-3 rounded-lg overflow-hidden bg-slate-700/50 [&::-webkit-progress-bar]:bg-slate-700/50 [&::-webkit-progress-value]:bg-blue-500 [&::-moz-progress-bar]:bg-blue-500"
                ></progress>
              </div>
            </div>
          </div>

          <!-- Settings (content by mode) -->
          <div class="bg-slate-800/50 border border-slate-700/50 rounded-lg p-6 shadow-lg backdrop-blur-sm">
            {#if renderMode.v === 'render'}
              {@render outputSettings()}
            {:else}
              <h2 class="text-lg font-semibold text-slate-100 mb-4">🎬 Overlay settings</h2>
              <div class="space-y-4">
                <div>
                  <p class="text-sm text-slate-400 mb-2">Fields to show</p>
                  <div class="flex flex-wrap gap-x-4 gap-y-1">
                    {#each OVERLAY_FIELD_DEFS as def}
                      <label class="inline-flex items-center gap-1.5 text-sm text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={overlayFieldsEnabled.v[def.id] ?? false}
                          onchange={() => {
                            overlayFieldsEnabled.v = { ...overlayFieldsEnabled.v, [def.id]: !overlayFieldsEnabled.v[def.id] };
                          }}
                        />
                        {def.label}
                      </label>
                    {/each}
                  </div>
                </div>
                <p class="text-sm text-slate-500">Drag fields on the preview to move them. Position is used when exporting.</p>
                <div>
                  <p class="text-sm text-slate-400 mb-2">Default position (for new fields)</p>
                  <div class="flex flex-wrap gap-3">
                    <label class="text-sm text-slate-300">
                      Vertical
                      <select
                        class="ml-2 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200 text-sm"
                        value={overlayPosition.v.vertical}
                        onchange={(e) => {
                          const vertical = (e.currentTarget.value || 'bottom') as OverlayPosition['vertical'];
                          overlayPosition.v = { ...overlayPosition.v, vertical };
                        }}
                      >
                        <option value="top">Top</option>
                        <option value="center">Center</option>
                        <option value="bottom">Bottom</option>
                      </select>
                    </label>
                    <label class="text-sm text-slate-300">
                      Horizontal
                      <select
                        class="ml-2 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200 text-sm"
                        value={overlayPosition.v.horizontal}
                        onchange={(e) => {
                          const horizontal = (e.currentTarget.value || 'left') as OverlayPosition['horizontal'];
                          overlayPosition.v = { ...overlayPosition.v, horizontal };
                        }}
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                    <Button
                      onclick={() => (overlayFieldPositions.v = {})}
                      class="bg-slate-600 hover:bg-slate-500 text-white text-sm"
                    >
                      Reset custom positions
                    </Button>
                  </div>
                </div>
                <Input
                  id="overlay-fps"
                  label="FPS"
                  type="number"
                  defaultValue={inputFps.v}
                  placeholder={`${defaultFps}`}
                  onblur={(e) => (inputFps.v = e.currentTarget.value)}
                />
                <div class="flex flex-wrap items-center gap-2">
                  <label for="overlay-time-offset" class="text-sm text-slate-300">Time offset (s):</label>
                  <input
                    id="overlay-time-offset"
                    type="number"
                    step="0.5"
                    class="w-20 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200 font-mono text-sm"
                    bind:value={overlayTimeOffset}
                  />
                  <span class="text-xs text-slate-500">Ride start = video time − offset</span>
                </div>
              </div>
            {/if}
          </div>
        </div>

        <!-- Right Column (Preview first, then Log) -->
        <div class="space-y-3">
          <!-- Preview (content by mode) -->
          <div class="bg-slate-800/50 border border-slate-700/50 rounded-lg p-6 shadow-lg backdrop-blur-sm">
            <h2 class="text-lg font-semibold text-slate-100 mb-4">
              {#if renderMode.v === 'render'}
                🎨 Render Preview
                {#if renderInUi.v}
                  <Pill text="live" appearance="rose" class="animate-pulse" />
                {/if}
              {:else}
                🎨 Overlay preview
              {/if}
            </h2>
            {#if renderMode.v === 'render'}
              {#if import.meta.env.DEV}
                <div class="flex items-center justify-between mb-2">
                  <Button onclick={() => (fullscreenPreview.v = true)} class="bg-blue-600/80 hover:bg-blue-600">
                    Fullscreen Preview
                  </Button>
                </div>
              {/if}
              <div
                bind:this={elDemoContainer}
                class="relative flex justify-center items-center h-[400px] bg-slate-900/50 border border-slate-600/50 rounded-lg overflow-hidden"
              >
                <!-- Preview canvas will be inserted here -->
              </div>
            {:else}
              <div
                class="relative flex justify-center items-center min-h-[280px] bg-slate-900/50 border border-slate-600/50 rounded-lg overflow-hidden"
              >
                {#if overlayVideoUrl && overlayRows.length > 0}
                  <VideoOverlay
                    videoUrl={overlayVideoUrl}
                    rows={overlayRows}
                    selectedRowIndex={overlaySelectedRowIndex}
                    setSelectedRowIndex={(i) => (overlaySelectedRowIndex = i)}
                    timeOffset={overlayTimeOffset}
                    overlayItems={overlayItemsForPreview}
                    onPositionChange={(id, x, y) => {
                      overlayFieldPositions.v = { ...overlayFieldPositions.v, [id]: { x, y } };
                    }}
                  />
                {:else}
                  <p class="text-slate-500 text-sm p-4 text-center">
                    {#if !inputFile}
                      Load a ride file, then load a video to preview.
                    {:else}
                      Load a video to preview overlay.
                    {/if}
                  </p>
                {/if}
              </div>
            {/if}
          </div>

          <!-- Log Output -->
          <div class="bg-slate-800/50 border border-slate-700/50 rounded-lg p-6 shadow-lg backdrop-blur-sm">
            <h2 class="text-lg font-semibold text-slate-100 mb-4">📝 Log Output</h2>
            <pre
              bind:this={elLogOutput}
              class="h-[300px] w-full p-4 text-xs font-mono bg-slate-950/80 text-green-400 rounded-lg overflow-y-auto border border-slate-700/50 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800"></pre>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <div class="flex flex-row justify-center align-center">
    <a href="/float-view/?app=view">
      <Button>Looking for Float View? Click here!</Button>
    </a>
  </div>
</div>
