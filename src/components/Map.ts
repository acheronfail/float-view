import Leaflet, { LatLng, type LatLngExpression, type PolylineOptions } from 'leaflet';
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

const commonLineOptions: Partial<PolylineOptions> = { smoothFactor: 0, interactive: false };
export const MapLineOptions: Record<MapLine, (index: number) => PolylineOptions> = {
  [MapLine.Base]: () => ({ ...commonLineOptions, color: cyan[100], weight: 2, dashArray: '5 5', opacity: 0.5 }),
  [MapLine.Travelled]: (index) => ({
    ...commonLineOptions,
    color: travelledLineColours[index % travelledLineColours.length],
    weight: 4,
  }),
};

export class SegmentedPolyline {
  constructor(private readonly lines: Leaflet.Polyline[]) {}

  remove() {
    this.lines.forEach((line) => line.remove());
  }

  addTo(map: Leaflet.Map): SegmentedPolyline {
    this.lines.forEach((line) => line.addTo(map));
    return this;
  }

  getBounds() {
    return this.lines.reduce((result, line) => result.extend(line.getBounds()), this.lines[0]!.getBounds());
  }

  getLatLngs() {
    return this.lines.map((line) => line.getLatLngs() as LatLng[]);
  }
}

export function getPolyline(
  gpsPoints: LatLngExpression[],
  gpsGaps: GpsGap[],
  selectedRowIndex: number,
  line: MapLine,
): SegmentedPolyline {
  const limit = line === MapLine.Travelled ? selectedRowIndex : gpsPoints.length;

  const values: { points: LatLngExpression[]; needsColour: boolean }[] = [];
  for (let i = 0; i < gpsGaps.length; ++i) {
    const start = gpsGaps[i]!;
    const end = Math.min(limit, gpsGaps[i + 1]?.index ?? gpsPoints.length);
    values.push({
      points: gpsPoints.slice(start.index, end),
      needsColour: start.secondsElapsed > CHARGE_THRESHOLD_SECONDS,
    });

    if (limit === end) {
      break;
    }
  }

  let colourIdx = 0;
  return new SegmentedPolyline(
    values.map(({ points, needsColour }) => {
      if (needsColour) colourIdx++;
      return Leaflet.polyline(points, MapLineOptions[line](colourIdx));
    }),
  );
}
