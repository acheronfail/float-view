import { z } from 'zod';
import { State, Units } from './parse/types';
import type { ChartKey } from './chart-helpers';

const BatterySpecsSchema = z.object({
  cellCount: z.number().nullish(),
  cellMinVolt: z.number().nullish(),
  cellMaxVolt: z.number().nullish(),
});
export type ZBatterySpecs = z.infer<typeof BatterySpecsSchema>;

const HiddenFaultSchema = z.nativeEnum(State).array();
const UnitsSchema = z.nativeEnum(Units);

const SavedSettingsSchema = z.object({
  batterySpecs: BatterySpecsSchema,
  hiddenFaults: HiddenFaultSchema,
  units: UnitsSchema,
  charts: z.string().array(),
});
type ZSavedSettings = z.infer<typeof SavedSettingsSchema>;

export const localStorageKey = 'fv_settings';
const savedSettings: ZSavedSettings | undefined = (() => {
  const value = window.localStorage.getItem(localStorageKey);
  try {
    if (typeof value === 'string' && value.length > 0) {
      return SavedSettingsSchema.parse(JSON.parse(value));
    }
  } catch (err) {
    console.error('Failed to parse saved settings', err);
    window.localStorage.removeItem(localStorageKey);
  }
})();

type SelectedCharts = [ChartKey, ChartKey, ChartKey, ChartKey, ChartKey, ChartKey];
const defaultSelectedCharts = Object.freeze([
  'speed',
  'duty',
  'batteryVoltage',
  'elevation',
  'currentCombined',
  'tempCombined',
]) as SelectedCharts;

const settings = new (class {
  /** whether the settings modal is open */
  open = $state(false);

  /** user selected units */
  units = $state(savedSettings?.units ?? Units.Metric);
  /** faults to hide from the map */
  hiddenFaults = $state<State[]>(
    savedSettings?.hiddenFaults ?? [State.Startup, State.StopHalf, State.Custom_OneFootpadAtSpeed],
  );

  /** user-defined cell count */
  cellCount = $state<number | undefined>(savedSettings?.batterySpecs.cellCount ?? undefined);
  /** user-defined cell min voltage */
  cellMinVolt = $state<number | undefined>(savedSettings?.batterySpecs.cellMinVolt ?? undefined);
  /** user-defined cell max voltage */
  cellMaxVolt = $state<number | undefined>(savedSettings?.batterySpecs.cellMaxVolt ?? undefined);

  /** user selected charts */
  charts = $state<SelectedCharts>(defaultSelectedCharts);

  /*
   * derived state
   */

  suggestedVMin = $derived(this.cellCount && this.cellMinVolt ? this.cellCount * this.cellMinVolt : undefined);
  suggestedVMax = $derived(this.cellCount && this.cellMaxVolt ? this.cellCount * this.cellMaxVolt : undefined);
  batterySpecs = $derived<ZBatterySpecs>({
    cellCount: this.cellCount,
    cellMinVolt: this.cellMinVolt,
    cellMaxVolt: this.cellMaxVolt,
  });

  /** serialised settings */
  storedSettings = $derived(
    JSON.stringify({
      batterySpecs: this.batterySpecs,
      hiddenFaults: this.hiddenFaults,
      units: this.units,
      charts: this.charts,
    } satisfies ZSavedSettings),
  );
})();

export default settings;
