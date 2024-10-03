import Leaflet, { LatLng, type ControlPosition, type LatLngExpression, type PolylineOptions } from 'leaflet';
import { teal, sky, cyan, orange, lime, yellow, green, indigo, purple, fuchsia, pink, rose } from 'tailwindcss/colors';
import riderSvg from '../assets/rider-icon.svg?raw';
import chargeSvg from '../assets/charge-icon.svg?raw';
import footpadSvg from '../assets/footpad.svg?raw';
import warningSvg from '../assets/warning.svg?raw';
import { CHARGE_THRESHOLD_SECONDS, type GpsGap } from '../components/App';
import { type RowWithIndex, State } from '../lib/parse/types';

export interface PointOfInterest {
  index: number;
  state: string;
}

export interface Props {
  visibleRows: RowWithIndex[];
  visible: boolean[];
  setVisible: (visible: boolean[]) => void;
  setSelectedIdx: (index: number) => void;
  selectedRowIndex: number;
  gpsPoints: LatLngExpression[];
  gpsGaps: GpsGap[];
  pointsOfInterest: PointOfInterest[];
}

export { riderSvg };
export const riderIcon = Leaflet.divIcon({ className: 'rider-icon', html: riderSvg });
export const chargeIcon = Leaflet.divIcon({ className: 'state-icon svg', html: chargeSvg });
export const footpadIcon = Leaflet.divIcon({ className: 'state-icon svg', html: footpadSvg, iconSize: [20, 20] });
export const genericIcon = Leaflet.divIcon({ className: 'state-icon' });
export const warningIcon = Leaflet.divIcon({
  className: 'state-icon warning svg',
  html: warningSvg,
  iconSize: [15, 15],
});
export const stateIcons: Record<string, Leaflet.DivIcon | undefined> = {
  [State.Wheelslip]: warningIcon,
  [State.StopAngle]: warningIcon,
  [State.StopFull]: warningIcon,
  [State.Custom_OneFootpadAtSpeed]: footpadIcon,
  [State.Custom_NoFootpadsAtSpeed]: footpadIcon,
  [State.Custom_ChargePoint]: chargeIcon,
};

const stateToClassName = (state: string) => state.replace(/\W/g, '_');
export const getIcon = (state: string): { icon: Leaflet.DivIcon; className: string } => ({
  icon: stateIcons[state] ?? genericIcon,
  className: stateToClassName(state),
});

export enum MapLine {
  Base,
  Travelled,
}

const travelledLineColours = [
  teal[500],
  sky[500],
  indigo[500],
  purple[500],
  fuchsia[500],
  pink[500],
  rose[500],
  orange[500],
  yellow[500],
  lime[500],
  green[500],
];

export const getTravelledLineColor = (i: number) => travelledLineColours[i % travelledLineColours.length]!;

const commonLineOptions: Partial<PolylineOptions> = { smoothFactor: 0, interactive: false };
export const MapLineOptions: Record<MapLine, (index: number) => PolylineOptions & { color: string }> = {
  [MapLine.Base]: () => ({ ...commonLineOptions, color: cyan[100], weight: 2, dashArray: '5 5', opacity: 0.5 }),
  [MapLine.Travelled]: (index) => ({
    ...commonLineOptions,
    color: getTravelledLineColor(index),
    weight: 4,
  }),
};

export function createMapButton(label: string, position: ControlPosition, onclick: () => void): typeof Leaflet.Control {
  return Leaflet.Control.extend({
    options: { position },
    onAdd: () => {
      const el = Leaflet.DomUtil.create('div');
      el.style.backgroundColor = 'black';
      el.style.border = '1px solid #333';
      el.style.borderRadius = '3px';
      el.style.padding = '2px 4px';
      el.style.cursor = 'pointer';
      el.textContent = label;
      el.onclick = onclick;
      return el;
    },
  });
}

export class SegmentedPolyline {
  private readonly hidden: Set<number> = new Set();
  constructor(private readonly lines: Leaflet.Polyline[]) {}

  remove() {
    this.lines.forEach((line) => line.remove());
  }

  addTo(map: Leaflet.Map): SegmentedPolyline {
    this.lines.forEach((line, index) => {
      if (!this.hidden.has(index)) {
        line.addTo(map);
      }
    });

    return this;
  }

  getBounds(): Leaflet.LatLngBounds | null {
    if (!this.lines.length) {
      return null;
    }

    return this.lines.reduce((result, line) => result.extend(line.getBounds()), this.lines[0]!.getBounds());
  }

  getLatLngs(): LatLng[][] {
    return this.lines.map((line) => line.getLatLngs() as LatLng[]);
  }

  hide(index: number) {
    if (this.hidden.has(index)) {
      this.hidden.delete(index);
    } else {
      this.hidden.add(index);
    }
  }
}

export interface PolylineSegment {
  start: number;
  end: number;
  segmentIdx: number;
}

export function computeSegmentedLines(gpsGaps: GpsGap[], maxLength: number, hiddenSegmentIndices: Set<number>) {
  const result: PolylineSegment[] = [];
  for (let segmentIdx = 0, i = 0; i < gpsGaps.length; ++i) {
    const { secondsElapsed, index: start } = gpsGaps[i]!;
    if (secondsElapsed > CHARGE_THRESHOLD_SECONDS) segmentIdx++;

    if (!hiddenSegmentIndices.has(segmentIdx)) {
      result.push({
        start,
        end: gpsGaps[i + 1]?.index ?? maxLength,
        segmentIdx,
      });
    }
  }

  return result;
}

export function getBaseLine(
  gpsPoints: LatLngExpression[],
  gpsGaps: GpsGap[],
  hiddenSegmentIndices: Set<number>,
): SegmentedPolyline {
  const values: { points: LatLngExpression[]; options: PolylineOptions }[] = [];
  for (const { start, end, segmentIdx } of computeSegmentedLines(gpsGaps, gpsPoints.length, hiddenSegmentIndices)) {
    values.push({
      points: gpsPoints.slice(start, end),
      options: MapLineOptions[MapLine.Base](segmentIdx),
    });
  }

  return new SegmentedPolyline(values.map(({ points, options }) => Leaflet.polyline(points, options)));
}

export function getTravelledLine(
  gpsPoints: LatLngExpression[],
  gpsGaps: GpsGap[],
  limit: number,
  hiddenSegmentIndices: Set<number>,
): SegmentedPolyline {
  const values: { points: LatLngExpression[]; options: PolylineOptions }[] = [];
  for (const { start, end, segmentIdx } of computeSegmentedLines(gpsGaps, gpsPoints.length, hiddenSegmentIndices)) {
    values.push({
      points: gpsPoints.slice(start, Math.min(limit, end)),
      options: MapLineOptions[MapLine.Travelled](segmentIdx),
    });

    if (limit === end) {
      break;
    }
  }

  return new SegmentedPolyline(values.map(({ points, options }) => Leaflet.polyline(points, options)));
}
