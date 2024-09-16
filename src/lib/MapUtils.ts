import Leaflet, { type PolylineOptions } from 'leaflet';
import riderSvg from '../assets/rider-icon.svg?raw';
import footpadSvg from '../assets/footpad.svg?raw';
import warningSvg from '../assets/warning.svg?raw';
import { State } from './FloatControlTypes';

export { riderSvg };
export const riderIcon = Leaflet.divIcon({ className: 'rider-icon', html: riderSvg });
export const footpadIcon = Leaflet.divIcon({ className: 'fault-icon svg', html: footpadSvg, iconSize: [20, 20] });
export const genericIcon = Leaflet.divIcon({ className: 'fault-icon' });
export const warningIcon = Leaflet.divIcon({
  className: 'fault-icon warning svg',
  html: warningSvg,
  iconSize: [15, 15],
});
export const faultIcons: Record<string, Leaflet.DivIcon | undefined> = {
  [State.Wheelslip]: warningIcon,
  [State.StopAngle]: warningIcon,
  [State.StopFull]: warningIcon,
  [State.Custom_OneFootpadAtSpeed]: footpadIcon,
  [State.Custom_NoFootpadsAtSpeed]: footpadIcon,
};

const faultToClassName = (fault: string) => fault.replace(/\W/g, '_');
export const getIcon = (fault: string): { icon: Leaflet.DivIcon; className: string } => ({
  icon: faultIcons[fault] ?? genericIcon,
  className: faultToClassName(fault),
});

export enum MapLine {
  Base,
  Travelled,
}

export const MapLineOptions: Record<MapLine, PolylineOptions> = {
  [MapLine.Base]: { color: '#cffafe', weight: 2, dashArray: '5 5', opacity: 0.5 },
  [MapLine.Travelled]: { color: '#06b6d4', weight: 4 },
};
