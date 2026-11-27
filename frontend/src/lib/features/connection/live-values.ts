import { driveLoad } from './gauge';
import { freshBmsSnapshot } from './bms';
import { footpadPresentation } from './footpads';
import type { BmsState, LiveLocation, LiveSample, LiveWidgetField, UnitPreference } from '$lib/backend/contract';

export type LocationElevation = Pick<LiveLocation, 'altitudeM' | 'observedAt'>;
const maxElevationAgeMs = 10_000;

export const liveValueCatalog = {
  empty: { name: 'Empty', label: 'Hold to set', unit: '', digits: 0 },
  headlights: { name: 'Headlights', label: 'Headlights', unit: '', digits: 0 },
  leds: { name: 'LEDs', label: 'LEDs', unit: '', digits: 0 },
  themeToggle: { name: 'Light / dark mode', label: 'Appearance', unit: '', digits: 0 },
  fieldWeakeningCurrentA: { name: 'Field weakening', label: 'Field weak.', unit: 'A', digits: 1 },
  motorCurrentA: { name: 'Actual motor current', label: 'Motor', unit: 'A', digits: 1 },
  batteryCurrentA: { name: 'Battery current', label: 'Battery', unit: 'A', digits: 1 },
  powerW: { name: 'Battery power', label: 'Power', unit: 'W', digits: 0 },
  packVoltageV: { name: 'Pack voltage', label: 'Voltage', unit: 'V', digits: 1 },
  dutyCycle: { name: 'Duty cycle', label: 'Duty', unit: '%', digits: 0 },
  driveLoad: { name: 'Load', label: 'Load', unit: '%', digits: 0 },
  estimatedBatteryLevel: { name: 'Estimated battery level', label: 'Est. batt.', unit: '%', digits: 0 },
  batteryLevel: { name: 'Controller-reported battery level', label: 'Raw batt.', unit: '%', digits: 0 },
  speedKph: { name: 'Speed', label: 'Speed', unit: 'km/h', digits: 1 },
  maxSpeedKph: { name: 'Max speed', label: 'Max speed', unit: 'km/h', digits: 1 },
  distanceM: { name: 'Ride distance', label: 'Distance', unit: 'km', digits: 2 },
  odometerM: { name: 'Odometer', label: 'Odometer', unit: 'km', digits: 2 },
  altitudeM: { name: 'Elevation', label: 'Elevation', unit: 'm', digits: 0 },
  elapsedMs: { name: 'Ride time', label: 'Ride time', unit: '', digits: 0 },
  erpm: { name: 'Electrical RPM', label: 'ERPM', unit: 'ERPM', digits: 0 },
  controllerTempC: { name: 'Controller temperature', label: 'ESC temp', unit: '°C', digits: 1 },
  motorTempC: { name: 'Motor temperature', label: 'Motor temp', unit: '°C', digits: 1 },
  highestTempC: { name: 'Highest temperature', label: 'Highest temp', unit: '°C', digits: 1 },
  bmsStateOfCharge: { name: 'BMS battery level', label: 'BMS batt.', unit: '%', digits: 0 },
  bmsStateOfHealth: { name: 'BMS battery health', label: 'BMS health', unit: '%', digits: 0 },
  bmsTotalVoltageV: { name: 'BMS pack voltage', label: 'BMS volts', unit: 'V', digits: 1 },
  bmsInputCurrentA: { name: 'BMS battery current', label: 'BMS current', unit: 'A', digits: 1 },
  bmsChargeVoltageV: { name: 'BMS charge voltage', label: 'BMS charge', unit: 'V', digits: 1 },
  bmsMinCellVoltageV: { name: 'Lowest cell voltage', label: 'Min cell', unit: 'V', digits: 3 },
  bmsMaxCellVoltageV: { name: 'Highest cell voltage', label: 'Max cell', unit: 'V', digits: 3 },
  bmsCellVoltageSpreadV: { name: 'Cell voltage spread', label: 'Cell spread', unit: 'V', digits: 3 },
  bmsHighestCellTempC: { name: 'Battery temperature', label: 'Battery temp', unit: '°C', digits: 1 },
  bmsIcTempC: { name: 'BMS temperature', label: 'BMS temp', unit: '°C', digits: 1 },
  bmsHumidityPercent: { name: 'Battery humidity', label: 'Humidity', unit: '%', digits: 1 },
  directionalMotorCurrentA: { name: 'Directional motor current', label: 'Dir. motor', unit: 'A', digits: 1 },
  filteredMotorCurrentA: { name: 'Filtered motor current', label: 'Filt. motor', unit: 'A', digits: 1 },
  requestedBalanceCurrentA: { name: 'Requested balance current', label: 'Requested', unit: 'A', digits: 1 },
  boosterCurrentA: { name: 'Booster current', label: 'Booster', unit: 'A', digits: 1 },
  pitchDeg: { name: 'Pitch', label: 'Pitch', unit: '°', digits: 1 },
  balancePitchDeg: { name: 'Balance pitch', label: 'Bal. pitch', unit: '°', digits: 1 },
  rollDeg: { name: 'Roll', label: 'Roll', unit: '°', digits: 1 },
  footpadAdc1V: { name: 'Footpad ADC 1', label: 'Pad 1', unit: 'V', digits: 2 },
  footpadAdc2V: { name: 'Footpad ADC 2', label: 'Pad 2', unit: 'V', digits: 2 },
  remoteInput: { name: 'Remote input', label: 'Remote', unit: '', digits: 3 },
  setpointDeg: { name: 'Final setpoint', label: 'Setpoint', unit: '°', digits: 1 },
  atrSetpointDeg: { name: 'ATR setpoint', label: 'ATR', unit: '°', digits: 1 },
  brakeTiltSetpointDeg: { name: 'Brake-tilt setpoint', label: 'Brake tilt', unit: '°', digits: 1 },
  torqueTiltSetpointDeg: { name: 'Torque-tilt setpoint', label: 'Torque tilt', unit: '°', digits: 1 },
  turnTiltSetpointDeg: { name: 'Turn-tilt setpoint', label: 'Turn tilt', unit: '°', digits: 1 },
  remoteSetpointDeg: { name: 'Remote setpoint', label: 'Remote tilt', unit: '°', digits: 1 },
  atrAccelerationDifferenceErpmPerSecond: {
    name: 'ATR acceleration difference',
    label: 'ATR accel.',
    unit: 'ERPM/s',
    digits: 0,
  },
  atrSpeedBoost: { name: 'ATR speed boost', label: 'ATR boost', unit: '', digits: 3 },
  ampHoursDrawnAh: { name: 'Amp-hours drawn', label: 'Ah drawn', unit: 'Ah', digits: 2 },
  ampHoursChargedAh: { name: 'Amp-hours charged', label: 'Ah charged', unit: 'Ah', digits: 2 },
  ampHoursNetAh: { name: 'Net amp-hours', label: 'Ah net', unit: 'Ah', digits: 2 },
  wattHoursDrawnWh: { name: 'Watt-hours drawn', label: 'Wh drawn', unit: 'Wh', digits: 1 },
  wattHoursChargedWh: { name: 'Watt-hours charged', label: 'Wh charged', unit: 'Wh', digits: 1 },
  wattHoursNetWh: { name: 'Net watt-hours', label: 'Wh net', unit: 'Wh', digits: 1 },
  chargingCurrentA: { name: 'Charging current', label: 'Charge I', unit: 'A', digits: 1 },
  chargingVoltageV: { name: 'Charging voltage', label: 'Charge V', unit: 'V', digits: 1 },
} satisfies Record<LiveWidgetField, { name: string; label: string; unit: string; digits: number }>;

