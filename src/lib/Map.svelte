<script lang="ts" module>
  export interface FaultPoint {
    index: number;
    fault: string;
  }

  export interface Props {
    selectedIndex: number;
    visibleIndices: boolean[];
    gpsPoints: LatLngExpression[];
    faultPoints: FaultPoint[];
  }
</script>

<script lang="ts">
  import Leaflet, { type LatLngExpression } from 'leaflet';
  import riderIconSvg from '../assets/rider-icon.svg?raw';

  let map: Leaflet.Map | null = null;
  let polyline: Leaflet.Polyline | null = null;
  let riderMarker: Leaflet.Marker | null = null;
  let riderIcon = Leaflet.divIcon({ className: 'rider-icon', html: riderIconSvg });
  let faultIcon = Leaflet.divIcon({ className: 'fault-icon' });

  let { selectedIndex = $bindable(), visibleIndices = $bindable(), gpsPoints, faultPoints }: Props = $props();

  let node = $state<HTMLDivElement | undefined>();

  $effect(() => {
    if (node && gpsPoints) {
      renderMap(node);
    }
  })

  $effect(() => {
    if (map) {
      if (riderMarker) {
        riderMarker.remove();
      }

      riderMarker = Leaflet.marker(gpsPoints[selectedIndex], { icon: riderIcon }).addTo(map);
    }
  });

  const stateToClass = (state: string) => state.toLowerCase().replace(/\s+/g, '_');

  function setVisibleIndices() {
    // FIXME: disabled since computed selected index in charts is too slow
    // see `selectedDataPointIndex` in `Chart.svelte`
    return visibleIndices = new Array(gpsPoints.length).fill(true);

    // SAFETY: only called when a valid map has been created
    const bounds = map!.getBounds();
    // SAFETY: only called when a valid line has been created
    if (bounds.contains(polyline!.getBounds())) {
      visibleIndices = new Array(gpsPoints.length).fill(true);
    } else {
      visibleIndices = gpsPoints.map(point => bounds.contains(point));
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
        selectedIndex = 0;
      }
      return el;
    }
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
          selectedIndex = index;
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
