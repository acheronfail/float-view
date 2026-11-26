<script lang="ts">
  import { backendState } from '$lib/backend/state.svelte';
  import { settingsCategory } from './categories';
  import RideRecording from './RideRecording.svelte';
  import Announcements from './Announcements.svelte';
  import ConnectionSettings from './ConnectionSettings.svelte';
  import DataSettings from './DataSettings.svelte';
  import Diagnostics from './Diagnostics.svelte';
  import AboutSettings from './AboutSettings.svelte';
  let { category }: { category: string } = $props();
</script>

<section aria-label="Settings" class="space-y-6 py-4">
  {#if !settingsCategory(category)}
    <p class="text-muted">This settings page is unavailable. Return to Settings to choose a category.</p>
  {:else if !backendState.settings}
    <p class="text-muted">Loading settings…</p>
  {:else}
    {#key category}
      {#if category === 'recording'}<RideRecording />
      {:else if category === 'announcements'}<Announcements />
      {:else if category === 'connection'}<ConnectionSettings />
      {:else if category === 'data'}<DataSettings />
      {:else if category === 'help'}<Diagnostics />
      {:else if category === 'about'}<AboutSettings />{/if}
    {/key}
  {/if}
  {#if backendState.error}<p role="alert" class="text-warning">{backendState.error}</p>{/if}
</section>