export function liveValue(
  field: LiveWidgetField,
  sample: LiveSample | null | undefined,
  units: UnitPreference,
  estimatedLevel?: number | null,

  bms?: BmsState | null,
  nowMs: number = Date.now(),
  location?: LocationElevation | null
) {
  const load = field === 'driveLoad' ? driveLoad(sample) : null;
  const snapshot = freshBmsSnapshot(bms, nowMs);
  const cells = snapshot?.cellVoltagesV.filter(Number.isFinite) ?? [];
  const hottest = field === 'highestTempC' ? highestTemperature(sample, bms, nowMs) : null;
  const netValues = {
    ampHoursNetAh: netCounter(sample?.ampHoursDrawnAh, sample?.ampHoursChargedAh),
    wattHoursNetWh: netCounter(sample?.wattHoursDrawnWh, sample?.wattHoursChargedWh),
  };
  const bmsValues = {
    bmsStateOfCharge: snapshot?.stateOfCharge == null ? null : snapshot.stateOfCharge * 100,
    bmsStateOfHealth: snapshot?.stateOfHealth == null ? null : snapshot.stateOfHealth * 100,
    bmsTotalVoltageV: snapshot?.totalVoltageV,
    bmsInputCurrentA: snapshot?.inputCurrentA,
    bmsChargeVoltageV: snapshot?.chargeVoltageV,
    bmsMinCellVoltageV: cells.length ? Math.min(...cells) : null,
    bmsMaxCellVoltageV: cells.length ? Math.max(...cells) : null,
    bmsCellVoltageSpreadV: cells.length ? Math.max(...cells) - Math.min(...cells) : null,
    bmsHighestCellTempC: snapshot?.highestCellTemperatureC,
    bmsIcTempC: snapshot?.icTemperatureC,
    bmsHumidityPercent: snapshot?.humidityPercent,
  };
  const definition = {
    ...liveValueCatalog[field],
    ...(hottest ? { label: hottest.label } : {}),
    ...(load ? { label: { duty: 'Duty', motor: 'Motor', battery: 'Battery' }[load.source] } : {}),
  };
  let value =
    field === 'altitudeM'
      ? currentAltitude(location, nowMs)
      : field in netValues
        ? netValues[field as keyof typeof netValues]
        : field === 'elapsedMs'
          ? sample?.ridingElapsedMs
          : field === 'highestTempC'
            ? hottest?.value
            : field in bmsValues
              ? bmsValues[field as keyof typeof bmsValues]
              : field === 'driveLoad'
                ? load?.percentage
                : field === 'powerW'
                  ? sample?.packVoltageV == null || sample.batteryCurrentA == null
                    ? null
                    : sample.packVoltageV * sample.batteryCurrentA
                  : field === 'estimatedBatteryLevel'
                    ? estimatedLevel
                    : field === 'empty' || field === 'headlights' || field === 'leds' || field === 'themeToggle'
                      ? null
                      : (sample?.[field as keyof LiveSample] as number | null | undefined);
  let unit: string = definition.unit;
  if (value == null || !Number.isFinite(value)) return { ...definition, value: null, unit: displayUnit(unit, units) };
  if (field === 'batteryLevel' || field === 'estimatedBatteryLevel' || field === 'dutyCycle') value *= 100;
  if (unit === 'km') value /= units === 'metric' ? 1000 : 1609.344;
  if (unit === 'm' && units === 'imperial') value /= 0.3048;
  if (unit === 'km/h') value = Math.abs(value) * (units === 'metric' ? 1 : 0.621371);
  if (unit === '°C' && units === 'imperial') value = value * 1.8 + 32;
  unit = displayUnit(unit, units);
  return { ...definition, value, unit };
}

