import type { DashboardReading, DashboardWidget } from '$lib/backend/contract';
import { liveValueCatalog } from './live-values';

export const readingCategories: { name: string; fields: DashboardReading[] }[] = [
  { name: 'Motion', fields: ['speedKph', 'maxSpeedKph', 'distanceM', 'odometerM', 'altitudeM', 'elapsedMs', 'erpm'] },
  {
    name: 'Battery',
    fields: [
      'estimatedBatteryLevel',
      'batteryLevel',
      'packVoltageV',
      'batteryCurrentA',
      'powerW',
      'ampHoursDrawnAh',
      'ampHoursChargedAh',
      'ampHoursNetAh',
      'wattHoursDrawnWh',
      'wattHoursChargedWh',
      'wattHoursNetWh',
      'chargingCurrentA',
      'chargingVoltageV',
    ],
  },
  {
    name: 'Electrical',
    fields: [
      'driveLoad',
      'dutyCycle',
      'motorCurrentA',
      'directionalMotorCurrentA',
      'filteredMotorCurrentA',
      'requestedBalanceCurrentA',
      'boosterCurrentA',
      'fieldWeakeningCurrentA',
    ],
  },
  { name: 'Temperatures', fields: ['controllerTempC', 'motorTempC', 'highestTempC'] },
  {
    name: 'Balance and rider input',
    fields: [
      'pitchDeg',
      'balancePitchDeg',
      'rollDeg',
      'footpadAdc1V',
      'footpadAdc2V',
      'remoteInput',
      'setpointDeg',
      'atrSetpointDeg',
      'brakeTiltSetpointDeg',
      'torqueTiltSetpointDeg',
      'turnTiltSetpointDeg',
      'remoteSetpointDeg',
      'atrAccelerationDifferenceErpmPerSecond',
      'atrSpeedBoost',
    ],
  },
  {
    name: 'BMS',
    fields: [
      'bmsStateOfCharge',
      'bmsStateOfHealth',
      'bmsTotalVoltageV',
      'bmsInputCurrentA',
      'bmsChargeVoltageV',
      'bmsMinCellVoltageV',
      'bmsMaxCellVoltageV',
      'bmsCellVoltageSpreadV',
      'bmsHighestCellTempC',
      'bmsIcTempC',
      'bmsHumidityPercent',
    ],
  },
];
export type WidgetCatalogEntry = {
  name: string;
  category: string;
  section: 'Values' | 'Visual widgets' | 'Controls';
  description: string;
  widget: DashboardWidget;
};
const popular: DashboardReading[] = ['speedKph', 'estimatedBatteryLevel', 'packVoltageV', 'motorCurrentA', 'driveLoad'];
const visualPresets = [
  { name: 'Speed and load', visual: 'speedGauge', columns: 3, rows: 3 },
  { name: 'Battery panel', visual: 'battery', columns: 2, rows: 1 },
  { name: 'Temperatures', visual: 'temperatures', columns: 2, rows: 2 },
  { name: 'Footpads', visual: 'footpads', columns: 2, rows: 1 },
] as const;
export const widgetCatalog: WidgetCatalogEntry[] = [
  ...readingCategories.flatMap(({ name: category, fields }) =>
    fields.map(
      (field): WidgetCatalogEntry => ({
        name: liveValueCatalog[field].name,
        category,
        section: 'Values',
        description: 'Number · 1 × 1',
        widget: {
          id: `reading-${field}`,
          kind: 'reading',
          field,
          presentation: 'number',
          size: { columns: 1, rows: 1 },
        },
      })
    )
  ),
  ...visualPresets.map(
    (entry): WidgetCatalogEntry => ({
      name: entry.name,
      category: 'Visual widgets',
      section: 'Visual widgets',
      description: `${entry.columns} × ${entry.rows} · Combined display`,
      widget: {
        id: `visual-${entry.visual}`,
        kind: 'visual',
        visual: entry.visual,
        size: { columns: entry.columns, rows: entry.rows },
      },
    })
  ),
  {
    name: 'Light / dark mode',
    category: 'Controls',
    section: 'Controls',
    description: 'Button · 1 × 1 · Toggle appearance theme',
    widget: { id: 'action-themeToggle', kind: 'action', action: 'themeToggle', size: { columns: 1, rows: 1 } },
  },
  {
    name: 'Save ride marker',
    category: 'Controls',
    section: 'Controls',
    description: 'Button · 1 × 1 · Mark a moment in your ride',
    widget: { id: 'action-rideMarker', kind: 'action', action: 'rideMarker', size: { columns: 1, rows: 1 } },
  },
  ...(['headlights', 'leds'] as const).map(
    (control): WidgetCatalogEntry => ({
      name: liveValueCatalog[control].name,
      category: 'Controls',
      section: 'Controls',
      description: 'Switch · 1 × 1',
      widget: { id: `control-${control}`, kind: 'control', control, size: { columns: 1, rows: 1 } },
    })
  ),
];
export function pickerGroups(query: string, browseAll: boolean) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const all = words.length > 0 || browseAll;
  const entries = widgetCatalog.filter((entry) => {
    const reading = entry.widget.kind === 'reading' ? liveValueCatalog[entry.widget.field] : null;
    const text = [
      entry.name,
      entry.category,
      entry.description,
      reading?.label ?? '',
      reading?.unit ?? '',
      entry.section === 'Values' ? 'text value number reading' : '',
      reading?.unit === '%' ? 'percent percentage' : '',
    ]
      .join(' ')
      .toLocaleLowerCase();
    if (words.length) return words.every((word) => text.includes(word));
    return all || entry.widget.kind !== 'reading' || popular.includes(entry.widget.field);
  });
  const groups = new Map<string, WidgetCatalogEntry[]>();
  for (const entry of entries) {
    const name = entry.section === 'Values' && all ? entry.category : entry.section;
    const group = groups.get(name) ?? [];
    group.push(entry);
    groups.set(name, group);
  }
  return [...groups].map(([name, entries]) => ({ name, entries }));
}
