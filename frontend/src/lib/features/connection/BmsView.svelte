<script lang="ts">
  import GaugeBar from './WidgetBar.svelte';
  import { colorForBattery, colorForTemperature } from './gauge-colors';
  import { onMount } from 'svelte';
  import type { BmsState, UnitPreference } from '$lib/backend/contract';
  import { formatTemperatureC } from '$lib/features/measurements/format';
  import { bmsFreshness, bmsRouteLabel } from './bms';

  let { bms, units }: { bms: BmsState; units: UnitPreference } = $props();
  let now = $state(Date.now());
  const snapshot = $derived(bms.latestSnapshot);
  const temperatureGroups = $derived.by(() => {
    if (!snapshot) return [];

    const { temperaturesC, dataVersion, icTemperatureC, highestCellTemperatureC, humiditySensorTemperatureC } =
      snapshot;
    const humiditySensor = { name: 'Humidity sensor', value: humiditySensorTemperatureC };

    // VBMS32 version 1 reports five fixed readings followed by the configured cell probes.
    // https://github.com/vedderb/vesc_pkg/blob/main/vbms32/vbms32.lisp#L624-L639
    if (dataVersion === 1 && temperaturesC.length >= 5) {
      const [ic, coldestCell, hottestCell, mosfets, ambient, ...cellProbes] = temperaturesC;
      return [
        {
          title: 'Battery cells',
          readings: [
            { name: 'Coldest cell probe', value: coldestCell },
            { name: 'Hottest cell probe', value: hottestCell },
            ...cellProbes.map((value, index) => ({ name: `Cell probe ${index + 1}`, value })),
          ],
        },
        {
          title: 'BMS and environment',
          readings: [
            { name: 'BMS chip', value: ic },
            { name: 'BMS MOSFETs', value: mosfets },
            { name: 'Ambient', value: ambient },
            humiditySensor,
          ],
        },
      ];
    }

    return [
      {
        title: null,
        readings: [
          ...temperaturesC.map((value, index) => ({ name: `Sensor ${index + 1}`, value })),
          { name: 'IC', value: icTemperatureC },
          { name: 'Highest cell', value: highestCellTemperatureC },
          humiditySensor,
        ],
      },
    ];
  });
  const candidates = $derived(
    [...bms.candidates].sort((left, right) => {
      if (left.connection.kind === 'direct') return right.connection.kind === 'direct' ? 0 : -1;
      if (right.connection.kind === 'direct') return 1;
      return left.connection.canId - right.connection.canId;
    })
  );

  onMount(() => {
    const timer = window.setInterval(() => (now = Date.now()), 1_000);
    return () => window.clearInterval(timer);
  });

  const number = (value: number | null | undefined, suffix: string, digits = 2) =>
    value == null ? '—' : `${value.toFixed(digits)} ${suffix}`;
</script>

