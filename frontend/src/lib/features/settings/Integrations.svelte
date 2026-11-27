<script lang="ts">
  import { backendState } from '$lib/backend/state.svelte';
  import HermesMark from '$lib/features/integrations/HermesMark.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import { activateFromKeyboardOrAssistiveClick, activateFromPointer } from '$lib/ui/activation';

  let pending = $state(false);
  let signOutOpen = $state(false);
  let error = $state<string | null>(null);
  const hermes = $derived(backendState.snapshot?.hermes);
  const linked = $derived(hermes?.status === 'linked');
  const busy = $derived(pending || hermes?.status === 'loading' || hermes?.status === 'signingIn');

  async function changeAccount(signingOut: boolean) {
    if (busy) return;
    error = null;
    pending = true;
    try {
      await backendState.hermesAccount(signingOut ? 'hermes.disconnect' : 'hermes.signIn');
      signOutOpen = false;
    } catch {
      error = signingOut ? 'Could not sign out of Ride Hermes. Try again.' : 'Could not start Ride Hermes sign-in.';
    } finally {
      pending = false;
    }
  }

  function activate() {
    if (linked) {
      error = null;
      signOutOpen = true;
    } else {
      void changeAccount(false);
    }
  }
</script>

<section
  aria-labelledby="hermes-integration-name"
  class="overflow-hidden rounded-2xl border border-violet-500/30 bg-surface"
>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-4 bg-linear-to-br from-violet-500/12 to-transparent p-4">
    <HermesMark class="size-12" />
    <div class="min-w-28 flex-1">
      <h2 id="hermes-integration-name" class="text-base font-semibold text-foreground">Ride Hermes</h2>
      {#if linked}
        <p class="mt-0.5 text-xs leading-5 break-words text-muted">
          Signed in as <strong class="font-medium text-foreground">{hermes?.account}</strong>.
        </p>
      {:else if hermes?.status === 'unavailable'}
        <p class="mt-0.5 text-xs leading-5 text-muted">Ride uploads are unavailable in this build.</p>
      {:else}
        <p class="mt-0.5 text-xs leading-5 text-muted">Upload rides from your session history.</p>
      {/if}
    </div>
    {#if hermes && hermes.status !== 'unavailable'}
      <button
        type="button"
        class={[
          'inline-flex min-h-11 shrink-0 touch-manipulation items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60',
          linked
            ? 'border border-outline bg-surface text-foreground hover:bg-elevated'
            : 'bg-[#6a3ab7] text-white hover:bg-[#582c9e]',
        ]}
        aria-label={busy ? undefined : linked ? 'Sign out' : 'Sign in to Ride Hermes'}
        disabled={busy}
        onpointerdown={(event) => activateFromPointer(event, activate)}
        onclick={(event) => activateFromKeyboardOrAssistiveClick(event, activate)}
      >
        {#if busy}<Icon name="loader-circle" class="size-4 animate-spin motion-reduce:animate-none" />{/if}
        {linked ? 'Sign out' : hermes.status === 'loading' ? 'Loading…' : busy ? 'Signing in…' : 'Sign in'}
      </button>
    {/if}
  </div>
  {#if (error && !signOutOpen) || hermes?.message}
    <p role="alert" class="border-t border-outline px-4 py-3 text-sm leading-5 text-warning">
      {(!signOutOpen && error) || hermes?.message}
    </p>
  {/if}
</section>

<ConfirmDialog
  open={signOutOpen && linked}
  titleId="sign-out-hermes-title"
  title="Sign out of Ride Hermes?"
  description="You’ll need to sign in again to upload rides. Rides you’ve already uploaded will stay in Ride Hermes."
  confirmLabel="Sign out"
  appearance="destructive"
  busy={pending}
  {error}
  onconfirm={() => changeAccount(true)}
  oncancel={() => {
    signOutOpen = false;
  }}
>
  {#snippet leading()}<HermesMark class="size-10" />{/snippet}
</ConfirmDialog>
