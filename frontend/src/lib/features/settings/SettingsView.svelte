<script lang="ts">
  import { backendState } from '$lib/backend/state.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import { navigationLink } from '$lib/ui/navigation-link';
  import Appearance from './Appearance.svelte';
  import { settingsCategories } from './categories';
  const permissionAttention = $derived(
    backendState.snapshot?.permissions.some(
      (row) =>
        !row.optional && (['denied', 'restricted', 'limited'].includes(row.status) || row.servicesEnabled === false)
    )
  );
</script>

<section aria-label="Settings" class="space-y-6 py-4">
  <Appearance />
  <nav aria-label="Settings categories" class="space-y-4">
    {#each [settingsCategories.slice(0, 3), settingsCategories.slice(3)] as group, groupIndex (groupIndex)}
      <ul class="divide-y divide-outline overflow-hidden rounded-2xl border border-outline bg-surface">
        {#each group as category (category.slug)}
          <li>
            <a
              href={`#/settings/${category.slug}`}
              use:navigationLink
              class="flex min-h-20 touch-manipulation items-center gap-3 px-4 py-3 hover:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              <span
                class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-on-accent-soft"
                ><Icon name={category.icon} class="size-5" /></span
              >
              <span class="min-w-0 flex-1">
                <span class="block font-medium">{category.title}</span>
                <span class="mt-0.5 block text-xs leading-5 text-muted">{category.description}</span>
                {#if category.slug === 'connection' && permissionAttention}<span
                    class="mt-1 block text-xs font-medium text-warning">Permission needs attention</span
                  >{/if}
              </span>
              <Icon name="chevron-right" class="size-4 shrink-0 text-muted" />
            </a>
          </li>
        {/each}
      </ul>
    {/each}
  </nav>
</section>
