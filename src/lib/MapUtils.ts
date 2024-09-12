import Leaflet from 'leaflet';
import riderIconSvg from '../assets/rider-icon.svg?raw';
import warningSvg from '../assets/warning.svg?raw';
import { State } from './FloatControlTypes';

export { riderIconSvg };
export const riderIcon = Leaflet.divIcon({ className: 'rider-icon', html: riderIconSvg });
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
  [State.Quickstop]: warningIcon,
  [State.Custom_OneFootpadAtSpeed]: warningIcon,
  [State.Custom_NoFootpadsAtSpeed]: warningIcon,
};

const faultToClassName = (fault: string) => fault.replace(/\W/g, '_');
export const getIcon = (fault: string): { icon: Leaflet.DivIcon; className: string } => ({
  icon: faultIcons[fault] ?? genericIcon,
  className: faultToClassName(fault),
});
