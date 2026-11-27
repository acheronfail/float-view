<script lang="ts">
  import type { HermesRideStatus } from '$lib/backend/contract';
  import { backendState } from '$lib/backend/state.svelte';
  import HermesMark from '$lib/features/integrations/HermesMark.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import { activateFromKeyboardOrAssistiveClick, activateFromPointer } from '$lib/ui/activation';

  let { sessionId, onclose }: { sessionId: string; onclose: () => void } = $props();
  let details = $state<HermesRideStatus | null>(null);
  let statusError = $state(false);
  let rejection = $state<string | null>(null);
  let submitting = $state(false);
  let refresh = $state(0);

  const account = $derived(backendState.snapshot?.hermes);
  const linked = $derived(account?.status === 'linked');
  const current = $derived(linked && details?.generation === account?.generation ? details : null);
  const uncertain = $derived(current?.status === 'uncertain');
  const confirmed = $derived(current?.status === 'confirmed');
  const sending = $derived(current?.status === 'sending');
  const blocked = $derived(rejection ?? current?.reason);
  const rideTime = $derived.by(() => {
    const session = backendState.selectedSession;
    if (session?.sessionId !== sessionId) return null;
    const start = new Date(session.startedAt);
    return Number.isFinite(start.getTime())
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(start)
      : null;
  });

  const title = $derived.by(() => {
    if (statusError) return 'Upload status unavailable';
    if (confirmed) return 'Ride uploaded';
    if (submitting || sending) return 'Uploading ride…';
    if (blocked) return 'Ride can’t be uploaded';
    if (uncertain) return 'Check your Ride Hermes history';
    return 'Upload to Ride Hermes';
  });
  const description = $derived.by(() => {
    if (!linked) return 'Sign in to Ride Hermes again from Settings → Integrations.';
    if (statusError) return 'We couldn’t check the upload status. Check again before sending this ride.';
    if (confirmed) return 'Ride Hermes accepted this ride.';
    if (submitting || sending) return 'You can check the result from Session actions.';
    if (blocked) return blocked;
    if (uncertain)
      return 'We couldn’t confirm your last upload. Check your Ride Hermes history for this ride before retrying to avoid a duplicate.';
    if (!current) return 'Checking this ride…';
    if (current.status === 'failed')
      return 'Ride Hermes declined the previous upload. Review what you’ll share before trying again.';
    return 'Review what will be shared with Ride Hermes.';
  });

  $effect(() => {
    const id = sessionId;
    const generation = account?.generation;
    if (!linked) return;
    void refresh;
    let keep = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const result = await backendState.hermesRide(id);
        if (!keep || result.generation !== generation) return;
        details = result;
        statusError = false;
        if (result.status === 'sending') timer = setTimeout(read, 750);
      } catch {
        if (keep) statusError = true;
      }
    }
    void read();
    return () => {
      keep = false;
      clearTimeout(timer);
    };
  });

  function checkStatus() {
    details = null;
    statusError = false;
    refresh++;
  }

  async function upload() {
    if (!current || submitting) return;
    submitting = true;
    rejection = null;
    try {
      const result = await backendState.uploadHermesRide(sessionId, current.revision, current.generation, uncertain);
      if (!result.accepted) rejection = result.reason;
    } catch {
      statusError = true;
    } finally {
      submitting = false;
      refresh++;
    }
  }
</script>

<ConfirmDialog
  open
  titleId="session-hermes-upload-title"
  {title}
  {description}
  busy={submitting}
  showConfirm={!!current && !statusError && !blocked && !sending && !confirmed}
  confirmLabel={uncertain ? 'Retry upload' : 'Upload ride'}
  cancelLabel={current?.status === 'ready' && !blocked && !statusError ? 'Cancel' : 'Close'}
  onconfirm={upload}
  oncancel={onclose}
>
  {#snippet leading()}
    {#if confirmed}
      <span
        class="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-on-accent-soft"
      >
        <Icon name="check" class="size-5" />
      </span>
    {:else if submitting || sending}
      <span
        class="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-on-accent-soft"
      >
        <Icon name="loader-circle" class="size-5 animate-spin motion-reduce:animate-none" />
      </span>
    {:else}
      <HermesMark class="size-10" />
    {/if}
  {/snippet}
  {#if linked && statusError}
    <button
      type="button"
      class="min-h-11 touch-manipulation rounded-lg border border-outline px-3 text-sm font-medium"
      onpointerdown={(event) => activateFromPointer(event, checkStatus)}
      onclick={(event) => activateFromKeyboardOrAssistiveClick(event, checkStatus)}>Check status</button
    >
  {:else if uncertain && !submitting && !blocked}
    <div class="space-y-3">
      {#if rideTime}<p class="text-sm font-medium text-foreground">{rideTime}</p>{/if}
      <a
        href="https://ridehermes.app/"
        target="_blank"
        rel="noreferrer"
        class="inline-flex min-h-11 touch-manipulation items-center gap-2 rounded-xl border border-outline px-3 text-sm font-semibold text-accent hover:bg-elevated"
        >Open Ride Hermes <Icon name="arrow-up-right" class="size-4" /></a
      >
    </div>
  {:else if linked && current && !submitting && !sending && !confirmed && !blocked}
    <dl class="space-y-3 rounded-xl border border-outline bg-elevated px-3 py-3 text-sm">
      <div>
        <dt class="text-xs text-muted">Uploading to</dt>
        <dd class="mt-0.5 font-semibold break-all text-foreground">{account?.account}</dd>
      </div>
      <div class="border-t border-outline pt-2">
        <dt class="text-xs text-muted">Ride data shared</dt>
        <dd class="mt-0.5 leading-5 text-foreground">
          GPS route, ride times, distance, board speed, elevation and location accuracy
        </dd>
      </div>
    </dl>
  {/if}
</ConfirmDialog>
