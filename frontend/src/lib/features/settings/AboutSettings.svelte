<script lang="ts">
  import SectionTitle from '$lib/ui/SectionTitle.svelte';
  import LegalNotices from './LegalNotices.svelte';
  const buildInfo = __FLOAT_VIEW_BUILD_INFO__;
</script>

{#if buildInfo.showRevision && buildInfo.revision}
  <section class="space-y-2">
    <SectionTitle title="Source revision" />
    <p class="font-mono text-xs break-all text-muted">{buildInfo.revision}</p>
  </section>
{/if}
<LegalNotices />
