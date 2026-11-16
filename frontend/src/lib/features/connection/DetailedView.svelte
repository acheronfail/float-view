<script lang="ts">
  import { backendState } from '$lib/backend/state.svelte';
  import { formatDistanceM, formatSpeedKph, formatTemperatureC } from '$lib/features/measurements/format';
  import { batteryPresentation } from './battery';
  import { beepReasonLabel, stopReasonLabel } from './live-status';
  import BatteryConfigurationDetails from './BatteryConfigurationDetails.svelte';
  import BatterySetupWarning from './BatterySetupWarning.svelte';
  let { onconfigure, charging = false }: { onconfigure?: (trigger: HTMLButtonElement) => void; charging?: boolean } =
    $props();
  import TelemetrySection from './TelemetrySection.svelte';
  import { controllerRouteDescription, firmwareAccessDescription, readingsAreDimmed } from './live';
  import {
    currentTelemetryFields,
    extensionTelemetry,
    slowTelemetryAge,
    telemetryFlag,
    telemetryState,
  } from './telemetry';

  const connection = $derived(backendState.snapshot?.activeConnection);
  const battery = $derived(
    batteryPresentation(
      connection?.batteryEstimate,
      connection?.latestSample?.batteryLevel,
      !!connection?.savedDeviceId && connection?.deviceKind === 'board'
    )
  );
  const batteryPercent = $derived(battery.percent);
  const sample = $derived(connection?.latestSample);
  const session = $derived(connection?.activeSession);
  const location = $derived(connection?.latestLocation);
  const units = $derived(backendState.settings?.unitPreference ?? 'metric');
  const dimmed = $derived(connection ? readingsAreDimmed(connection) : false);
  const routeDescription = $derived(controllerRouteDescription(connection?.controllerConnection ?? null));

  function number(value: number | null | undefined, digits = 1) {
    return value == null ? '—' : value.toFixed(digits);
  }

  function measured(value: number | null | undefined, unit: string, digits = 1) {
    return value == null ? 'Unavailable' : `${number(value, digits)} ${unit}`;
  }

  function scalar(value: number | null | undefined, digits = 1) {
    return value == null ? 'Unavailable' : number(value, digits);
  }

  function speed(value: number | null | undefined) {
    return formatSpeedKph(value, units);
  }

  function temperature(value: number | null | undefined) {
    return formatTemperatureC(value, units);
  }

  function distance(value: number | null | undefined) {
    return formatDistanceM(value, units);
  }

  function duration(value: number | null | undefined) {
    if (value == null) return '—';
    const seconds = Math.floor(value / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  }

  function coordinate(value: number | null | undefined) {
    return value == null ? 'Unavailable' : value.toFixed(6);
  }
</script>

{#if connection}
  <section
    aria-label="Detailed board telemetry"
    class:opacity-45={dimmed}
    class="detailed-telemetry motion-feedback space-y-4 transition-opacity motion-reduce:transition-none"
  >
    <TelemetrySection
      title="Board state"
      note="The board retains the last reported beep reason after the beep ends."
      items={[
        ['Ride state', telemetryState(sample?.rideState)],
        ['Package state', telemetryState(sample?.packageState)],
        ['Package mode', telemetryState(sample?.packageMode)],
        ['Footpad', telemetryState(sample?.footpadState)],
        ['Wheelslip', telemetryFlag(sample?.wheelslip)],
        ['Darkride', telemetryFlag(sample?.darkride)],
        ['Charging', telemetryFlag(charging)],
        ['Refloat charging', telemetryFlag(sample?.charging)],
        ['Last stop reason', stopReasonLabel(sample?.stopCondition)],
        ['Setpoint adjustment / pushback', telemetryState(sample?.setpointAdjustment)],
        ['Last reported beep reason', beepReasonLabel(sample?.alertReason)],
        ['Fatal error latched', telemetryFlag(sample?.fatalErrorLatched)],
        [
          'Last firmware fault',
          sample?.lastFirmwareFault
            ? `${telemetryState(sample.lastFirmwareFault.reason)} (code ${sample.lastFirmwareFault.code})`
            : 'Unavailable',
        ],
        [
          'Active firmware fault',
          sample ? (sample.firmwareFault ? telemetryState(sample.firmwareFault) : 'None') : 'Unavailable',
        ],
        ['Ride time', duration(sample?.ridingElapsedMs)],
      ] as [string, string][]}
    />
    <TelemetrySection
      title="Motion"
      items={[
        ['Speed', speed(sample?.speedKph)],
        ['ERPM', sample?.erpm == null ? 'Unavailable' : Math.round(sample.erpm).toLocaleString()],
        ['Pitch', measured(sample?.pitchDeg, '°')],
        ['Balance pitch', measured(sample?.balancePitchDeg, '°')],
        ['Roll', measured(sample?.rollDeg, '°')],
      ] as [string, string][]}
    />
    <TelemetrySection
      title="Raw electrical load"
      items={[
        ['Pack voltage', measured(sample?.packVoltageV, 'V', 2)],
        ['Duty ratio', scalar(sample?.dutyCycle, 3)],
        ...currentTelemetryFields.map(({ key, label }) => [
          label,
          measured(sample?.[key] as number | null | undefined, 'A'),
        ]),
      ] as [string, string][]}
    />
    <TelemetrySection
      title="Temperatures"
      items={[
        ['Controller', temperature(sample?.controllerTempC)],
        ['Motor', temperature(sample?.motorTempC)],
      ] as [string, string][]}
    />
    <TelemetrySection
      title="Location"
      items={[
        ['GPS accuracy', measured(location?.accuracyM, 'm', 1)],
        ['Latitude', coordinate(location?.latitude)],
        ['Longitude', coordinate(location?.longitude)],
      ] as [string, string][]}
    />
    <TelemetrySection
      title="Rider input"
      items={[
        ['Footpad ADC 1', measured(sample?.footpadAdc1V, 'V', 2)],
        ['Footpad ADC 2', measured(sample?.footpadAdc2V, 'V', 2)],
        ['Remote input', scalar(sample?.remoteInput, 3)],
      ] as [string, string][]}
    />
    <TelemetrySection
      title="Control contributions"
      items={[
        ['Final setpoint', measured(sample?.setpointDeg, '°')],
        ['ATR setpoint', measured(sample?.atrSetpointDeg, '°')],
        ['Brake-tilt setpoint', measured(sample?.brakeTiltSetpointDeg, '°')],
        ['Torque-tilt setpoint', measured(sample?.torqueTiltSetpointDeg, '°')],
        ['Turn-tilt setpoint', measured(sample?.turnTiltSetpointDeg, '°')],
        ['Remote setpoint', measured(sample?.remoteSetpointDeg, '°')],
        ['ATR acceleration difference', measured(sample?.atrAccelerationDifferenceErpmPerSecond, 'ERPM/s', 0)],
        ['ATR speed boost', scalar(sample?.atrSpeedBoost, 3)],
      ] as [string, string][]}
    />
    <BatteryConfigurationDetails {connection} />
    <TelemetrySection
      title="Battery charge"
      items={[[battery.label, batteryPercent == null ? 'Unavailable' : `${batteryPercent}%`]]}
    >
      {#snippet accessory()}
        {#if battery.needsSetup && onconfigure}<BatterySetupWarning {onconfigure} />{/if}
      {/snippet}
      {#if connection.batteryEstimate.method}
        <p class="px-2 text-xs leading-5 text-muted" aria-label="Battery estimation method">
          Estimated battery charge.
          {#if connection.batteryEstimate.provisional}Waiting for stable readings…{/if}
        </p>
      {/if}
    </TelemetrySection>
    <TelemetrySection
      title="Accumulated and charging"
      items={[
        ['Ride distance', distance(sample?.distanceM)],
        ['Odometer', distance(sample?.odometerM)],
        ['Amp-hours drawn', measured(sample?.ampHoursDrawnAh, 'Ah', 2)],
        ['Amp-hours charged', measured(sample?.ampHoursChargedAh, 'Ah', 2)],
        ['Watt-hours drawn', measured(sample?.wattHoursDrawnWh, 'Wh', 1)],
        ['Watt-hours charged', measured(sample?.wattHoursChargedWh, 'Wh', 1)],
        [
          'Controller-reported battery level',
          sample?.batteryLevel == null ? 'Unavailable' : `${number(sample.batteryLevel * 100, 0)}%`,
        ],
        ['Charging current', measured(sample?.chargingCurrentA, 'A')],
        ['Charging voltage', measured(sample?.chargingVoltageV, 'V', 2)],
      ] as [string, string][]}
    />
    <TelemetrySection
      title="Source availability"
      items={[
        ['Realtime sample', sample?.observedAt ?? 'Unavailable'],
        ['Compact values', slowTelemetryAge(sample)],
        ['Negotiated extensions', sample ? Object.keys(sample.extensions).length.toString() : 'Unavailable'],
        ...extensionTelemetry(sample),
      ] as [string, string][]}
    />
    <TelemetrySection
      title="Active session"
      items={[
        ['Samples', session?.sampleCount.toLocaleString() ?? '—'],
        ['Ride time', duration(session?.ridingElapsedMs)],
        ['Total time', duration(session?.totalElapsedMs)],
        ['Distance', distance(session?.distanceM)],
        ['Max speed', session?.maxSpeedMps == null ? '—' : speed(session.maxSpeedMps * 3.6)],
        ['Max duty', session?.maxDutyCycle == null ? '—' : `${number(session.maxDutyCycle * 100)}%`],
      ] as [string, string][]}
    />
    <TelemetrySection
      title={connection.controllerConnection?.kind === 'can' ? 'Motor controller firmware' : 'Firmware'}
      items={[
        ['Connection', routeDescription],
        ['Hardware', connection.firmware?.hardwareName ?? '—'],
        ['VESC', connection.firmware?.vescVersion ?? '—'],
        [
          'Package',
          connection.firmware ? `${connection.firmware.packageName} ${connection.firmware.packageVersion}` : '—',
        ],
        ['Access', firmwareAccessDescription(connection.firmware)],
      ] as [string, string][]}
    />
    {#if connection.controllerConnection?.kind === 'can' && connection.transportFirmware}
      <TelemetrySection
        title="Bluetooth gateway"
        items={[
          ['Hardware', connection.transportFirmware.hardwareName ?? '—'],
          ['Firmware name', connection.transportFirmware.firmwareName ?? '—'],
          ['VESC', connection.transportFirmware.vescVersion],
          [
            'Release',
            connection.transportFirmware.testVersion === 0
              ? 'Stable'
              : `Test version ${connection.transportFirmware.testVersion}`,
          ],
        ] as [string, string][]}
      />
    {/if}
  </section>
{:else}
  <p class="text-muted">Recovering active connection…</p>
{/if}
