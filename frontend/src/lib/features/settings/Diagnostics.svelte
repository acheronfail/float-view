<script lang="ts">
  import { backendState } from '$lib/backend/state.svelte';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import SectionTitle from '$lib/ui/SectionTitle.svelte';

  let busy = $state(false);
  let error = $state('');

  async function exportDiagnostics() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await backendState.exportDiagnostics();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : 'Could not export diagnostics.';
    } finally {
      busy = false;
    }
  }
</script>

<section id="diagnostics" aria-label="Diagnostics" class="space-y-3">
  <SectionTitle title="Help with a problem" />
  <p class="text-sm text-muted">
    Save a troubleshooting file with configuration values, telemetry and protocol details. Device identifiers and
    locations are excluded. Nothing is sent automatically.
  </p>
  <button
    type="button"
    class="min-h-11 touch-manipulation rounded border border-outline bg-elevated px-3 py-2 text-foreground disabled:opacity-50"
    disabled={busy}
    onpointerdown={(e) => activateFromPointer(e, exportDiagnostics)}
    onclick={(e) => activateFromKeyboardOrAssistiveClick(e, exportDiagnostics)}
    >{busy ? 'Exporting…' : 'Export logs'}</button
  >
  <p class="text-sm text-muted">
    Check <a
      class="touch-manipulation text-accent underline"
      href="https://github.com/acheronfail/float-view/issues"
      target="_blank"
      rel="noreferrer">GitHub Issues</a
    > to see if someone has already reported the problem. If not, add a new report, explain what happened and attach the
    saved file. Anyone can see reports and attached files.
  </p>
  {#if error}<p role="alert" class="text-sm text-warning">{error}</p>{/if}
</section>
