<script lang="ts">
  import { boardAppearanceColours, type BoardAppearance } from '$lib/backend/contract';
  import { activateFromPointer, activateFromKeyboardOrAssistiveClick } from '$lib/ui/activation';
  import BoardIcon from './BoardIcon.svelte';
  import {
    appearanceParts,
    partLabels,
    styleCounts,
    colourAreas,
    cycleAppearance,
    swatchText,
    type AppearancePart,
    type AppearanceColour,
  } from './appearance';
  let { value, onchange }: { value: BoardAppearance; onchange: (value: BoardAppearance) => void } = $props();
  let part = $state<AppearancePart>('rail');
  let area = $state<AppearanceColour>('leftTop');
  const selectedArea = $derived(colourAreas[part].find((v) => v.key === area) ?? colourAreas[part][0]);
  const colour = $derived(value[selectedArea.key]);
  const visible = $derived(!((part === 'fender' && value.fender === 1) || (part === 'hooks' && value.hooks === 1)));
  function cycle(direction: number) {
    onchange(cycleAppearance(value, part, direction));
  }
  const button =
    'min-h-11 min-w-11 touch-manipulation rounded-lg border border-outline px-2 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:border-accent aria-pressed:bg-accent-soft';
</script>

<section aria-label="Board appearance" class="mx-auto w-full max-w-sm space-y-4">
  <h2 class="font-medium">Appearance</h2>
  <div class="rounded-xl bg-elevated px-2 py-4">
    <BoardIcon appearance={value} class="block w-full" />
  </div>
  <div role="group" aria-label="Choose a part" class="grid grid-cols-4 gap-1">
    {#each appearanceParts as item (item)}
      <button
        type="button"
        class={button}
        aria-pressed={part === item}
        onpointerdown={(e) =>
          activateFromPointer(e, () => {
            part = item;
          })}
        onclick={(e) =>
          activateFromKeyboardOrAssistiveClick(e, () => {
            part = item;
          })}>{partLabels[item]}</button
      >
    {/each}
  </div>
  <div class="grid grid-cols-[3.25rem_1fr_3.25rem] items-center gap-3">
    <button
      type="button"
      class={button + ' h-13 bg-elevated text-2xl'}
      aria-label={`Previous ${partLabels[part].toLowerCase()} option`}
      onpointerdown={(e) => activateFromPointer(e, () => cycle(-1))}
      onclick={(e) => activateFromKeyboardOrAssistiveClick(e, () => cycle(-1))}>‹</button
    >
    <span aria-live="polite" class="text-center font-medium tabular-nums">{value[part]} / {styleCounts[part]}</span>
    <button
      type="button"
      class={button + ' h-13 bg-elevated text-2xl'}
      aria-label={`Next ${partLabels[part].toLowerCase()} option`}
      onpointerdown={(e) => activateFromPointer(e, () => cycle(1))}
      onclick={(e) => activateFromKeyboardOrAssistiveClick(e, () => cycle(1))}>›</button
    >
  </div>
  {#if visible}
    {#if colourAreas[part].length > 1}
      <div role="group" aria-label="Choose an area to colour" class="grid grid-cols-2 gap-1">
        {#each colourAreas[part] as item (item.key)}
          <button
            type="button"
            class={button + ' flex items-center justify-center gap-2'}
            aria-pressed={selectedArea.key === item.key}
            onpointerdown={(e) =>
              activateFromPointer(e, () => {
                area = item.key;
              })}
            onclick={(e) =>
              activateFromKeyboardOrAssistiveClick(e, () => {
                area = item.key;
              })}
          >
            <span class="size-2.5 shrink-0 rounded-full border border-outline" style:background={value[item.key]}
            ></span>{item.label}
          </button>
        {/each}
      </div>
    {/if}
    <div class="flex justify-between gap-3 text-sm">
      <span>Colour</span><span class="text-muted">{boardAppearanceColours.find(([, hex]) => hex === colour)?.[0]}</span>
    </div>
    <div role="group" aria-label="Colour presets" class="mx-auto flex max-w-80 flex-wrap justify-center gap-1.5">
      {#each boardAppearanceColours as [name, hex] (hex)}
        <button
          type="button"
          aria-label={name}
          title={name}
          aria-pressed={colour === hex}
          class="flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:bg-elevated aria-pressed:ring-1 aria-pressed:ring-accent"
          onpointerdown={(e) => activateFromPointer(e, () => onchange({ ...value, [selectedArea.key]: hex }))}
          onclick={(e) =>
            activateFromKeyboardOrAssistiveClick(e, () => onchange({ ...value, [selectedArea.key]: hex }))}
        >
          <span
            aria-hidden="true"
            class="flex size-7 items-center justify-center rounded-full border border-outline"
            style:background={hex}
            style:color={swatchText(hex)}>{colour === hex ? '✓' : ''}</span
          >
        </button>
      {/each}
    </div>
  {:else}
    <p class="py-3 text-center text-sm text-muted">Choose {part === 'fender' ? 'a fender' : 'hooks'} to colour it.</p>
  {/if}
</section>
