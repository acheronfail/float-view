import { z } from 'zod';
import { State } from './FloatControlTypes';

const BatterySpecsSchema = z.object({
  cellCount: z.number().nullish(),
  cellMinVolt: z.number().nullish(),
  cellMaxVolt: z.number().nullish(),
});
export type ZBatterySpecs = z.infer<typeof BatterySpecsSchema>;

const HiddenFaultSchema = z.nativeEnum(State).array();

const SavedSettingsSchema = z.object({
  batterySpecs: BatterySpecsSchema,
  hiddenFaults: HiddenFaultSchema,
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

const settings = new (class {
  open = $state(false);

  hiddenFaults = $state<State[]>(
    savedSettings?.hiddenFaults ?? [State.Startup, State.StopHalf, State.Custom_OneFootpadAtSpeed],
  );

  cellCount = $state<number | undefined>(savedSettings?.batterySpecs.cellCount ?? undefined);
  cellMinVolt = $state<number | undefined>(savedSettings?.batterySpecs.cellMinVolt ?? undefined);
  cellMaxVolt = $state<number | undefined>(savedSettings?.batterySpecs.cellMaxVolt ?? undefined);

  suggestedVMin = $derived(this.cellCount && this.cellMinVolt ? this.cellCount * this.cellMinVolt : undefined);
  suggestedVMax = $derived(this.cellCount && this.cellMaxVolt ? this.cellCount * this.cellMaxVolt : undefined);
  batterySpecs = $derived<ZBatterySpecs>({
    cellCount: this.cellCount,
    cellMinVolt: this.cellMinVolt,
    cellMaxVolt: this.cellMaxVolt,
  });

  storedSettings = $derived(
    JSON.stringify({
      batterySpecs: this.batterySpecs,
      hiddenFaults: this.hiddenFaults,
    } satisfies ZSavedSettings),
  );
})();

export default settings;
