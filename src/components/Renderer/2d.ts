import { RowKey, State, type RowWithIndex } from '../../lib/parse/types';
import type { CreateRenderer } from './types';
import type { Canvas, Ctx } from './svg';
import { FONT_FAMILY } from './render';

const colors = {
  fg: '#ffffff',
  fgSubtle: '#cccccc',
  fgAlternate: '#ffcc00',
  primary: '#66ff66',
  secondary: '#ff88aa',
  error: '#ff6666',
  inactive: '#cccccc',
};

function getStateColor(state: string) {
  switch (state as State) {
    case State.Startup:
      return colors.fgSubtle;
    case State.Quickstop:
      return colors.primary;
    case State.StopHalf:
      return colors.fgAlternate;
    case State.StopFull:
      return colors.error;
    case State.StopAngle:
      return colors.error;
    case State.Wheelslip:
      return colors.fgAlternate;
    case State.Riding:
    default:
      return colors.fg;
  }
}

interface ValueBoxConfig {
  label: string;
  dataKey: RowKey;
  unit: string;
}

const VALUE_BOX_CONFIGS: ValueBoxConfig[] = [
  { label: 'Bat V', dataKey: RowKey.Voltage, unit: 'V' },
  { label: 'Current Bat', dataKey: RowKey.CurrentBattery, unit: 'A' },
  { label: 'Current Motor', dataKey: RowKey.CurrentMotor, unit: 'A' },
  { label: 'Elevation', dataKey: RowKey.Altitude, unit: 'm' },
  { label: 'Temp Motor', dataKey: RowKey.TempMotor, unit: '°C' },
  { label: 'Temp Mosfet', dataKey: RowKey.TempMosfet, unit: '°C' },
];

export function getCtxFont(size: number, weight: 'normal' | 'bold' = 'normal'): string {
  return `${weight === 'bold' ? 'bold ' : ''}${size}px ${FONT_FAMILY}`;
}

export interface DrawParams {
  canvas: Canvas;
  ctx: Ctx;
  data: RowWithIndex;
  backgroundColor: string;
  images: Record<string, ImageBitmap>;

  drawBackground?: boolean;
  drawBoard?: boolean;
  drawRemoteTilt?: boolean;
}

export const create2dRenderer: CreateRenderer = async (canvas, { backgroundColor, drawRemoteTilt, images }) => {
  const ctx = canvas.getContext('2d')! as Ctx;
  return {
    close: () => {},
    draw: (data: RowWithIndex) =>
      Promise.resolve(draw2d({ canvas, ctx, data, backgroundColor, drawRemoteTilt, images })),
  };
};