function currentAltitude(location: LocationElevation | null | undefined, nowMs: number) {
  if (location?.altitudeM == null) return null;
  const age = nowMs - Date.parse(location.observedAt);
  // A fix can arrive between the dashboard's one-second clock ticks.
  return age >= -1_000 && age <= maxElevationAgeMs ? location.altitudeM : null;
}

function netCounter(drawn: number | null | undefined, charged: number | null | undefined) {
  return drawn == null || charged == null || !Number.isFinite(drawn) || !Number.isFinite(charged)
    ? null
    : drawn - charged;
}

function displayUnit(unit: string, units: UnitPreference) {
  if (units === 'metric') return unit;
  return ({ 'km/h': 'mph', km: 'mi', m: 'ft', '°C': '°F' } as Record<string, string>)[unit] ?? unit;
}

export function liveValueText(field: LiveWidgetField, value: number | null, digits: number) {
  if (value == null) return '—';
  if (field === 'elapsedMs') {
    const seconds = Math.floor(value / 1000);
    return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  const text = value.toFixed(digits);
  // Avoid negative zero during interpolation.
  return field === 'powerW' && Number(text) > 0 ? `+${text}` : Number(text) === 0 ? (0).toFixed(digits) : text;
}

export function liveValueColor(
  field: LiveWidgetField,
  value: number | null,
  sample?: LiveSample | null,
  units: UnitPreference = 'metric'
) {
  if (value == null) return 'text-foreground';
  if (field === 'driveLoad') {
    const load = driveLoad(sample);
    return load
      ? { duty: 'text-duty', motor: 'text-motor', battery: 'text-battery-current' }[load.source]
      : 'text-muted';
  }
  if (field === 'powerW')
    return Math.round(value) > 0 ? 'text-power-draw' : Math.round(value) < 0 ? 'text-success' : 'text-foreground';
  if (field === 'footpadAdc1V' || field === 'footpadAdc2V')
    return footpadPresentation(sample, field === 'footpadAdc1V' ? 'left' : 'right').text;
  if (field === 'dutyCycle') return 'text-duty';
  if (field === 'speedKph' || field === 'erpm') return 'text-accent';
  if (field === 'batteryLevel' || field === 'estimatedBatteryLevel' || field === 'bmsStateOfCharge')
    return Math.round(value) <= 20 ? 'text-danger' : Math.round(value) < 50 ? 'text-warning' : 'text-success';
  if (liveValueCatalog[field].unit === '°C') {
    const celsius = units === 'imperial' ? (value - 32) / 1.8 : value;
    return celsius >= 60 ? 'text-danger' : celsius > 30 ? 'text-warning' : 'text-success';
  }
  if (
    [
      'motorCurrentA',
      'directionalMotorCurrentA',
      'filteredMotorCurrentA',
      'requestedBalanceCurrentA',
      'boosterCurrentA',
    ].includes(field)
  )
    return 'text-motor';
  if (field === 'batteryCurrentA')
    return value > 0 ? 'text-power-draw' : value < 0 ? 'text-success' : 'text-foreground';
  if (field === 'ampHoursNetAh' || field === 'wattHoursNetWh') {
    const rounded = Number(value.toFixed(liveValueCatalog[field].digits));
    return rounded > 0 ? 'text-power-draw' : rounded < 0 ? 'text-success' : 'text-foreground';
  }
  if (field === 'ampHoursDrawnAh' || field === 'wattHoursDrawnWh') return 'text-power-draw';
  if (field === 'ampHoursChargedAh' || field === 'wattHoursChargedWh' || field === 'chargingCurrentA')
    return 'text-success';
  return 'text-foreground';
}

export function liveValueStatus(field: LiveWidgetField, sample: LiveSample | null | undefined) {
  if ((field === 'footpadAdc1V' || field === 'footpadAdc2V') && sample?.[field] != null)
    return footpadPresentation(sample, field === 'footpadAdc1V' ? 'left' : 'right').label;
  return '';
}

function highestTemperature(sample: LiveSample | null | undefined, bms: BmsState | null | undefined, nowMs: number) {
  const snapshot = freshBmsSnapshot(bms, nowMs);
  const candidates = [
    { label: 'ESC temp', value: sample?.controllerTempC },
    { label: 'Motor temp', value: sample?.motorTempC },
    { label: 'Battery temp', value: snapshot?.highestCellTemperatureC },
    { label: 'BMS temp', value: snapshot?.highestCircuitryTemperatureC },
    { label: 'Humidity temp', value: snapshot?.humiditySensorTemperatureC },
  ].filter(
    (reading): reading is { label: string; value: number } => reading.value != null && Number.isFinite(reading.value)
  );
  // Stable sensor order resolves ties, and also handles readings below freezing.
  return candidates.reduce<{ label: string; value: number } | null>(
    (highest, reading) => (!highest || reading.value > highest.value ? reading : highest),
    null
  );
}
