<script lang="ts" module>
  import type { Snippet } from 'svelte';

  export interface Props {
    open?: boolean;
    title: string;
    closeText?: string;
    closeHandler?: () => void;
    children: Snippet;
  }
</script>

<script lang="ts">
  let {
    open = $bindable(false),
    closeHandler = () => (open = false),
    closeText = 'close',
    title,
    children,
  }: Props = $props();
</script>

{#if open}
  <div class="overlay"></div>
  <div class="modal-container">
    <div
      class="modal"
      style:display="flex"
      style:flex-direction="column"
      style:justify-content="space-between"
      style:align-items="center"
    >
      <h2>{title}</h2>
      <div style:flex-grow="1">
        {@render children()}
      </div>
      <div>
        <button onclick={closeHandler}>{closeText}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    background-color: #000;
    opacity: 0.5;
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
  }

  .modal-container {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10010;
  }

  .modal {
    width: 50vw;
    height: 50vh;
    background-color: #333;
    border: 1px solid #888;
    border-radius: 6px;
    padding: 1rem;
    text-align: center;
  }

  @media (width <= 600px) {
    .modal {
      width: 80vw;
    }
  }
</style>
