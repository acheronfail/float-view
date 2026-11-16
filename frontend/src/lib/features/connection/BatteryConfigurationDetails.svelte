<script lang="ts">
  import type { ActiveConnection, BoardProfile } from '$lib/backend/contract';
  import { backendState } from '$lib/backend/state.svelte';
  import TelemetrySection from './TelemetrySection.svelte';

  let { connection }: { connection: ActiveConnection } = $props();
  let profile = $state<BoardProfile | null>(null);
  let failed = $state(false);
  const savedDeviceId = $derived(connection.deviceKind === 'board' ? connection.savedDeviceId : null);
  const revision = $derived(connection.batteryEstimate.profileRevision);
  $effect(() => {
    const id = savedDeviceId;
    // Refresh on configuration revisions, never on ordinary telemetry updates.
    void revision;
    profile = null;
    failed = false;
    let cancelled = false;
    if (id) {
      void backendState
        .readBoardProfile(id)
        .then((value) => {
          if (!cancelled) profile = value;
        })
        .catch(() => {
          if (!cancelled) failed = true;
        });
    }
    return () => {
      cancelled = true;
    };
  });
  const values = $derived(profile?.savedDeviceId === savedDeviceId ? profile?.values : undefined);
  const preset = $derived(backendState.snapshot?.batteryPresets.find((p) => p.id === values?.batteryPresetId));
  const cellProfile = $derived(
    backendState.snapshot?.batteryCellProfiles.find((p) => p.id === values?.batteryCellProfileId)
  );
</script>

<TelemetrySection
  title="Battery configuration"
  warningItems={values && connection.batteryEstimate.unavailableReason === 'series_mismatch'
    ? ['Saved pack configuration', 'Controller series cells']
    : []}
  items={[
    ['Selected battery', preset?.label ?? (values ? 'Custom / not selected' : 'Unavailable')],
    [
      'Saved pack configuration',
      values ? `${values.seriesCount ?? '—'}S${values.parallelCount ?? '—'}P` : 'Unavailable',
    ],
    ['Cell profile', cellProfile?.label ?? (values ? 'Not selected' : 'Unavailable')],
    [
      'Pack capacity',
      !values ? 'Unavailable' : values.batteryCapacityAh == null ? 'Not set' : `${values.batteryCapacityAh} Ah`,
    ],
    [
      'Controller series cells',
      connection.currentLimits?.batterySeriesCells == null
        ? 'Unavailable'
        : `${connection.currentLimits.batterySeriesCells}S`,
    ],
  ]}
  note={failed ? 'Could not load the saved battery configuration. Reopen the detailed view to retry.' : undefined}
/>
