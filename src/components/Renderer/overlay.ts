import { RowKey, type RowWithIndex } from '../../lib/parse/types';

export type OverlayVertical = 'top' | 'center' | 'bottom';
export type OverlayHorizontal = 'left' | 'center' | 'right';

export interface OverlayPosition {
  vertical: OverlayVertical;
  horizontal: OverlayHorizontal;
}

export const DEFAULT_OVERLAY_POSITION: OverlayPosition = {
  vertical: 'bottom',
  horizontal: 'left',
};

export interface OverlayFieldDef {
  id: string;
  label: string;
  getValue: (row: RowWithIndex) => string;
}

export const OVERLAY_FIELD_DEFS: OverlayFieldDef[] = [
  { id: 'speed', label: 'Speed', getValue: (r) => `${r[RowKey.Speed].toFixed(1)} km/h` },
  { id: 'duty', label: 'Duty', getValue: (r) => `${Math.abs(r[RowKey.Duty]).toFixed(0)}%` },
  { id: 'elevation', label: 'Elevation', getValue: (r) => `${r[RowKey.Altitude].toFixed(0)} m` },
  { id: 'voltage', label: 'Voltage', getValue: (r) => `${r[RowKey.Voltage].toFixed(1)} V` },
  { id: 'currentMotor', label: 'Current Motor', getValue: (r) => `${r[RowKey.CurrentMotor].toFixed(1)} A` },
  { id: 'tempMotor', label: 'Temp Motor', getValue: (r) => `${r[RowKey.TempMotor].toFixed(0)} °C` },
  { id: 'tempMosfet', label: 'Temp Mosfet', getValue: (r) => `${r[RowKey.TempMosfet].toFixed(0)} °C` },
  { id: 'pitch', label: 'Pitch', getValue: (r) => `${r[RowKey.TruePitch].toFixed(1)}°` },
  { id: 'roll', label: 'Roll', getValue: (r) => `${r[RowKey.Roll].toFixed(1)}°` },
];

export const DEFAULT_OVERLAY_FIELDS: Record<string, boolean> = {
  speed: true,
  duty: true,
  elevation: true,
};

/** CSS classes for positioning the overlay container (Tailwind-style: insets + flex). */
export function getOverlayPositionClasses(pos: OverlayPosition): string {
  const v = pos.vertical === 'top' ? 'top-4' : pos.vertical === 'bottom' ? 'bottom-4' : 'top-1/2 -translate-y-1/2';
  const h =
    pos.horizontal === 'left'
      ? 'left-4'
      : pos.horizontal === 'right'
        ? 'right-4'
        : 'left-1/2 -translate-x-1/2';
  const flex =
    pos.vertical === 'top'
      ? 'flex-col'
      : pos.vertical === 'bottom'
        ? 'flex-col-reverse'
        : 'flex-col';
  return `${v} ${h} flex ${flex} gap-2`;
}

/** Pixel position for canvas drawing: returns { x, y, stackDown } where (x,y) is top-left of first box and stackDown means next box is at y + boxHeight + gap. */
export function getOverlayPositionPixels(
  pos: OverlayPosition,
  width: number,
  height: number,
  boxWidth: number,
  boxHeight: number,
  gap: number,
  itemCount: number,
): { x: number; y: number; stackDown: boolean } {
  const pad = Math.min(width, height) * 0.03;
  const totalHeight = itemCount * boxHeight + (itemCount - 1) * gap;

  let x: number;
  if (pos.horizontal === 'left') x = pad;
  else if (pos.horizontal === 'right') x = width - pad - boxWidth;
  else x = (width - boxWidth) / 2;

  let y: number;
  let stackDown: boolean;
  if (pos.vertical === 'top') {
    y = pad;
    stackDown = true;
  } else if (pos.vertical === 'bottom') {
    y = height - pad - totalHeight;
    stackDown = true; // next box below (higher y)
  } else {
    y = (height - totalHeight) / 2;
    stackDown = true;
  }
  return { x, y, stackDown };
}

const PAD_FRAC = 0.03;
const BOX_HEIGHT_FRAC = 0.06;
const GAP_FRAC = 0.02;
const BOX_WIDTH_FRAC = 0.28;

/** Default (x, y) in 0–1 for each item when stacked at the given position. Used when no custom position is set. */
export function getDefaultItemPositions(
  pos: OverlayPosition,
  itemCount: number,
): { x: number; y: number }[] {
  const result: { x: number; y: number }[] = [];
  let x: number;
  if (pos.horizontal === 'left') x = PAD_FRAC;
  else if (pos.horizontal === 'right') x = 1 - PAD_FRAC - BOX_WIDTH_FRAC;
  else x = 0.5 - BOX_WIDTH_FRAC / 2;

  for (let i = 0; i < itemCount; i++) {
    let y: number;
    if (pos.vertical === 'top') {
      y = PAD_FRAC + i * (BOX_HEIGHT_FRAC + GAP_FRAC);
    } else if (pos.vertical === 'bottom') {
      y = 1 - PAD_FRAC - (itemCount - i) * BOX_HEIGHT_FRAC - (itemCount - 1 - i) * GAP_FRAC;
    } else {
      const totalH = itemCount * BOX_HEIGHT_FRAC + (itemCount - 1) * GAP_FRAC;
      y = 0.5 - totalH / 2 + i * (BOX_HEIGHT_FRAC + GAP_FRAC);
    }
    result.push({ x, y });
  }
  return result;
}

export type FieldPositions = Record<string, { x: number; y: number }>;
