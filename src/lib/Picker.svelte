<script lang="ts" context="module">
  export interface Props {
    file?: File;
  }
</script>

<script lang="ts">
  import type { ChangeEventHandler } from 'svelte/elements';

  // let { file = $bindable() }: Props = $props();

  // const onchange: ChangeEventHandler<HTMLInputElement> = (e) => {
  //   const { files } = e.currentTarget;
  //   if (files && files.length > 0) {
  //     file = files[0];
  //   }
  // };
</script>

<div class="overlay"></div>
<div class="modal-container">
  <div class="modal">
    <h1>Welcome!</h1>
    <p>Please select an exported CSV file from Float Control to get started.</p>
    <!-- <input type="file" {onchange} /> -->
  </div>
</div>

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
