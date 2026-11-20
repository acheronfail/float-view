<script lang="ts">
  import type { Snippet } from 'svelte';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import { navigationLink } from '$lib/ui/navigation-link';
  import { installUiErrorReporting } from '$lib/backend/ui-errors';
  import { createMotion, MOTION_CONTEXT } from '$lib/ui/motion';
  import { onMount, setContext, tick } from 'svelte';
  import { NAVIGATION_CONTEXT, NavigationContext } from './navigation-context';
  import { ApiRequestError } from '$lib/backend/client';
  import {
    UI_RESTORATION,
    UiRestoration,
    uiRoute,
    uiHref,
    resolveUiCheckpoint,
    uiDiagnostic,
  } from './ui-restoration.svelte';
  import { afterNavigate, beforeNavigate, onNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { backendState } from '$lib/backend/state.svelte';
  import SessionExportProgress from '$lib/features/sessions/SessionExportProgress.svelte';
  import SessionPruneProgress from '$lib/features/sessions/SessionPruneProgress.svelte';
  import { settingsCategory } from '$lib/features/settings/categories';
  import BottomTabBar from './BottomTabBar.svelte';
  import { installHostLayout } from './host-layout';
  import SafetyDisclaimer from './SafetyDisclaimer.svelte';
  import { bottomTabForRoute } from './navigation';
  import { APP_HEADER_CONTEXT, type AppHeaderConfig, type AppHeaderContext, type AppHeaderPatch } from './header';
  import PageHeader from '$lib/ui/PageHeader.svelte';
  import { browserThemeEnvironment, ThemeController } from './theme';
  import { connectionReturnHref, connectionRedirect } from './connection-navigation';
  import { dismissTopSurface, installBackNavigation } from '$lib/ui/back-dismissal';
  import { trackKeyboardNavigation } from './focus';
  import { publishHostBackNavigation } from './host-back-navigation';

  let { children }: { children: Snippet } = $props();
  let themeController = $state<ThemeController | undefined>(undefined);
  const restoration = new UiRestoration((checkpoint) => backendState.setUiCheckpoint(checkpoint));
  setContext(UI_RESTORATION, restoration);
  const navigationContext = new NavigationContext();
  setContext(NAVIGATION_CONTEXT, navigationContext);
  let routeContent = $state<HTMLElement>();
  let restoringPosition = $state(false);
  let positionGeneration = 0;
  let starting = $state(true);
  let safetyCleared = $state(false);
  onMount(() => installUiErrorReporting((error) => backendState.diagnosticRequest('diagnostics.uiError', error)));
  let safetyBusy = $state(false);
  let safetyError = $state('');

  async function acceptSafety() {
    if (safetyBusy) return;
    safetyBusy = true;
    safetyError = '';
    try {
      if (!(await backendState.updateSessionSettings({ safetyDisclaimerAccepted: true }))) {
        safetyError = 'Could not save your agreement. Please try again.';
        return;
      }
      await resume();
    } finally {
      safetyBusy = false;
    }
  }

  $effect(() => {
    // The early HTML placeholder also covers backend connection and screen restoration.
    const loading = document.getElementById('app-loading');
    if (loading) {
      loading.hidden = !starting;
      // Keep the shell's navigation available if screen restoration is slow.
      loading.style.zIndex = '1';
    }
  });
  let motionReady = $state(false);
  setContext(MOTION_CONTEXT, { enabled: () => motionReady });
  let nativeBackTransition = false;
  const motion = createMotion({ contentEnabled: () => !nativeBackTransition });
  $effect(() => {
    if (starting) {
      motionReady = false;
      return;
    }
    // Restored route and panels mount before motion is enabled.
    const frame = requestAnimationFrame(() => {
      motionReady = true;
    });
    return () => cancelAnimationFrame(frame);
  });
  let restoreNotice = $state('');
  let restoreError = $state('');
  const safetyGateOpen = $derived(!starting && !restoreError && !safetyCleared);
  let menuOpen = $state(false);
  let startupGeneration = 0;
  let restoringNavigation = false;
  let cancelledStartup = false;
  let presentationReady = Promise.resolve();
  afterNavigate(() => {
    const generation = ++positionGeneration;
    presentationReady = tick().then(() => {
      if (generation !== positionGeneration || !routeContent) return;
      return navigationContext.restore(page.url, routeContent).then(() => {
        if (generation === positionGeneration) restoringPosition = false;
      });
    });
    if (cancelledStartup) {
      cancelledStartup = false;
      starting = false;
    }
  });
  beforeNavigate((navigation) => {
    if (restoringNavigation) return;
    if (!safetyCleared) {
      navigation.cancel();
      return;
    }
    if (navigation.type === 'popstate' && dismissTopSurface()) {
      navigation.cancel();
      return;
    }
    menuOpen = false;
    if (starting || restoreError) {
      restoreError = '';
      starting = true;
      cancelledStartup = true;
      startupGeneration++;
      restoration.pending = null;
    }
  });
  onNavigate((navigation) => {
    if (navigation.from && routeContent && !starting && !restoringPosition)
      navigationContext.capture(navigation.from.url, routeContent);
    navigationContext.cancel();
    positionGeneration++;
    restoringPosition = !!navigation.to && navigationContext.has(navigation.to.url);
  });
  async function resume() {
    const generation = ++startupGeneration;
    starting = true;
    restoreError = '';
    try {
      if (backendState.status !== 'connected') await backendState.connect();
      if (backendState.status !== 'connected') throw new Error('Backend unavailable');
      if (!backendState.settings?.safetyDisclaimerAccepted) {
        if (generation === startupGeneration) starting = false;
        return;
      }
      safetyCleared = true;
      const saved = await backendState.getUiCheckpoint();
      if (generation !== startupGeneration) return;
      const incoming = window.location.hash;
      const restoreDestination =
        !incoming || incoming === '#/' || incoming === '#' || (saved && incoming === uiHref(saved.route));
      if (saved && restoreDestination && backendState.snapshot) {
        let checkpoint = resolveUiCheckpoint(saved, backendState.snapshot);
        try {
          await backendState.validateUiTarget(checkpoint.route, checkpoint.surface);
        } catch (error) {
          if (!(error instanceof ApiRequestError) || error.code !== 'not_found') throw error;
          backendState.error =
            checkpoint.surface?.kind === 'boardConfiguration'
              ? 'This board is no longer available.'
              : 'This session is no longer available.';
          if (checkpoint.route.kind !== 'live')
            checkpoint.route =
              checkpoint.route.kind === 'session' &&
              checkpoint.route.returnTo === 'boardHistory' &&
              checkpoint.route.savedDeviceId
                ? { kind: 'boardHistory', savedDeviceId: checkpoint.route.savedDeviceId }
                : { kind: 'sessions' };
          restoreNotice = backendState.error;
          checkpoint.surface = null;
        }
        if (generation !== startupGeneration) return;
        if (saved.surface && !checkpoint.surface)
          uiDiagnostic('surface_unavailable', checkpoint.route.kind, saved.surface.kind);
        if (backendState.snapshot) checkpoint = resolveUiCheckpoint(checkpoint, backendState.snapshot);
        restoration.pending = checkpoint;
        menuOpen = checkpoint.surface?.kind === 'liveActions' || checkpoint.surface?.kind === 'boardActions';
        restoringNavigation = true;
        try {
          await goto(uiHref(checkpoint.route), { replaceState: true });
        } finally {
          restoringNavigation = false;
        }
        uiDiagnostic('restored', checkpoint.route.kind, checkpoint.surface?.kind);
      }
      if (generation === startupGeneration) {
        safetyCleared = true;
        starting = false;
      }
    } catch {
      if (generation === startupGeneration) {
        restoreError =
          backendState.status !== 'connected'
            ? 'Could not connect to Float View. Try again. If the problem continues, close and reopen the app.'
            : 'Could not restore your last screen. Try again or choose a destination.';
        starting = false;
      }
    }
  }
  let appHeaderHeight = $state(0);
  let appHeaderButton = $state<HTMLButtonElement>();
  let headerRegistration = $state<{ owner: string; patch: AppHeaderPatch } | undefined>();
  const activeBottomTab = $derived(bottomTabForRoute(page.route.id));
  const liveRoute = $derived(page.route.id === '/live' || page.route.id === '/sessions/boards/[savedDeviceId]/views');

  const headerContext: AppHeaderContext = {
    set(owner, patch) {
      headerRegistration = { owner, patch };
    },
    clear(owner) {
      if (headerRegistration?.owner === owner) headerRegistration = undefined;
    },
    openMenu() {
      if (appHeader.menu?.length && !appHeader.menuUnavailable) menuOpen = true;
    },
    closeMenu() {
      menuOpen = false;
    },
    focusMenu() {
      appHeaderButton?.focus();
    },
  };
  setContext(APP_HEADER_CONTEXT, headerContext);

  const routeHeader = $derived.by((): AppHeaderConfig => {
    if (starting) return { title: 'Float View' };
    if (activeBottomTab) return activeBottomTab;

    switch (page.route.id) {
      case '/live':
        return { title: 'Live board', subtitle: 'Recovering connection…' };
      case '/bms':
        return { title: 'Battery management system', subtitle: 'Recovering connection…' };
      case '/settings/[category]':
        return {
          title: settingsCategory(page.params.category)?.title ?? 'Settings page',
          titleClass: 'text-xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-3xl',
          backHref: '#/settings',
          backLabel: 'Settings',
        };
      case '/settings/licences':
        return { title: 'Licences and notices', backHref: '#/settings/about', backLabel: 'About' };
      case '/sessions/[sessionId]':
        return { title: 'Session', backHref: '#/sessions', backLabel: 'Sessions' };
      case '/sessions/boards/[savedDeviceId]':
        return { title: 'Board', backHref: '#/sessions', backLabel: 'Sessions' };
      default:
        return { title: 'Float View' };
    }
  });
  const appHeader = $derived.by(
    (): AppHeaderConfig => ({
      ...routeHeader,
      ...(headerRegistration?.owner === page.route.id ? headerRegistration.patch : {}),
    })
  );
  const nestedBackAvailable = $derived(!starting && safetyCleared && !restoreError && !!appHeader.backHref);
  $effect(() => publishHostBackNavigation(nestedBackAvailable));

  onMount(() => {
    const stopHostLayout = installHostLayout();
    const stopKeyboardNavigation = trackKeyboardNavigation();
    const stopBackNavigation = installBackNavigation(
      (source, interactive) => {
        const href =
          appHeader.backHref ??
          (page.route.id === '/live' || page.route.id === '/bms'
            ? connectionReturnHref
            : page.route.id === '/settings'
              ? backendState.snapshot?.activeConnection
                ? connectionReturnHref
                : '#/'
              : page.route.id === '/sessions' && !backendState.snapshot?.activeConnection
                ? '#/'
                : null);
        if (!href) return false;
        const previous = page.url.href;
        nativeBackTransition = source === 'edge' && interactive;
        return goto(href)
          .then(async () => {
            if (page.url.href === previous) return false;
            await presentationReady;
            if (source === 'edge') {
              // Let restored DOM/scroll changes paint before the native backdrop starts revealing them.
              await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            }
            return true;
          })
          .finally(() => {
            nativeBackTransition = false;
          });
      },
      () => nestedBackAvailable
    );
    themeController = new ThemeController(browserThemeEnvironment());
    const stopTheme = themeController.start();
    const handleNativeImportStarted = () => {
      backendState.sessionImporting = true;
      backendState.error = null;
      void goto('#/sessions');
    };
    const handleNativeImport = (event: Event) => {
      backendState.sessionImporting = false;
      const sessionId = (event as CustomEvent<{ sessionId?: unknown }>).detail?.sessionId;
      if (typeof sessionId === 'string' && sessionId) {
        void backendState.sessionHref(sessionId).then((href) => goto(href));
      }
    };
    const handleNativeImportFailure = (event: Event) => {
      backendState.sessionImporting = false;
      const message = (event as CustomEvent<{ message?: unknown }>).detail?.message;
      backendState.error = typeof message === 'string' && message ? message : 'Session import failed';
    };
    window.addEventListener('floatview:session-import-started', handleNativeImportStarted);
    window.addEventListener('floatview:session-imported', handleNativeImport);
    window.addEventListener('floatview:session-import-failed', handleNativeImportFailure);
    const preference = backendState.settings?.themePreference;
    if (preference) themeController.reconcile(preference, backendState.settings!.accentPreference);
    void resume();
    return () => {
      stopHostLayout();
      stopKeyboardNavigation();
      stopBackNavigation();
      window.removeEventListener('floatview:session-import-started', handleNativeImportStarted);
      window.removeEventListener('floatview:session-imported', handleNativeImport);
      window.removeEventListener('floatview:session-import-failed', handleNativeImportFailure);
      stopTheme();
      themeController = undefined;
      startupGeneration++;
      restoration.dispose();
      navigationContext.cancel();
      backendState.close();
    };
  });

  $effect(() => {
    const preference = backendState.snapshot?.settings?.themePreference;
    if (!preference) return;
    themeController?.reconcile(preference, backendState.snapshot!.settings.accentPreference);
  });

  $effect(() => {
    if (starting || restoreError || !safetyCleared) return;
    const href = connectionRedirect(
      page.route.id,
      backendState.snapshot?.activeConnection,
      backendState.status === 'connected'
    );
    if (href) void goto(href, { replaceState: true });
  });
  $effect(() => {
    if (starting || restoreError || !safetyCleared || backendState.status !== 'connected') return;
    const route = uiRoute(page.route.id, page.params, page.url);
    if ((route.kind === 'live' || route.kind === 'boardHistory') && restoration.owner !== uiHref(route)) return;
    const surface = menuOpen
      ? route.kind === 'live'
        ? { kind: 'liveActions' as const }
        : route.kind === 'boardHistory'
          ? { kind: 'boardActions' as const }
          : null
      : restoration.owner === uiHref(route)
        ? restoration.surface
        : null;
    restoration.capture({ version: 1, route, live: route.kind === 'live' ? restoration.live : null, surface });
  });
</script>

<main
  inert={safetyGateOpen}
  class="app-shell bg-canvas text-foreground"
  class:min-h-screen={!liveRoute}
  class:h-screen={liveRoute}
  class:overflow-hidden={liveRoute}
  style={`--app-floating-controls-visibility: ${menuOpen ? 'hidden' : 'visible'}`}
>
  <div
    class="app-content app-safe-area mx-auto flex flex-col"
    class:min-h-screen={!liveRoute}
    class:h-full={liveRoute}
    class:min-h-0={liveRoute}
    class:max-w-3xl={!liveRoute}
    class:max-w-5xl={liveRoute}
    class:app-safe-area-with-tabs={activeBottomTab}
    class:app-safe-area-without-tabs={!activeBottomTab}
    style={`--app-header-height: ${appHeaderHeight}px`}
  >
    <PageHeader
      bind:button={appHeaderButton}
      bind:headerHeight={appHeaderHeight}
      headingId="app-title"
      title={appHeader.title}
      subtitle={appHeader.subtitle}
      subtitleSnippet={appHeader.subtitleSnippet}
      accessory={appHeader.accessory}
      subtitleClass={appHeader.subtitleClass}
      titleClass={appHeader.titleClass}
      bottomBorder={appHeader.bottomBorder}
      backHref={appHeader.backHref}
      backLabel={appHeader.backLabel}
      backInMenu={appHeader.backInMenu}
      menuLabel={appHeader.menu?.length ? appHeader.menuLabel : undefined}
      actions={appHeader.menu}
      menuPresentation={appHeader.menuPresentation}
      menuUnavailable={appHeader.menuUnavailable}
      menuWarning={appHeader.menuWarning}
      bind:menuOpen
    />

    <div
      data-route-content
      bind:this={routeContent}
      style:visibility={restoringPosition ? 'hidden' : undefined}
      use:motion.change={`${page.route.id}:${JSON.stringify(page.params)}`}
      class="flex flex-1 flex-col"
      class:min-h-0={liveRoute}
    >
      {#if !starting && restoreError}
        <section class="p-5">
          <p role="alert">{restoreError}</p>
          <button
            type="button"
            class="mt-3 touch-manipulation rounded-lg bg-elevated px-4 py-2"
            onpointerdown={(event) => activateFromPointer(event, resume)}
            onclick={(event) => activateFromKeyboardOrAssistiveClick(event, resume)}>Try again</button
          >
        </section>
      {:else if !starting && safetyCleared}
        {#if restoreNotice}<p role="status" class="p-3 text-muted">{restoreNotice}</p>{/if}
        <SessionPruneProgress
          operation={backendState.snapshot?.sessionOperation}
          oncancel={(operationId) => backendState.cancelSessionPrune(operationId)}
        />
        {#if !page.route.id?.startsWith('/settings') && (backendState.error || (backendState.snapshot?.activeConnection?.connectionIssue && !backendState.snapshot.activeConnection.connectionIssue.refloatCompatibility))}
          <p class="px-4 py-2 text-sm text-muted">
            If this problem persists, <a
              class="touch-manipulation text-accent underline"
              href="#/settings/help"
              use:navigationLink>export diagnostic logs in Settings</a
            >.
          </p>
        {/if}
        {@render children()}
      {/if}
    </div>
  </div>
  <SessionExportProgress />
  <BottomTabBar routeId={page.route.id} connection={backendState.snapshot?.activeConnection} />
</main>

{#if safetyGateOpen}
  <SafetyDisclaimer busy={safetyBusy} error={safetyError} onaccept={acceptSafety} />
{/if}

<style>
  .app-content:has(:global(.custom-dashboard)) {
    max-width: 100rem;
  }
</style>
