<script lang="ts" context="module">
  export interface Props {
    file?: File;
    demo: boolean;
  }
</script>

<script lang="ts">
  import type { ChangeEventHandler } from 'svelte/elements';

  let { demo = $bindable(), file = $bindable() }: Props = $props();

  const onchange: ChangeEventHandler<HTMLInputElement> = (e) => {
    const { files } = e.currentTarget;
    if (files && files.length > 0) {
      file = files[0];
    }
  };
</script>

{#if !demo}
  <div class="overlay"></div>
  <div class="modal-container">
    <div
      class="modal"
      style:display="flex"
      style:flex-direction="column"
      style:justify-content="space-between"
      style:align-items="center"
    >
      <h1>Welcome!</h1>
      <div>
        <p>Please select an exported CSV file from Float Control to get started.</p>
        <input type="file" {onchange} />
      </div>

      <button onclick={() => (demo = !demo)}>just let me see the demo</button>
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
    position: absolute;
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
</style>
