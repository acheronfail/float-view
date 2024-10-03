import { type LatLngExpression } from 'leaflet';
import type { RowWithIndex } from '../lib/parse/types';
import type { GpsGap } from './App';

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