// TODO: show battery cell percentage
export function draw2d({
  canvas,
  ctx,
  data,
  images,
  backgroundColor,
  drawBoard = true,
  drawBackground = true,
  drawRemoteTilt = false,
}: DrawParams) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (drawBackground) {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const width = canvas.width;
  const height = canvas.height;
  const padding = width * 0.025;

  // draw version in top left
  ctx.fillStyle = colors.fgSubtle;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = getCtxFont(Math.max(12, height * 0.025));
  ctx.fillText(import.meta.env.VITE_BUILD_VERSION, width * 0.5, height * (1 - 0.025));

  const gaugeWidth = width * 0.5 - 2 * padding;
  const gaugeHeight = height * 0.3;
  const valueBoxHeight = height * 0.1;

  // Draw speed gauge
  drawGauge({
    label: 'Speed',
    ctx,
    x: padding,
    y: padding,
    w: gaugeWidth,
    h: gaugeHeight,
    value: data[RowKey.Speed],
    valueStr: data[RowKey.Speed].toFixed(1),
    unit: 'km/h',
    minValue: 0,
    maxValue: 50,
  });

  // Draw duty cycle gauge
  drawGauge({
    label: 'Duty Cycle',
    ctx,
    x: padding + width * 0.5,
    y: padding,
    w: gaugeWidth,
    h: gaugeHeight,
    value: Math.abs(data[RowKey.Duty]),
    valueStr: Math.abs(data[RowKey.Duty]).toFixed(0),
    unit: '%',
    minValue: 0,
    maxValue: 100,
  });

  // Pitch
  drawPitchAndRoll({
    ctx,
    x: padding,
    y: padding * 4 + gaugeHeight,
    w: gaugeWidth,
    h: gaugeHeight,
    drawBoard,
    roll: data[RowKey.Roll],
    pitch: data[RowKey.TruePitch],
    setpoint: data[RowKey.Setpoint],
    setpointRemote: drawRemoteTilt ? (data[RowKey.SetpointRemote] ?? 0) : undefined,
    rollImage: images['roll']!,
    pitchImage: images['pitch']!,
  });

  // Footpad
  drawFootpad({
    ctx,
    x: padding + width * 0.5,
    y: padding * 4 + gaugeHeight,
    w: gaugeWidth,
    h: gaugeHeight,
    adc1: data[RowKey.Adc1],
    adc2: data[RowKey.Adc2],
    speed: data[RowKey.Speed],
    state: data[RowKey.State],
  });

  // Grid layout for value boxes: 3 columns, 2 rows
  const columns = 3;
  const rows = Math.ceil(VALUE_BOX_CONFIGS.length / columns);
  const valueBoxWidth = (width - (columns + 1) * padding) / columns;
  const totalValueBoxesHeight = rows * valueBoxHeight + (rows - 1) * padding;

  // Calculate y position for value boxes grid
  const valueBoxGridY = height - totalValueBoxesHeight - padding * 2;

  // Draw value boxes in a grid
  ctx.textBaseline = 'middle';
  VALUE_BOX_CONFIGS.forEach((config, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;

    const x = padding + col * (valueBoxWidth + padding);
    const y = valueBoxGridY + row * (valueBoxHeight + padding);

    const value = data[config.dataKey];
    const numericValue = typeof value === 'number' ? value : 0;

    drawValueBox({
      label: config.label,
      ctx,
      x,
      y,
      w: valueBoxWidth,
      h: valueBoxHeight,
      value: numericValue,
      unit: config.unit,
    });
  });
}

interface BaseParams {
  ctx: Ctx;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BoardParams extends BaseParams {
  drawBoard: boolean;
  roll: number;
  pitch: number;
  setpoint?: number;
  setpointRemote?: number;
  rollImage: ImageBitmap;
  pitchImage: ImageBitmap;
}

function getImageDimensions(image: ImageBitmap, maxSpaceLength: number): [number, number] {
  const maxImgLength = Math.max(image.width, image.height);
  const scale = maxSpaceLength / maxImgLength;
  return [image.width * scale, image.height * scale];
}

function drawPitchAndRoll(params: BoardParams) {
  const { ctx, drawBoard, roll, pitch, setpoint, setpointRemote, rollImage, pitchImage } = params;

  // pitch
  if (drawBoard) {
    const { x, y, w, h } = params;
    const centerX = x + w * 0.5;
    const centerY = y + h * 0.1;
    const [imgW, imgH] = getImageDimensions(pitchImage, Math.max(w, h));

    ctx.save();
    ctx.translate(centerX, centerY);

    const drawSetpoint = setpoint !== undefined;
    const drawSetpointRemote = setpointRemote !== undefined && setpointRemote !== 0;

    // setpoint indicators
    if (drawSetpoint) {
      const width = drawSetpointRemote ? 0.1 : 0.2;
      ctx.save();
      ctx.rotate((-setpoint * Math.PI) / 180);

      ctx.strokeStyle = colors.primary;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.1 - centerX, 0);
      ctx.lineTo(x + w * (0.1 + width) - centerX, 0);
      ctx.moveTo(x + w * (0.9 - width) - centerX, 0);
      ctx.lineTo(x + w * 0.9 - centerX, 0);
      ctx.stroke();
      ctx.restore();
    }

    if (drawSetpointRemote) {
      const width = drawSetpoint ? 0.1 : 0.2;
      ctx.save();
      ctx.rotate((-setpointRemote * Math.PI) / 180);

      ctx.strokeStyle = colors.secondary;
      ctx.beginPath();
      ctx.moveTo(x + w * (0.3 - width) - centerX, 0);
      ctx.lineTo(x + w * 0.3 - centerX, 0);
      ctx.moveTo(x + w * 0.7 - centerX, 0);
      ctx.lineTo(x + w * (0.7 + width) - centerX, 0);
      ctx.stroke();
      ctx.restore();
    }

    // pitch visualisation
    ctx.rotate((-pitch * Math.PI) / 180);
    ctx.drawImage(pitchImage, -imgW * 0.5, -imgH * 0.5, imgW, imgH);

    // draw arrow indicating front
    ctx.fillStyle = 'white';
    ctx.font = getCtxFont(w * 0.15);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('➡', 0, 3);

    ctx.restore();
  }

