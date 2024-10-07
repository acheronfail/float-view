<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';

  export interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    file?: File;
  }
</script>

<script lang="ts">
  import type { ChangeEventHandler } from 'svelte/elements';
  import Modal from './Modal.svelte';
  import { demoFile } from '../lib/parse/float-control';
  import Link from './Link.svelte';
  import { supportedMimeTypeString } from '../lib/parse';

  let { file = $bindable(), ...rest }: Props = $props();

  const onchange: ChangeEventHandler<HTMLInputElement> = (e) => {
    const { files } = e.currentTarget;
    if (files && files.length > 0) {
      file = files[0];
    }
  };
</script>

<Modal open={!file} closeHandler={() => (file = demoFile)} closeText="view demo ride" title="Welcome!" {...rest}>
  <div class="flex flex-col justify-between items-center gap-4">
    <p>To get started, please open either:</p>
    <ul class="list-disc list-inside text-left">
      <li>
        an exported <span class="font-mono">CSV</span> or <span class="font-mono">ZIP</span> file from
        <strong>Float Control</strong>
      </li>
      <li>an exported <span class="font-mono">JSON</span> file from <strong>Floaty</strong></li>
      <li>... or drag and drop a supported file onto this window!</li>
    </ul>
    <input
      class="text-center file:mr-4 file:py-2 file:px-4
      file:rounded file:border file:border-solid file:border-slate-600
      file:text-sm file:font-bold file:bg-slate-700 active:file:bg-slate-800"
      type="file"
      {onchange}
      accept={supportedMimeTypeString}
    />
  </div>
  <div class="grow flex flex-col justify-end items-center text-left text-xs">
    <h4 class="font-bold my-2 text-sm">Some notes:</h4>
    <ul class="list-disc list-inside">
      <li>
        <strong>Data never leaves your device, your browser does all the work!</strong>
      </li>
      <li>
        Source code available here: <Link
          href="https://github.com/acheronfail/float-view"
          label="acheronfail/float-view"
        />
      </li>
      <li>
        Credit to <Link
          href="https://apps.apple.com/au/app/float-control-vesc-companion/id1590924299"
          label="Float Control"
        /> and <Link
          href="https://play.google.com/store/apps/details?id=com.floaty.floatyapp&pcampaignid=web_share"
          label="Floaty"
        /> for making great VESC apps!
      </li>
      <li>
        Credit to <Link href="https://jf.id.au/blog/how-i-built-the-best-chart-in-the-world" label="jakzo" /> for examples
        of excellent charts!
      </li>
      <li>
        Credit to <Link href="https://thenounproject.com/icon/onewheel-4260841/" label="Luis Prado" /> for the Onewheel Rider
        Icon!
      </li>
      <li class="font-mono">
        Build version: {import.meta.env.VITE_BUILD_VERSION}
      </li>
    </ul>
    <h4 class="font-bold my-2 text-sm">This site can be saved to your device:</h4>
    <ol class="list-decimal list-inside">
      <li>Open the website in your browser (you're already here)</li>
      <li>Click the Share button</li>
      <li>Select <strong class="font-mono">Add to Home Screen</strong></li>
      <li>Now you can use it offline whenever you'd like</li>
    </ol>
  </div>
</Modal>
