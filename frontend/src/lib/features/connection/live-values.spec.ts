import { describe, expect, it } from 'vitest';
import { liveValue, liveValueCatalog, liveValueColor, liveValueText } from './live-values';
import { defaultLiveWidgetSlots, liveWidgetFields, type LiveSample } from '$lib/backend/contract';
const sample = {
  packVoltageV: 75,
  batteryCurrentA: -4,
  speedKph: 20,
  distanceM: 1609.344,
  motorTempC: 0,
  fieldWeakeningCurrentA: 0.7,
} as LiveSample;
describe('live value selection', () => {
  it('offers every allowed widget field', () => {
    expect(defaultLiveWidgetSlots).toEqual(['empty', 'powerW', 'elapsedMs', 'odometerM', 'distanceM']);
    expect(Object.keys(liveValueCatalog)).toEqual([...liveWidgetFields]);
  });
  it('uses native riding time rather than the session timeline, including while idle', () => {
    for (const rideState of ['riding', 'idle', 'unknown'] as const) {
      expect(
        liveValue('elapsedMs', { ...sample, elapsedMs: 90_000, ridingElapsedMs: 12_000, rideState }, 'metric')
      ).toMatchObject({ name: 'Ride time', value: 12_000 });
    }
    expect(liveValue('elapsedMs', null, 'metric').value).toBeNull();
  });
  it('formats the authoritative ride peak independently of instantaneous speed', () => {
    const peak = { ...sample, speedKph: 5, maxSpeedKph: 32.18688 };
    expect(liveValue('maxSpeedKph', peak, 'metric')).toMatchObject({ value: 32.18688, unit: 'km/h', digits: 1 });
    expect(liveValue('maxSpeedKph', peak, 'imperial').value).toBeCloseTo(20, 4);
    expect(liveValue('maxSpeedKph', null, 'metric').value).toBeNull();
    expect(liveValueText('maxSpeedKph', 32.18688, 1)).toBe('32.2');
  });
  it('keeps sign, units and missing values', () => {
    expect(liveValue('powerW', sample, 'metric').value).toBe(-300);
    expect(liveValue('powerW', { ...sample, packVoltageV: null }, 'metric').value).toBeNull();
    expect(liveValue('distanceM', sample, 'imperial')).toMatchObject({ value: 1, unit: 'mi' });
    expect(liveValue('motorTempC', sample, 'imperial')).toMatchObject({ value: 32, unit: '°F' });
    expect(liveValue('fieldWeakeningCurrentA', sample, 'metric').value).toBe(0.7);
    expect(liveValue('estimatedBatteryLevel', sample, 'metric', 0.56).value).toBeCloseTo(56);
    expect(liveValue('batteryLevel', sample, 'metric').value).toBeNull();
  });
  it('uses a fresh GPS fix for elevation with signed values and distance units', () => {
    const fix = { altitudeM: -30.48, observedAt: new Date(20_000).toISOString() };
    const reading = (units: 'metric' | 'imperial', nowMs: number, location = fix) =>
      liveValue('altitudeM', sample, units, undefined, null, nowMs, location);
    expect(reading('metric', 20_000)).toMatchObject({ value: -30.48, unit: 'm' });
    expect(reading('imperial', 20_000)).toMatchObject({ value: -100, unit: 'ft' });
    expect(reading('metric', 30_001).value).toBeNull();
    expect(reading('metric', 18_999).value).toBeNull();
    expect(reading('metric', 20_000, { ...fix, altitudeM: 0 }).value).toBe(0);
    expect(liveValue('altitudeM', sample, 'metric').value).toBeNull();
  });
  it('formats power direction, time and unavailable readings', () => {
    expect(liveValueText('powerW', 900, 0)).toBe('+900');
    expect(liveValueText('powerW', -0.1, 0)).toBe('0');
    expect(liveValueText('elapsedMs', 3_661_000, 0)).toBe('1:01:01');
    expect(liveValueText('powerW', null, 0)).toBe('—');
    expect(liveValueColor('powerW', 900)).toBe('text-power-draw');
    expect(liveValueColor('powerW', -300)).toBe('text-success');
  });
});