  // roll
  if (drawBoard) {
    const { x, y, w, h } = params;
    const centerX = x + w * 0.5;
    const centerY = y + h * 0.55;
    const [imgW, imgH] = getImageDimensions(rollImage, Math.max(w, h) * 0.4);

    ctx.save();
    ctx.translate(centerX, centerY);

    ctx.rotate((roll * Math.PI) / 180);
    ctx.drawImage(rollImage, -imgW * 0.5, -imgH * 0.5, imgW, imgH);

    ctx.restore();
  }

  // data labels
  {
    const x = params.x;
    const y = params.y + params.h * 0.8;
    const w = params.w;

    ctx.save();
    ctx.translate(x, y);

    const labelX = w * 0.15;
    const valueX = w - labelX;

    const f = 0.07;
    ctx.font = getCtxFont(w * f, 'bold');
    ctx.textAlign = 'left';
    ctx.fillStyle = colors.fgSubtle;
    ctx.fillText('Roll:', labelX, w * f);
    ctx.fillText('Pitch:', labelX, w * f * 2);
    ctx.fillText('Setpoint:', labelX, w * f * 3);
    if (setpointRemote !== undefined) {
      ctx.fillText('Remote:', labelX, w * f * 4);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = colors.fg;
    ctx.fillText(`${roll.toFixed(2)}°`, valueX, w * f);
    ctx.fillText(`${pitch.toFixed(2)}°`, valueX, w * f * 2);
    ctx.fillStyle = colors.primary;
    ctx.fillText(setpoint !== undefined ? `${setpoint.toFixed(2)}°` : '-', valueX, w * f * 3);
    if (setpointRemote !== undefined) {
      ctx.fillStyle = colors.secondary;
      ctx.fillText(`${setpointRemote.toFixed(2)}°`, valueX, w * f * 4);
    }

    ctx.restore();
  }
}

export interface GaugeParams extends BaseParams {
  label: string;
  value: number;
  valueStr: string;
  unit: string;
  minValue: number;
  maxValue: number;
}

export function drawGauge({ label, ctx, x, y, w, h, value, valueStr, unit, minValue, maxValue }: GaugeParams) {
  const centerX = x + w / 2;
  const centerY = y + h * 0.6; // Position gauge arc in lower part of area
  const radius = Math.min(w, h) * 0.4;
  const startAngle = Math.PI * 0.75; // Start at 135 degrees
  const endAngle = Math.PI * 0.25; // End at 45 degrees
  const angleRange = endAngle - startAngle + 2 * Math.PI;

  // Draw gauge background arc
  ctx.strokeStyle = '#404040';
  ctx.lineWidth = radius * 0.15;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, startAngle, endAngle);
  ctx.stroke();

  // Calculate value position
  const normalizedValue = Math.max(0, Math.min(1, (Math.abs(value) - minValue) / (maxValue - minValue)));
  const valueAngle = startAngle + normalizedValue * angleRange;

