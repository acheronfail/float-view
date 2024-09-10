<script lang="ts" module>
  export interface Props {
    file?: File;
  }
</script>

<script lang="ts">
  import type { ChangeEventHandler } from 'svelte/elements';
  import Modal from './Modal.svelte';
  import { demoFile } from './Csv';

  let { file = $bindable() }: Props = $props();

  const onchange: ChangeEventHandler<HTMLInputElement> = (e) => {
    const { files } = e.currentTarget;
    if (files && files.length > 0) {
      file = files[0];
    }
  };
</script>

<Modal open={!file} closeHandler={() => (file = demoFile)} closeText="view demo ride" title="Welcome!">
  <div style:display="flex" style:flex-direction="column">
    <p>Please select an exported CSV file from Float Control to get started.</p>
    <input type="file" {onchange} accept="text/csv" />
  </div>
</Modal>
