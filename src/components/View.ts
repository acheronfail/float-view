import { DataSource, State, type RowWithIndex } from '../lib/parse/types';
import settings from '../lib/settings.svelte';
import type { PointOfInterest } from './Map';

export interface Banner {
  text: string;
  kind: 'info' | 'warning' | 'error';
}

export interface RideStats {
  totalHalfFaults: number;
  totalFullFaults: number;
  totalQuickStops: number;
  highestPitch: number;
  lowestPitch: number;
  highestRoll: number;
  lowestRoll: number;
  highestSpeed: number;
  averageSpeed: number;
  highestErpm: number;
  highestDuty: number;
  averageDuty: number;
  highestMotorCurrent: number;
  highestFieldWeakeningCurrent: number;
  highestTempMotor: number;
  highestTempController: number;
  totalDistanceMeters: number;
}

export function computeStats(rows: RowWithIndex[], pois: PointOfInterest[]): RideStats {
  let totalHalfFaults = 0;
  let totalFullFaults = 0;
  let totalQuickStops = 0;

  for (const poi of pois) {
    const state = poi.state;
    if (state === State.Custom_OneFootpadAtSpeed) {
      totalHalfFaults += 1;
    } else if (state === State.Custom_NoFootpadsAtSpeed) {
      totalFullFaults += 1;
    } else if (state === State.Quickstop) {
      totalQuickStops += 1;
    }
  }

  let highestPitch = NaN;
  let lowestPitch = NaN;
  let highestRoll = NaN;
  let lowestRoll = NaN;
  let highestSpeed = NaN;
  let speedSum = 0;
  let highestErpm = NaN;
  let highestDuty = NaN;
  let dutySum = 0;
  let highestMotorCurrent = NaN;
  let highestFieldWeakeningCurrent = NaN;
  let highestTempMotor = NaN;
  let highestTempController = NaN;

  for (const row of rows) {
    // pitch/roll
    if (!highestPitch || row.pitch > highestPitch) highestPitch = row.pitch;
    if (!lowestPitch || row.pitch < lowestPitch) lowestPitch = row.pitch;
    if (!highestRoll || row.roll > highestRoll) highestRoll = row.roll;
    if (!lowestRoll || row.roll < lowestRoll) lowestRoll = row.roll;

    // speed
    if (!highestSpeed || Math.abs(row.speed) > highestSpeed) highestSpeed = Math.abs(row.speed);
    speedSum += row.speed;

    // erpm/duty
    if (row.erpm) {
      if (!highestErpm || row.erpm > highestErpm) highestErpm = row.erpm;
    }
    if (!highestDuty || row.duty > highestDuty) highestDuty = row.duty;
    dutySum += row.duty;

    // currents
    if (!highestMotorCurrent || Math.abs(row.current_motor) > highestMotorCurrent) {
      highestMotorCurrent = Math.abs(row.current_motor);
    }

    if (row.current_field_weakening) {
      if (!highestFieldWeakeningCurrent || Math.abs(row.current_field_weakening) > highestFieldWeakeningCurrent)
        highestFieldWeakeningCurrent = Math.abs(row.current_field_weakening);
    }

    // temperatures
    if (!highestTempMotor || row.temp_motor > highestTempMotor) highestTempMotor = row.temp_motor;
    if (row.temp_mosfet) {
      if (!highestTempController || row.temp_mosfet > highestTempController) highestTempController = row.temp_mosfet;
    }
  }

  const averageSpeed = rows.length > 0 ? speedSum / rows.length : 0;
  const averageDuty = rows.length > 0 ? dutySum / rows.length : 0;

  return {
    totalHalfFaults,
    totalFullFaults,
    totalQuickStops,
    highestPitch,
    lowestPitch,
    highestRoll,
    lowestRoll,
    highestSpeed,
    averageSpeed,
    highestErpm,
    highestDuty,
    averageDuty,
    highestMotorCurrent,
    highestFieldWeakeningCurrent,
    highestTempMotor,
    highestTempController,
    totalDistanceMeters: rows[rows.length - 1]!.distance,
  };
}

export const RIDE_GAP_THRESHOLD_SECONDS = 60;
export const CHARGE_THRESHOLD_SECONDS = 600;
const DEFAULT_CHARGE_THRESHOLD_VOLTS = 2.5;