  // Draw gauge value arc
  ctx.strokeStyle = normalizedValue > 0.8 ? '#ff6666' : normalizedValue > 0.6 ? '#ffcc66' : '#66ff66';
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, startAngle, valueAngle);
  ctx.stroke();

  // Draw gauge needle
  const needleLength = radius * 0.9;
  const needleX = centerX + Math.cos(valueAngle) * needleLength;
  const needleY = centerY + Math.sin(valueAngle) * needleLength;

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(needleX, needleY);
  ctx.stroke();

  // Draw center dot
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.05, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();

  // Draw labels
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'center';
  ctx.font = getCtxFont(Math.max(12, w * 0.08));
  ctx.fillText(label, centerX, y + h * 0.08);

  ctx.fillStyle = value < 0 ? colors.fgAlternate : colors.fg;
  ctx.font = getCtxFont(Math.max(16, w * 0.06), 'bold');
  ctx.fillText(`${valueStr} ${unit}`, centerX, centerY + radius * -0.2);

  // Draw min/max labels
  ctx.font = getCtxFont(Math.max(10, w * 0.075));
  ctx.fillStyle = colors.fgSubtle;
  ctx.textAlign = 'left';
  ctx.fillText(minValue.toString(), centerX - radius * 0.5, centerY + radius * 0.7);
  ctx.textAlign = 'right';
  ctx.fillText(maxValue.toString(), centerX + radius * 0.5, centerY + radius * 0.7);
}

interface ValueBoxParams extends BaseParams {
  label: string;
  value: number;
  unit: string;
}

function drawValueBox({ label, ctx, x, y, w, h, value, unit }: ValueBoxParams) {
  // Draw box border
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  // Draw box background
  ctx.fillStyle = '#2d3748';
  ctx.fillRect(x, y, w, h);

  // Draw label
  ctx.fillStyle = colors.fgSubtle;
  ctx.textAlign = 'center';
  ctx.font = getCtxFont(Math.max(10, w * 0.08));
  ctx.fillText(label, x + w / 2, y + h * 0.35);

  // Draw value
  ctx.fillStyle = value < 0 ? colors.fgAlternate : colors.fg;
  ctx.font = getCtxFont(Math.max(14, w * 0.12), 'bold');
  const displayValue = Math.abs(value) < 0.1 ? value.toFixed(2) : value.toFixed(1);
  ctx.fillText(`${displayValue} ${unit}`, x + w / 2, y + h * 0.75);
}

interface FootpadParams extends BaseParams {
  adc1: number;
  adc2: number;
  speed: number;
  state: string;
}

