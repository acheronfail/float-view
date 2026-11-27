<script lang="ts">
  let { class: className = 'size-11' }: { class?: string } = $props();
</script>

<span
  aria-hidden="true"
  class={`inline-flex shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-[#965ee2] to-[#482185] text-white shadow-sm ${className}`}
>
  <svg
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="size-3/4"
  >
    <path
      d="M12.5 11H4c.7 2.5 2.9 4 5.7 4H11m-3 2.8c.7 1.4 2.1 2.2 4 2.2M19.5 11H28c-.7 2.5-2.9 4-5.7 4H21m3 2.8c-.7 1.4-2.1 2.2-4 2.2"
    />
    <path d="M22 15c0 4.6-6 9.5-6 9.5s-6-4.9-6-9.5a6 6 0 0 1 12 0Z" />
    <circle cx="16" cy="15" r="1.7" />
  </svg>
</span>
