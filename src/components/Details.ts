import { State } from '../lib/parse/types';

export const getStateColor = (state: string): string | undefined => {
  switch (state.toLowerCase()) {
    case 'riding':
      return 'yellowgreen';
    case State.Startup:
      return 'grey';
    case State.StopHalf:
    case State.Quickstop:
    case State.Wheelslip:
      return 'orange';
    case State.StopFull:
    case State.StopAngle:
      return 'red';
  }
};
