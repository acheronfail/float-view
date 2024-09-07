<script lang="ts" context="module">
  export interface FaultPoint {
    index: number;
    id: number;
    fault: string;
  }

  export interface Props {
    selectedIndex: number;
    gpsPoints: LatLngExpression[];
    faultPoints: FaultPoint[];
  }
</script>

<script lang="ts">
  import Leaflet, { type LatLngExpression } from 'leaflet';
  import riderIconSvg from '../assets/rider-icon.svg?raw';

  let map: Leaflet.Map | null = null;
  let riderMarker: Leaflet.Marker | null = null;
  let riderIcon = Leaflet.divIcon({ className: 'rider-icon', html: riderIconSvg });
  let faultIcon = Leaflet.divIcon({ className: 'fault-icon' });

  let { selectedIndex = $bindable(), gpsPoints, faultPoints }: Props = $props();

  $effect(() => {
    if (map) {
      if (riderMarker) {
        riderMarker.remove();
      }

      riderMarker = Leaflet.marker(gpsPoints[selectedIndex], { icon: riderIcon }).addTo(map);
    }
  });

  const stateToClass = (state: string) => state.toLowerCase().replace(/\s+/g, '_');

  function createMap(node: HTMLDivElement) {
    // create map
    map = Leaflet.map(node, { preferCanvas: true });

    // use OSM tiles
    Leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    // create line
    const polyline = Leaflet.polyline(gpsPoints).addTo(map);

    // fit ride in map
    map.fitBounds(polyline.getBounds());

    // add fault markers
    for (const { index, fault } of faultPoints) {
      // TODO: onclick of fault, move index to fault
      const marker = Leaflet.marker(gpsPoints[index], { icon: faultIcon, title: fault }).addTo(map);
      const element = marker.getElement();
      if (element) {
        element.classList.add(stateToClass(fault));
        element.addEventListener('click', () => {
          selectedIndex = index;
        });
      }
    }
  }
</script>

<div id="map" use:createMap></div>

<style>
  div#map {
    position: absolute;
    width: 100%;
    height: 100%;
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
