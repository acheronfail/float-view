import Leaflet, { LatLng, type LatLngExpression, type PolylineOptions } from 'leaflet';
import { teal, sky, cyan, orange, lime, yellow, green, indigo, purple, fuchsia, pink, rose } from 'tailwindcss/colors';
import riderSvg from '../assets/rider-icon.svg?raw';
import chargeSvg from '../assets/charge-icon.svg?raw';
import footpadSvg from '../assets/footpad.svg?raw';
import warningSvg from '../assets/warning.svg?raw';
import { State } from './parse/types';

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
export const faultIcons: Record<string, Leaflet.DivIcon | undefined> = {
  [State.Wheelslip]: warningIcon,
  [State.StopAngle]: warningIcon,
  [State.StopFull]: warningIcon,
  [State.Custom_OneFootpadAtSpeed]: footpadIcon,
  [State.Custom_NoFootpadsAtSpeed]: footpadIcon,
  [State.Custom_ChargePoint]: chargeIcon,
};

const stateToClassName = (state: string) => state.replace(/\W/g, '_');
export const getIcon = (state: string): { icon: Leaflet.DivIcon; className: string } => ({
  icon: faultIcons[state] ?? genericIcon,
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

export const MapLineOptions: Record<MapLine, (index: number) => PolylineOptions> = {
  [MapLine.Base]: () => ({ color: cyan[100], weight: 2, dashArray: '5 5', opacity: 0.5 }),
  [MapLine.Travelled]: (index) => ({
    color: travelledLineColours[index % travelledLineColours.length],
    weight: 4,
  }),
};

export class SegmentedPolyline {
  constructor(private readonly polylines: Leaflet.Polyline[]) {}
  remove() {
    this.polylines.forEach((line) => line.remove());
  }

  addTo(map: Leaflet.Map): SegmentedPolyline {
    this.polylines.forEach((line) => line.addTo(map));
    return this;
  }

  getBounds() {
    return this.polylines.reduce((result, line) => result.extend(line.getBounds()), this.polylines[0]!.getBounds());
  }

  getLatLngs() {
    return this.polylines.map((line) => line.getLatLngs() as LatLng[]);
  }
}

export function getPolyline(
  gpsPoints: LatLngExpression[],
  gpsGaps: number[],
  selectedRowIndex: number,
  line: MapLine,
): SegmentedPolyline {
  const limit = line === MapLine.Travelled ? selectedRowIndex : gpsPoints.length;

  const values: LatLngExpression[][] = [];
  for (let i = 0; i < gpsGaps.length; ++i) {
    const start = gpsGaps[i];
    const end = Math.min(limit, gpsGaps[i + 1] ?? gpsPoints.length);
    values.push(gpsPoints.slice(start, end));
    if (limit === end) break;
  }

  return new SegmentedPolyline(values.map((points, index) => Leaflet.polyline(points, MapLineOptions[line](index))));
}