<div class="grid gap-4 text-sm">
  <section class="grid grid-cols-2 gap-2 rounded-lg border border-outline bg-elevated p-3" aria-label="BMS status">
    <div>
      <span class="block text-muted">Status</span><strong class="capitalize">{bms.status.replace('_', ' ')}</strong>
    </div>
    <div><span class="block text-muted">Route</span><strong>{bmsRouteLabel(bms.connection)}</strong></div>
    <div class="col-span-2">
      <span class="block text-muted">Freshness</span>
      <strong>{snapshot ? bmsFreshness(snapshot.observedAt, now) : 'No values received'}</strong>
    </div>
  </section>

  {#if bms.status === 'ambiguous'}
    <section class="rounded-lg border border-warning/50 bg-warning/10 p-3" aria-label="Ambiguous BMS candidates">
      <h3 class="font-semibold">Choose a BMS route</h3>
      <p class="mt-1 text-muted">
        Set Preferred BMS CAN ID in Board configuration. Controller selection is unaffected.
      </p>
      <ul class="mt-2 grid gap-1">
        {#each candidates as candidate (bmsRouteLabel(candidate.connection))}
          <li>{bmsRouteLabel(candidate.connection)} · {candidate.hardwareName ?? 'VBMS'} · {candidate.vescVersion}</li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if bms.status === 'unavailable'}
    <p role="status" class="rounded-lg border border-warning/50 bg-warning/10 p-3">
      BMS readings are unavailable. Readings below may be out of date.
    </p>
  {/if}

  {#if snapshot}
    <section aria-labelledby="bms-summary-title">
      <h3 id="bms-summary-title" class="mb-2 font-semibold">Summary</h3>
      <dl class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div class="rounded border border-outline p-2">
          <dt class="text-muted">Pack</dt>
          <dd>{number(snapshot.totalVoltageV, 'V')}</dd>
        </div>
        <div class="rounded border border-outline p-2">
          <dt class="text-muted">Charge target</dt>
          <dd>{number(snapshot.chargeVoltageV, 'V')}</dd>
        </div>
        <div class="rounded border border-outline p-2">
          <dt class="text-muted">Input</dt>
          <dd>{number(snapshot.inputCurrentA, 'A')}</dd>
        </div>
        <div class="rounded border border-outline p-2">
          <dt class="text-muted">SoC / SoH</dt>
          <dd>{number(snapshot.stateOfCharge * 100, '%', 1)} / {number(snapshot.stateOfHealth * 100, '%', 1)}</dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="bms-cells-title">
      <h3 id="bms-cells-title" class="font-semibold">Cells and balancing</h3>
      <p class="mb-2 text-xs text-muted">Voltage scale: 3.0–4.2 V</p>
      <ol class="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {#each snapshot.cellVoltagesV as voltage, index (index)}
          <li class="min-w-0 rounded border border-outline p-2">
            <div class="mb-2 flex flex-wrap justify-between gap-x-2 gap-y-1 text-xs">
              <span class="text-muted">Cell {index + 1}</span>
              <span class="font-mono tabular-nums"
                >{voltage.toFixed(3)} V {snapshot.balancing[index] ? '· balancing' : ''}</span
              >
            </div>
            <GaugeBar
              value={Math.max(3, Math.min(4.2, voltage))}
              minimum={3}
              maximum={4.2}
              ariaLabel={`Cell ${index + 1} voltage`}
              ariaValueText={`${voltage.toFixed(3)} V${snapshot.balancing[index] ? ', balancing' : ''}`}
              showTicks={false}
              heightClass="h-2"
              fillClass="bg-[var(--cell-color)]"
              fillStyle={`--cell-color: ${colorForBattery(((voltage - 3) / 1.2) * 100)}`}
            />
          </li>
        {/each}
      </ol>
    </section>

    <section aria-labelledby="bms-temperature-title">
      <h3 id="bms-temperature-title" class="font-semibold">Temperatures</h3>
      <p class="mb-2 text-xs text-muted">Scale: {formatTemperatureC(0, units)}–{formatTemperatureC(100, units)}</p>
      <div class="space-y-3">
        {#each temperatureGroups as { title, readings } (title)}
          <div>
            {#if title}<h4 class="mb-1 text-xs font-semibold">{title}</h4>{/if}
            <ul class="grid grid-cols-2 gap-1 sm:grid-cols-3" aria-label={title ?? undefined}>
              {#each readings as { name, value } (name)}
                <!-- Missing BMS sensors report -300 °C. Check before converting units. -->
                {@const unavailable = value === -300 || !Number.isFinite(value)}
                {@const displayValue = unavailable ? 'Unavailable' : formatTemperatureC(value, units)}
                <li class="min-w-0 rounded border border-outline p-2" class:opacity-50={unavailable}>
                  <div class="mb-2 flex flex-wrap justify-between gap-x-2 gap-y-1 text-xs">
                    <span class="text-muted">{name}:</span>
                    <span class="font-mono tabular-nums" class:text-muted={unavailable}>{displayValue}</span>
                  </div>
                  <GaugeBar
                    value={unavailable ? null : Math.max(0, Math.min(100, value))}
                    maximum={100}
                    ariaLabel={`${name} temperature`}
                    ariaValueText={displayValue}
                    showTicks={false}
                    heightClass="h-2"
                    fillClass="bg-linear-to-r from-green-600 to-[var(--temperature-color)]"
                    fillStyle={`--temperature-color: ${colorForTemperature(unavailable ? null : value)}`}
                  />
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    </section>

    <section aria-labelledby="bms-detail-title">
      <h3 id="bms-detail-title" class="mb-2 font-semibold">Environment and counters</h3>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt class="text-muted">IC current</dt>
        <dd>{number(snapshot.inputIcCurrentA, 'A')}</dd>
        <dt class="text-muted">Humidity</dt>
        <dd>{number(snapshot.humidityPercent, '%', 1)}</dd>
        <dt class="text-muted">Pressure</dt>
        <dd>{number(snapshot.pressurePa / 1000, 'kPa', 1)}</dd>
        <dt class="text-muted">Session</dt>
        <dd>{number(snapshot.sessionAmpHoursAh, 'Ah')} · {number(snapshot.sessionWattHoursWh, 'Wh')}</dd>
        <dt class="text-muted">Lifetime charge</dt>
        <dd>{number(snapshot.lifetimeChargeAmpHoursAh, 'Ah')} · {number(snapshot.lifetimeChargeWattHoursWh, 'Wh')}</dd>
        <dt class="text-muted">Lifetime discharge</dt>
        <dd>
          {number(snapshot.lifetimeDischargeAmpHoursAh, 'Ah')} · {number(snapshot.lifetimeDischargeWattHoursWh, 'Wh')}
        </dd>
        <dt class="text-muted">Reported CAN ID</dt>
        <dd>{snapshot.reportedCanId}</dd>
        <dt class="text-muted">Data version</dt>
        <dd>{snapshot.dataVersion ?? 'Legacy'}</dd>
        <dt class="text-muted">BMS status</dt>
        <dd>{snapshot.status ?? '—'}</dd>
      </dl>
    </section>
  {:else if bms.status !== 'ambiguous'}
    <p class="text-muted">BMS values will appear after the selected route responds.</p>
  {/if}
</div>