export const getChargeThreshold = () => {
  if (!settings.cellCount || !settings.cellMinVolt || !settings.cellMaxVolt) {
    return DEFAULT_CHARGE_THRESHOLD_VOLTS;
  }

  const maxVoltage = settings.cellCount * settings.cellMaxVolt;
  const minVoltage = settings.cellCount * settings.cellMinVolt;
  return (maxVoltage - minVoltage) * 0.1;
};

export interface GpsGap {
  index: number;
  secondsElapsed: number;
}

export function extractGpsInformation(rows: RowWithIndex[], source: DataSource) {
  const gpsPoints: [number, number][] = [];

  // TODO: verify paused sessions from Floaty
  const gpsGaps: GpsGap[] = [{ index: 0, secondsElapsed: 0 }];
  for (let i = 0; i < rows.length; ++i) {
    const prev = rows[i - 1];
    const curr = rows[i]!;

    gpsPoints.push([curr.gps_latitude, curr.gps_longitude]);
    if (prev) {
      const secondsElapsed = curr.time - prev.time;
      if (secondsElapsed > RIDE_GAP_THRESHOLD_SECONDS) {
        gpsGaps.push({ index: i, secondsElapsed });
      }
    }
  }

  // Some logs begin before GNSS has a fix, producing leading (0, 0) values.
  // Replace only the leading invalid points with the first non-zero coordinate
  const firstGoodPointIndex = gpsPoints.findIndex(([lat, lon]) => lat !== 0 || lon !== 0);
  if (firstGoodPointIndex > 0) {
    const firstGoodPoint = gpsPoints[firstGoodPointIndex]!;
    for (let i = 0; i < firstGoodPointIndex; ++i) {
      gpsPoints[i] = firstGoodPoint;
    }
  }

  // When Float Control starts recording a ride, it appears that the first few data points
  // have incorrect GPS data. If it's the start of the ride, it's (0, 0), but if it's a resumed
  // ride, then it seems to be the last known point from the paused ride.
  // Either way, here we attempt to find the first "good" point and use that instead.
  if (source === DataSource.FloatControl) {
    for (let i = 0; i < gpsGaps.length; ++i) {
      const start = gpsGaps[i]!.index;
      const end = gpsGaps[i + 1];
      const curr = rows[start]!;
      const guessedGoodValue = rows.slice(start, end?.index).find((row) => {
        const samePoint = curr.gps_latitude === row.gps_latitude && curr.gps_longitude === row.gps_longitude;
        return row.gps_accuracy > 0 && !samePoint;
      });

      if (guessedGoodValue) {
        for (let j = start; j < guessedGoodValue.index; ++j) {
          gpsPoints[j] = [guessedGoodValue.gps_latitude, guessedGoodValue.gps_longitude];
        }
      }
    }
  }

  return { gpsPoints, gpsGaps };
}

export function hasAdcTelemetry(rows: RowWithIndex[]): boolean {
  return rows.some((row) => row.adc1 !== 0 || row.adc2 !== 0);
}

export function findPointsOfInterest(rows: RowWithIndex[]): PointOfInterest[] {
  const points: PointOfInterest[] = [];
  const adcFaultsEnabled = hasAdcTelemetry(rows);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;

    let states: string[] = [];

    // fault from VESC
    if (row.state !== 'riding') {
      states.push(row.state);
    }

    // custom footpad faults
    if (adcFaultsEnabled && row.speed > 2) {
      const combinedAdcVoltage = row.adc1 + row.adc2;
      if (combinedAdcVoltage < 2) {
        states.push(State.Custom_NoFootpadsAtSpeed);
      } else if (combinedAdcVoltage < 4) {
        states.push(State.Custom_OneFootpadAtSpeed);
      }
    }

    // inferred charge points
    const prevRow = rows[i - 1];
    if (prevRow !== undefined) {
      const secondsElapsed = row.time - prevRow.time;
      const voltageDifference = row.voltage - prevRow.voltage;
      if (secondsElapsed > CHARGE_THRESHOLD_SECONDS && voltageDifference > getChargeThreshold()) {
        states.push(State.Custom_ChargePoint);
      }
    }

    // SAFETY: since the enum is non-exhaustive, just check it's not in here so
    // any ones we don't know about are shown
    for (const state of states) {
      if (!settings.hiddenStates.includes(state as State)) {
        points.push({ index: i, state });
      }
    }
  }

  return points;
}