describe('live value colours', () => {
  it('uses footpad state rather than ADC voltage and alerts only above the speed threshold', () => {
    const atRest = { ...sample, footpadState: 'left', speedKph: 0 } as LiveSample;
    expect(liveValueColor('footpadAdc1V', 0.1, atRest)).toBe('text-success');
    expect(liveValueColor('footpadAdc2V', 3.3, atRest)).toBe('text-muted');
    expect(liveValueColor('footpadAdc2V', 3.3, { ...atRest, speedKph: 2 })).toBe('text-muted');
    expect(liveValueColor('footpadAdc2V', 3.3, { ...atRest, speedKph: 2.1 })).toBe('text-danger');
    expect(liveValueColor('footpadAdc1V', 0.1, { ...atRest, speedKph: 20 })).toBe('text-success');
    expect(liveValueColor('footpadAdc2V', null, { ...atRest, speedKph: 20 })).toBe('text-foreground');
    expect(liveValueColor('footpadAdc2V', 3.3, { ...atRest, footpadState: 'both' })).toBe('text-success');
  });
  it('keeps temperature meaning consistent across display units', () => {
    for (const [celsius, color] of [
      [30, 'text-success'],
      [45, 'text-warning'],
      [60, 'text-danger'],
    ] as const) {
      expect(liveValueColor('motorTempC', celsius)).toBe(color);
      expect(liveValueColor('controllerTempC', celsius * 1.8 + 32, sample, 'imperial')).toBe(color);
    }
  });
  it('colours percentages and electrical directions without guessing voltage limits', () => {
    expect(liveValueColor('estimatedBatteryLevel', 20)).toBe('text-danger');
    expect(liveValueColor('batteryLevel', 35)).toBe('text-warning');
    expect(liveValueColor('batteryLevel', 50)).toBe('text-success');
    expect(liveValueColor('batteryCurrentA', 10)).toBe('text-power-draw');
    expect(liveValueColor('batteryCurrentA', -10)).toBe('text-success');
    expect(liveValueColor('batteryCurrentA', 0)).toBe('text-foreground');
    expect(liveValueColor('packVoltageV', 60)).toBe('text-foreground');
    expect(liveValueColor('dutyCycle', 40)).toBe('text-duty');
    expect(liveValueColor('wattHoursDrawnWh', 100)).toBe('text-power-draw');
    expect(liveValueColor('wattHoursChargedWh', 10)).toBe('text-success');
  });
});

describe('load widget', () => {
  it.each([
    [0.9, 60, 10, 90, 'Duty', 'text-duty'],
    [0.2, 60, 10, 60, 'Motor', 'text-motor'],
    [0.2, -10, -15, 75, 'Battery', 'text-battery-current'],
  ] as const)(
    'matches the gauge source and percentage',
    (dutyCycle, motorCurrentA, batteryCurrentA, value, label, color) => {
      const readingSample = {
        ...sample,
        dutyCycle,
        motorCurrentA,
        batteryCurrentA,
        load: {
          duty: null,
          motor: null,
          battery: null,
          winner: { source: label.toLowerCase() as 'duty' | 'motor' | 'battery', fraction: value / 100 },
        },
      };
      expect(liveValue('driveLoad', readingSample, 'metric', null)).toMatchObject({ value, label, unit: '%' });
      expect(liveValueColor('driveLoad', value, readingSample, 'metric')).toBe(color);
    }
  );
  it('keeps unavailable load unavailable and supports duty without limits', () => {
    expect(liveValue('driveLoad', null, 'metric').value).toBeNull();
    expect(
      liveValue(
        'driveLoad',
        {
          ...sample,
          dutyCycle: 0.4,
          load: { duty: 0.4, motor: null, battery: null, winner: { source: 'duty', fraction: 0.4 } },
        },
        'imperial'
      ).value
    ).toBe(40);
  });
});

