import type { TickOptions } from '../lib/chart-helpers';

export interface Props {
  data: {
    color?: string;
    label?: string;
    values: number[];
  }[];
  selectedIndex: number;
  setSelectedIdx: (index: number) => void;
  gapIndices: number[];

  yAxis?: TickOptions;
  unit?: string;
  title?: string;
  precision?: number;
  showMax?: boolean | 'nonzero';
  showMin?: boolean | 'nonzero';
}
