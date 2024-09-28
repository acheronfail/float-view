<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  export interface Props extends HTMLAttributes<HTMLDivElement> {
    open?: boolean;
    title: string;
    closable?: boolean;
    closeText?: string;
    closeHandler?: () => void;
    children: Snippet;
  }
</script>

<script lang="ts">
  import Button from './Button.svelte';

  let {
    open = $bindable(false),
    closeHandler = () => (open = false),
    closeText = 'close',
    closable = true,
    title,
    children,
    ...rest
  }: Props = $props();
</script>

{#if open}
  <div class="fixed top-0 left-0 right-0 bottom-0 z-[10000] bg-slate-950 opacity-50"></div>
  <div class="fixed top-0 left-0 right-0 bottom-0 z-[10010] flex justify-center items-center" {...rest}>
    <div
      class="flex flex-col justify-between items-center text-center overflow-y-auto bg-slate-800
      h-screen w-screen border-0 p-4 rounded-none wide:w-[60vw] wide:h-[80vh] wide:rounded wide:border"
    >
      <h2 class="font-bold text-xl mb-2 underline">{title}</h2>
      <div class="w-full h-full grow flex flex-col">
        {@render children()}
      </div>
      {#if closable}
        <div class="mt-4">
          <Button onclick={closeHandler}>{closeText}</Button>
        </div>
      {/if}
    </div>
  </div>
{/if}
