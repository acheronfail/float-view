<script lang="ts">
  import './widget-title.css';
  import { prefersReducedMotion, Tween } from 'svelte/motion';
  import type { BmsState, LiveSample, LiveWidgetField, UnitPreference } from '$lib/backend/contract';
  import {
    liveValue,
    liveValueColor,
    liveValueText,
    liveValueStatus,
    liveValueCatalog,
    type LocationElevation,
  } from './live-values';

  let {
    field,
    sample,
    units,
    estimatedLevel,

    bms,
    nowMs,
    location,
    prominent = false,
    compact = false,
    inheritColor = false,
  }: {
    field: LiveWidgetField;
    sample: LiveSample | null | undefined;
    units: UnitPreference;
    estimatedLevel?: number | null;

    bms?: BmsState | null;
    nowMs?: number;
    location?: LocationElevation | null;
    prominent?: boolean;
    compact?: boolean;
    inheritColor?: boolean;
  } = $props();
  const reading = $derived(
    liveValue(
      field,
      sample,
      units,
      estimatedLevel,
      bms,
      field === 'altitudeM' ? nowMs : Math.max(nowMs ?? 0, Date.now()),
      location
    )
  );
  const animated = new Tween(0);
  // These cumulative readings arrive about once a second. Spread their changes
  // across that interval; instantaneous readings retain the short transition.
  const cumulative = $derived(
    [
      'wattHoursDrawnWh',
      'wattHoursChargedWh',
      'wattHoursNetWh',
      'ampHoursDrawnAh',
      'ampHoursChargedAh',
      'ampHoursNetAh',
      'odometerM',
      'altitudeM',
    ].includes(field)
  );
  let previousIdentity: string | undefined;
  let previousAvailable = false;
  let previousValue: number | null = null;
  $effect(() => {
    const identity = `${field}:${units}:${reading.label}`;
    const immediate =
      prefersReducedMotion.current || previousIdentity !== identity || !previousAvailable || reading.value == null;
    // Fast snapshots repeat the cached slow counters. Restarting their tween on
    // each snapshot would turn a one-second transition into an endless chase.
    if (cumulative && !immediate && reading.value === previousValue) return;
    void animated.set(reading.value ?? 0, {
      duration: immediate ? 0 : cumulative ? 1000 : 150,
    });
    previousIdentity = identity;
    previousAvailable = reading.value != null;
    previousValue = reading.value;
  });
  const value = $derived(reading.value == null ? null : animated.current);
  const text = $derived(liveValueText(field, value, reading.digits));
  const fontWidth = $derived(100 / Math.max(1, 0.62 * (text.length + reading.unit.length * 0.7) + 0.4));
  const label = $derived(
    field === 'powerW' && value != null && Math.round(value) !== 0
      ? Math.round(value) > 0
        ? 'Draw'
        : 'Regen'
      : reading.label
  );
</script>

<div class="[container-type:inline-size] w-full text-center">
  <div class="live-widget-title" title={liveValueCatalog[field].name}>
    {label}
  </div>
  <div
    class={`font-mono font-semibold whitespace-nowrap tabular-nums ${prominent || compact ? 'leading-tight' : ''} ${inheritColor ? '' : liveValueColor(field, value, sample, units)}`}
    style:font-size={`min(${prominent ? (compact ? '1.125rem' : inheritColor ? 'var(--reading-font-cap, 4rem)' : '4rem') : '0.875rem'}, ${fontWidth}cqi)`}
  >
    <span class="sr-only">{liveValueStatus(field, sample)} </span>{text}<span class="ml-0.5 text-[0.7em] font-normal"
      >{reading.unit}</span
    >
  </div>
</div>
