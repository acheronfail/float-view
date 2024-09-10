<script lang="ts" module>
  export interface FaultPoint {
    index: number;
    fault: string;
  }

  export interface Props {
    visibleRows: FloatControlRowWithIndex[];
    setVisible: (visible: boolean[]) => void;
    setSelectedIdx: (index: number) => void;
    selectedRowIndex: number;
    gpsPoints: LatLngExpression[];
    faultPoints: FaultPoint[];
  }
</script>

<script lang="ts">
  import Leaflet, { type LatLngExpression } from 'leaflet';
  import riderIconSvg from '../assets/rider-icon.svg?raw';
  import type { FloatControlRowWithIndex } from './Csv';
  import { untrack } from 'svelte';

  let map: Leaflet.Map | null = null;
  let polyline: Leaflet.Polyline | null = null;
  let riderMarker: Leaflet.Marker | null = null;
  let riderIcon = Leaflet.divIcon({ className: 'rider-icon', html: riderIconSvg });
  let faultIcon = Leaflet.divIcon({ className: 'fault-icon' });

  let {
    setSelectedIdx,
    selectedRowIndex,
    setVisible,
    visibleRows,
    gpsPoints,
    faultPoints,
  }: Props = $props();

  let node = $state<HTMLDivElement | undefined>();

  $effect(() => {
    if (node && gpsPoints) {
      untrack(() => renderMap(node!));
    }
  });

  $effect(() => {
    if (map) {
      if (riderMarker) {
        riderMarker.remove();
      }

      const location = gpsPoints[selectedRowIndex];
      if (location) {
        riderMarker = Leaflet.marker(location, { icon: riderIcon }).addTo(map);
      }
    }
  });

  const stateToClass = (state: string) => state.toLowerCase().replace(/\s+/g, '_');

  function setVisibleIndices() {
    // SAFETY: only called when a valid map has been created
    const bounds = map!.getBounds();
    // SAFETY: only called when a valid line has been created
    if (bounds.contains(polyline!.getBounds())) {
      setVisible(new Array(gpsPoints.length).fill(true));
    } else {
      setVisible(gpsPoints.map((point) => bounds.contains(point)));
    }
  }

  const ResetButton = Leaflet.Control.extend({
    options: { position: 'topright' },
    onAdd: () => {
      const el = Leaflet.DomUtil.create('div');
      el.style.backgroundColor = 'black';
      el.style.border = '1px solid #333';
      el.style.borderRadius = '3px';
      el.style.padding = '2px 4px';
      el.style.cursor = 'pointer';
      el.textContent = 'reset';
      // SAFETY: can't be clicked without these existing
      el.onclick = () => {
        map!.fitBounds(polyline!.getBounds());
        setSelectedIdx(0);
      };
      return el;
    },
  });

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

    // create line
    polyline = Leaflet.polyline(gpsPoints).addTo(map);

    // fit ride in map
    map.fitBounds(polyline.getBounds());

    // add a reset zoom button
    map.addControl(new ResetButton());

    // add fault markers
    for (const { index, fault } of faultPoints) {
      const marker = Leaflet.marker(gpsPoints[index], { icon: faultIcon, title: fault }).addTo(map);
      const element = marker.getElement();
      if (element) {
        element.classList.add(stateToClass(fault));
        element.addEventListener('click', () => {
          // find the point in `visibleRows`, if it was clicked it was visible, so it must
          // be in this list
          for (let i = 0; i < visibleRows.length; i++) {
            if (visibleRows[i].index === index) {
              setSelectedIdx(i);
              break;
            }
          }
        });
      }
    }

    map.addEventListener('zoomend', setVisibleIndices);
    map.addEventListener('moveend', setVisibleIndices);
    setVisibleIndices();
  }
</script>

<div id="map" bind:this={node}></div>

<style>
  div#map {
    position: absolute;
    width: 100%;
    height: 100%;
    border: 1px solid transparent;
    outline: none;
  }

  div#map:focus-within {
    border-color: #008c9c;
  }

  :global(.fault-icon) {
    background-color: magenta;
    border-radius: 50%;
    border: 1px solid black;
  }
  :global(.fault-icon.stop_half) {
    background-color: orange;
  }
  :global(.fault-icon.stop_full) {
    background-color: red;
  }
  :global(.fault-icon.stop_angle) {
    background-color: goldenrod;
  }
  :global(.fault-icon.wheelslip) {
    background-color: orangered;
  }
  :global(.fault-icon.startup) {
    background-color: green;
  }
</style>
