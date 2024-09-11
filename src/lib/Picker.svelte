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
  <div
    style:display="flex"
    style:flex-direction="column"
    style:justify-content="space-between"
    style:align-items="center"
    style:gap="1rem"
  >
    <p>Please select an exported CSV file from Float Control to get started.</p>
    <input type="file" {onchange} accept="text/csv" />
  </div>
  <div
    style:display="flex"
    style:flex-direction="column"
    style:justify-content="end"
    style:align-items="center"
    style:text-align="left"
    style:flex-grow="1"
    style:font-size="0.8rem"
  >
    <p>Some notes:</p>
    <ul>
      <li>Data never leaves your device, your browser does all the work!</li>
      <li>
        Source code available here: <a href="https://github.com/acheronfail/float-view">acheronfail/float-view</a>
      </li>
      <li>
        Credit to <a href="https://apps.apple.com/au/app/float-control-vesc-companion/id1590924299">Float Control</a> for
        making a great app for VESCs!
      </li>
    </ul>
  </div>
</Modal>
