<script lang="ts">
  import Leaflet from 'leaflet';
  import { untrack } from 'svelte';
  import {
    type Props,
    getIcon,
    riderIcon,
    getTravelledLine,
    SegmentedPolyline,
    computeSegmentedLines,
    getBaseLine,
    createMapButton,
    getTravelledLineColor,
  } from './Map';
  import Modal from './Modal.svelte';
  import Input from './Input.svelte';
  import settings from '../lib/settings.svelte';

  let map: Leaflet.Map | null = null;
  let riderMarker: Leaflet.Marker | null = null;
  const markers: Leaflet.Marker[] = [];

  let {
    setSelectedIdx,
    selectedRowIndex,
    visible,
    setVisible,
    visibleRows,
    gpsPoints,
    gpsGaps,
    pointsOfInterest,
  }: Props = $props();

  let node = $state<HTMLDivElement | undefined>();
  let travelledPolyline = $state<SegmentedPolyline | null>(null);
  let basePolyline = $state<SegmentedPolyline | null>(null);
  let segmentModalOpen = $state(false);
  let hiddenRideSegments = $state<Set<number>>(new Set());
  let polylineSegments = $derived(computeSegmentedLines(gpsGaps, gpsPoints.length, hiddenRideSegments));
  let rideSegments = $derived<Set<number>>(new Set(polylineSegments.map((s) => s.segmentIdx)));

  $effect(() => {
    if (node && gpsPoints) {
      untrack(() => renderMap(node!));
    }
  });

  $effect(() => {
    if (map && pointsOfInterest) {
      updateMarkers();
    }
  });

  $effect(() => {
    if (map) {
      untrack(() => {
        if (riderMarker) {
          riderMarker.remove();
        }
      });

      const latLng = gpsPoints[selectedRowIndex];
      if (latLng) {
        riderMarker = Leaflet.marker(latLng, { icon: riderIcon }).addTo(map);
      }

      if (settings.mapIconsGreyscale) {
        for (const marker of markers) {
          const el = marker.getElement();
          if (el && typeof el.dataset.index === 'string') {
            const index = parseInt(el.dataset.index);
            if (index > selectedRowIndex) {
              el.classList.add('greyscale');
            } else {
              el.classList.remove('greyscale');
            }
          }
        }
      }
    }
  });

  $effect(() => {
    untrack(() => {
      if (basePolyline) {
        basePolyline.remove();
      }
      if (travelledPolyline) {
        travelledPolyline.remove();
      }
    });

    // ensure this is updated each time the visible rows change
    visibleRows;

    basePolyline = getBaseLine(gpsPoints, gpsGaps, hiddenRideSegments).addTo(map!);
    travelledPolyline = getTravelledLine(gpsPoints, gpsGaps, selectedRowIndex, hiddenRideSegments).addTo(map!);
  });

  function setVisibleIndices() {
    // SAFETY: only called when a valid map has been created
    const bounds = map!.getBounds();
    const polylineBounds = basePolyline!.getBounds();
    // SAFETY: only called when a valid line has been created
    const newVisiblePoints =
      polylineBounds && bounds.contains(polylineBounds)
        ? new Array(gpsPoints.length).fill(true)
        : gpsPoints.map((point) => bounds.contains(point));

    // hide hidden segments
    for (const { start, end, segmentIdx } of polylineSegments) {
      if (hiddenRideSegments.has(segmentIdx)) {
        for (let j = start; j < end; ++j) {
          newVisiblePoints[j] = false;
        }
      }
    }

    setVisible(newVisiblePoints);
  }

  const FitButton = createMapButton('re-center', 'topright', () => {
    const polylineBounds = basePolyline?.getBounds();
    if (polylineBounds) {
      // SAFETY: can't be clicked without the map existing
      map!.fitBounds(polylineBounds);
    }

    setSelectedIdx(0);
  });

  const EditSegmentsButton = createMapButton('segments', 'bottomleft', () => (segmentModalOpen = !segmentModalOpen));

  function updateMarkers() {
    for (const marker of markers) {
      marker.remove();
    }
    markers.length = 0;

    // add fault markers
    for (const { index, state } of pointsOfInterest) {
      if (!visible[index]) {
        continue;
      }

      const { icon, className } = getIcon(state);
      const marker = Leaflet.marker(gpsPoints[index]!, {
        icon,
        title: state,
      });

      // SAFETY: this function is never called unless the map has been created
      marker.addTo(map!);
      markers.push(marker);

      const element = marker.getElement();
      if (element) {
        element.dataset.index = index.toString();
        element.classList.add(className);
        element.addEventListener('click', () => {
          // find the point in `visibleRows`: if it was clicked it was visible, so it must
          // be in this list
          for (let i = 0; i < visibleRows.length; i++) {
            if (visibleRows[i]!.index === index) {
              setSelectedIdx(i);
              break;
            }
          }
        });
      }
    }
  }

  function renderMap(node: HTMLDivElement) {
    // cleanup
    if (map) {
      map.removeEventListener('zoomend', setVisibleIndices);
      map.removeEventListener('moveend', setVisibleIndices);
      map.remove();
    }

    // create map
    map = Leaflet.map(node, { preferCanvas: true });

    // use OSM tiles
    Leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    // create lines
    basePolyline = getBaseLine(gpsPoints, gpsGaps, hiddenRideSegments).addTo(map);
    travelledPolyline = getTravelledLine(gpsPoints, gpsGaps, selectedRowIndex, hiddenRideSegments).addTo(map);

    // fit ride in map
    const polylineBounds = basePolyline.getBounds();
    if (polylineBounds) {
      map.fitBounds(polylineBounds);
    }

    // add map buttons
    map.addControl(new FitButton());
    if (polylineSegments.length > 1) {
      map.addControl(new EditSegmentsButton());
    }

    // add markers
    updateMarkers();

    map.addEventListener('zoomend', setVisibleIndices);
    map.addEventListener('moveend', setVisibleIndices);
    setVisibleIndices();
  }
</script>

{#if travelledPolyline}
  <Modal bind:open={segmentModalOpen} title="Ride Segments">
    <p>You can show or hide particular segments of your ride here.</p>
    <ul class="mt-2 w-[50%] flex flex-col gap-2">
      {#each rideSegments as segmentIdx}
        <li class="font-mono font-bold" style:color={getTravelledLineColor(segmentIdx)}>
          <Input
            id="segment-{segmentIdx}"
            type="checkbox"
            label="Segment #{segmentIdx}"
            checked={!hiddenRideSegments.has(segmentIdx)}
            onchange={() => {
              if (hiddenRideSegments.has(segmentIdx)) {
                hiddenRideSegments.delete(segmentIdx);
              } else {
                hiddenRideSegments.add(segmentIdx);
              }

              setVisibleIndices();
              // TODO: would like to be able to re-center here after selecting segments
            }}
          />
        </li>
      {/each}
    </ul>
  </Modal>
{/if}

<div
  data-testid="map"
  class="absolute h-full w-full border border-transparent outline-none focus-within:border-cyan-400"
  bind:this={node}
></div>
