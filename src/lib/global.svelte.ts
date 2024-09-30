import { speedMapper } from './misc';
import { Units } from './parse/types';
import settings from './settings.svelte';

export const globalState = new (class {
  unitsFromData = $state(Units.Metric);
  mapSpeed = $derived(speedMapper(this.unitsFromData, settings.units));
})();
