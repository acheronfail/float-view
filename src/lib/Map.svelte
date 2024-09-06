<script lang="ts">
  import Leaflet, { type LatLngExpression } from 'leaflet';
  import riderIconSvg from '../assets/rider-icon.svg?raw';

  // TODO: fault markers
  interface Props {
    selectedIndex: number;
    gpsPoints: LatLngExpression[];
  }

  let map: Leaflet.Map | null = null;
  let riderMarker: Leaflet.Marker | null = null;
  let riderIcon = Leaflet.divIcon({ className: 'rider-icon', html: riderIconSvg });

  let { selectedIndex, gpsPoints }: Props = $props();

  $effect(() => {
    if (map) {
      if (riderMarker) {
        riderMarker.remove();
      }

      riderMarker = Leaflet.marker(gpsPoints[selectedIndex], { icon: riderIcon }).addTo(map);
    }
  });

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
  }
</script>

<div id="map" use:createMap></div>

<style>
  div#map {
    height: 480px;
    width: 640px;
  }
</style>