describe('BMS boxes and highest temperature', () => {
  const now = Date.parse('2026-10-13T00:00:00Z');
  const bms = {
    status: 'attached',
    connection: { kind: 'can', canId: 3 },
    candidates: [],
    latestSnapshot: {
      observedAt: new Date(now).toISOString(),
      totalVoltageV: 75,
      inputCurrentA: -2,
      chargeVoltageV: 80,
      stateOfCharge: 0.75,
      stateOfHealth: 0.98,
      cellVoltagesV: [4.1, 4.05, 4.08],
      temperaturesC: [31, 47],
      highestCellTemperatureC: 44,
      highestCircuitryTemperatureC: 40,
      icTemperatureC: 40,
      humiditySensorTemperatureC: 35,
      humidityPercent: 22,
      inputIcCurrentA: 0,
      sessionAmpHoursAh: 0,
      sessionWattHoursWh: 0,
      balancing: [],
      reportedCanId: 3,
      lifetimeChargeAmpHoursAh: 0,
      lifetimeChargeWattHoursWh: 0,
      lifetimeDischargeAmpHoursAh: 0,
      lifetimeDischargeWattHoursWh: 0,
      pressurePa: 0,
      dataVersion: 1,
      status: null,
    },
  } as import('$lib/backend/contract').BmsState;
  const reading = (field: import('$lib/backend/contract').LiveWidgetField, state = bms, time = now) =>
    liveValue(field, { ...sample, controllerTempC: 38, motorTempC: 45 }, 'metric', null, state, time);

  it('uses BMS fractions, signed current, cell extrema and explicit cell temperature', () => {
    expect(reading('bmsStateOfCharge').value).toBe(75);
    expect(reading('bmsStateOfHealth').value).toBe(98);
    expect(reading('bmsTotalVoltageV').value).toBe(75);
    expect(reading('bmsInputCurrentA').value).toBe(-2);
    expect(reading('bmsChargeVoltageV').value).toBe(80);
    expect(reading('bmsMinCellVoltageV').value).toBe(4.05);
    expect(reading('bmsMaxCellVoltageV').value).toBe(4.1);
    expect(reading('bmsCellVoltageSpreadV').value).toBeCloseTo(0.05);
    expect(reading('bmsHighestCellTempC').value).toBe(44);
    expect(reading('bmsIcTempC').value).toBe(40);
    expect(reading('bmsHumidityPercent').value).toBe(22);
    expect(reading('highestTempC')).toMatchObject({ value: 45, label: 'Motor temp' });
  });

  it.each(['not_found', 'discovering', 'unavailable', 'ambiguous'] as const)('falls back when BMS is %s', (status) => {
    const unavailable = { ...bms, status };
    for (const field of liveWidgetFields.filter((field) => field.startsWith('bms')))
      expect(reading(field, unavailable).value).toBeNull();
    expect(reading('highestTempC', unavailable)).toMatchObject({ value: 45, label: 'Motor temp' });
  });

  it('expires stale, future and invalid BMS timestamps, and handles empty cells', () => {
    for (const observedAt of [new Date(now - 5000).toISOString(), new Date(now + 1).toISOString(), 'invalid']) {
      const stale = { ...bms, latestSnapshot: { ...bms.latestSnapshot!, observedAt } };
      expect(reading('bmsStateOfCharge', stale).value).toBeNull();
      expect(reading('highestTempC', stale)).toMatchObject({ value: 45, label: 'Motor temp' });
    }
    expect(reading('bmsStateOfCharge', bms, now + 4999).value).toBe(75);
    expect(
      reading('bmsMinCellVoltageV', { ...bms, latestSnapshot: { ...bms.latestSnapshot!, cellVoltagesV: [] } }).value
    ).toBeNull();
    expect(liveValue('highestTempC', null, 'metric', null, null, now).value).toBeNull();
  });

  it('identifies every winning sensor, switches immediately and converts the winner to Fahrenheit', () => {
    for (const [key, label] of [
      ['highestCircuitryTemperatureC', 'BMS temp'],
      ['humiditySensorTemperatureC', 'Humidity temp'],
    ] as const) {
      const state = { ...bms, latestSnapshot: { ...bms.latestSnapshot!, [key]: 70 } };
      expect(reading('highestTempC', state)).toMatchObject({ value: 70, label });
    }
    expect(liveValue('highestTempC', { ...sample, controllerTempC: 80 }, 'imperial', null, bms, now)).toMatchObject({
      value: 176,
      label: 'ESC temp',
      unit: '°F',
    });
    expect(liveValue('highestTempC', { ...sample, controllerTempC: -10, motorTempC: -5 }, 'metric')).toMatchObject({
      value: -5,
      label: 'Motor temp',
    });
    expect(liveValue('highestTempC', { ...sample, controllerTempC: NaN, motorTempC: 0 }, 'metric')).toMatchObject({
      value: 0,
      label: 'Motor temp',
    });
    expect(liveValueColor('highestTempC', 176, sample, 'imperial')).toBe('text-danger');
  });
});

describe('net consumption readings', () => {
  it.each([
    ['wattHoursNetWh', 'wattHoursDrawnWh', 'wattHoursChargedWh', 'Wh', 1],
    ['ampHoursNetAh', 'ampHoursDrawnAh', 'ampHoursChargedAh', 'Ah', 2],
  ] as const)(
    'derives %s with signed consumption and complete finite operands',
    (field, drawn, charged, unit, digits) => {
      for (const units of ['metric', 'imperial'] as const) {
        for (const [draw, charge, net] of [
          [120, 20, 100],
          [20, 120, -100],
          [0, 0, 0],
        ]) {
          expect(liveValue(field, { ...sample, [drawn]: draw, [charged]: charge }, units)).toMatchObject({
            value: net,
            unit,
            digits,
          });
          expect(liveValueColor(field, net)).toBe(
            net > 0 ? 'text-power-draw' : net < 0 ? 'text-success' : 'text-foreground'
          );
          expect(liveValueText(field, net, digits)).toBe(net.toFixed(digits));
        }
        for (const unavailable of [null, undefined, NaN, Infinity, -Infinity]) {
          expect(liveValue(field, { ...sample, [drawn]: unavailable, [charged]: 20 }, units).value).toBeNull();
          expect(liveValue(field, { ...sample, [drawn]: 120, [charged]: unavailable }, units).value).toBeNull();
        }
        expect(liveValue(field, null, units).value).toBeNull();
      }
      expect(liveValueColor(field, -0.0001)).toBe('text-foreground');
      expect(liveValueText(field, -0.0001, digits)).toBe((0).toFixed(digits));
      expect(liveValueText(field, null, digits)).toBe('—');
    }
  );
});
