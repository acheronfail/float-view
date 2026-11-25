<script lang="ts">
  import { navigationLink } from '$lib/ui/navigation-link';
  import SectionTitle from '$lib/ui/SectionTitle.svelte';

  const revision = __FLOAT_VIEW_BUILD_INFO__.revision;
  const source =
    revision && /^[0-9a-f]{7,40}$/.test(revision)
      ? `https://github.com/acheronfail/float-view/tree/${revision}`
      : 'https://github.com/acheronfail/float-view';
</script>

<section aria-label="Open source and licences">
  <SectionTitle title="Open source and licences" />
  <div class="mt-3 space-y-3 text-sm text-muted">
    <p>Float View is open source under AGPL-3.0-or-later.</p>
    <p>Copyright © 2025 acheronfail.</p>
    <p>
      <a
        class="touch-manipulation text-accent underline"
        href="https://github.com/acheronfail/float-view/blob/master/PRIVACY.md"
        target="_blank"
        rel="noreferrer">Privacy policy</a
      >
      ·
      <a
        class="touch-manipulation text-accent underline"
        href="https://github.com/acheronfail/float-view/issues"
        target="_blank"
        rel="noreferrer">Support</a
      >
    </p>
    <p>
      Rider artwork adapted from “onewheel” by Luis Prado, Noun Project, under CC BY 3.0. Colours, backgrounds and
      formats have been adapted for Float View.
    </p>
    <a class="inline-block touch-manipulation text-accent underline" href={source} target="_blank" rel="noreferrer">
      Source code and build instructions
    </a>
    <a
      class="flex min-h-11 touch-manipulation items-center justify-center rounded-lg border border-outline bg-elevated px-3 py-2 text-center text-foreground"
      href="#/settings/licences"
      use:navigationLink>View licences and notices</a
    >
  </div>
</section>