function drawFootpad(params: FootpadParams) {
  const { ctx, adc1, adc2, speed, state } = params;

  const isSlow = Math.abs(speed) < 2;
  const adc1Color = adc1 < 2 ? (isSlow ? colors.inactive : colors.error) : colors.primary;
  const adc2Color = adc2 < 2 ? (isSlow ? colors.inactive : colors.error) : colors.primary;

  {
    const x = params.x;
    const y = params.y + params.h * 0.8;
    const w = params.w;

    ctx.save();
    ctx.translate(x, y);

    const labelX = w * 0.15;
    const valueX = w - labelX;

    const f = 0.07;
    ctx.font = getCtxFont(w * f, 'bold');
    ctx.textAlign = 'left';
    ctx.fillStyle = colors.fgSubtle;
    ctx.fillText('ADC1:', labelX, w * f);
    ctx.fillText('ADC2:', labelX, w * f * 2);
    ctx.fillText('State:', labelX, w * f * 3);

    ctx.textAlign = 'right';
    ctx.fillStyle = adc1Color;
    ctx.fillText(`${adc1.toFixed(2)} V`, valueX, w * f);
    ctx.fillStyle = adc2Color;
    ctx.fillText(`${adc2.toFixed(2)} V`, valueX, w * f * 2);
    ctx.fillStyle = getStateColor(state);
    ctx.fillText(state, valueX, w * f * 3);

    ctx.restore();
  }

  {
    const x = params.x + params.w * 0.1;
    const y = params.y;
    const w = params.w * 0.8;
    const h = params.h * 0.8;

    const padding = w * 0.1;

    ctx.save();
    ctx.translate(x, y);

    // footpad outline
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, h - padding);
    ctx.lineTo(padding, padding + h * 0.2); // Stop before the curve
    ctx.quadraticCurveTo(padding, padding, w * 0.45, padding);
    ctx.lineTo(w * 0.55, padding);
    ctx.quadraticCurveTo(w - padding, padding, w - padding, padding + h * 0.2);
    ctx.lineTo(w - padding, h - padding);
    ctx.lineTo(padding, h - padding);
    ctx.stroke();

    // divider line
    ctx.beginPath();
    ctx.moveTo(w * 0.5, padding + h * 0.1);
    ctx.lineTo(w * 0.5, h - padding - h * 0.1);
    ctx.stroke();

    // sensors
    const sensorPad = w * 0.15;
    const sensorOuterY = h * 0.3;
    const sensorInnerY = h * 0.175;

    ctx.fillStyle = adc1Color;
    ctx.beginPath();
    ctx.moveTo(sensorPad, sensorOuterY);
    ctx.lineTo(sensorPad, h - sensorPad);
    ctx.lineTo(w * 0.45, h - sensorPad);
    ctx.lineTo(w * 0.45, sensorInnerY);
    ctx.quadraticCurveTo(sensorPad, sensorInnerY, sensorPad, sensorOuterY);
    ctx.fill();

    ctx.fillStyle = adc2Color;
    ctx.beginPath();
    ctx.moveTo(w - sensorPad, sensorOuterY);
    ctx.lineTo(w - sensorPad, h - sensorPad);
    ctx.lineTo(w * 0.55, h - sensorPad);
    ctx.lineTo(w * 0.55, sensorInnerY);
    ctx.quadraticCurveTo(w - sensorPad, sensorInnerY, w - sensorPad, sensorOuterY);
    ctx.fill();

    ctx.restore();
  }
}

export interface VideoOverlayHudOptions {
  /** Each item has label, value, and position in 0–1 (relative to canvas size) */
  items: { label: string; value: string; x: number; y: number }[];
  /** Background color for each field box (CSS color, e.g. rgba(15,23,42,0.85)) */
  backgroundColor?: string;
  /** Text color for label and value (CSS color) */
  textColor?: string;
}

/** Draw overlay HUD on a canvas (e.g. over a video frame). Used when exporting video with burned-in stats. */
export function drawVideoOverlayHud(ctx: Ctx, width: number, height: number, options: VideoOverlayHudOptions): void {
  const { items, backgroundColor = 'rgba(15, 23, 42, 0.85)', textColor = colors.fg } = options;
  if (items.length === 0) return;

  // Use smaller padding so export box size matches preview (preview uses ~16px / tailwind px-4)
  const pad = Math.min(width, height) * 0.015;
  const fontSize = Math.max(14, Math.min(width, height) * 0.04);
  const boxHeight = fontSize * 2.2;

  ctx.font = getCtxFont(fontSize);
  ctx.textBaseline = 'middle';

  for (const { label, value, x, y } of items) {
    const boxWidth = ctx.measureText(label + ' ').width + ctx.measureText(value).width + pad * 2;
    // Position in pixels; clamp so box stays fully inside frame (avoids "a few px too far right")
    let px = x * width;
    let py = y * height;
    if (px + boxWidth > width) px = width - boxWidth;
    if (px < 0) px = 0;
    if (py + boxHeight > height) py = height - boxHeight;
    if (py < 0) py = 0;

    ctx.fillStyle = backgroundColor;
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(px, py, boxWidth, boxHeight, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    ctx.fillText(label, px + pad * 0.5, py + boxHeight / 2);

    ctx.textAlign = 'right';
    ctx.fillText(value, px + boxWidth - pad * 0.5, py + boxHeight / 2);
  }
}
