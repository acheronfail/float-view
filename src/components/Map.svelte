<script lang="ts" module>
  import Leaflet, { type LatLngExpression } from 'leaflet';
  import type { RowWithIndex } from '../lib/parse/types';
  import type { GpsGap } from './App';

  export interface PointOfInterest {
    index: number;
    state: string;
  }

  export interface Props {
    visibleRows: RowWithIndex[];
    setVisible: (visible: boolean[]) => void;
    setSelectedIdx: (index: number) => void;
    selectedRowIndex: number;
    gpsPoints: LatLngExpression[];
    gpsGaps: GpsGap[];
    pointsOfInterest: PointOfInterest[];
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { getIcon, MapLine, riderIcon, getPolyline, SegmentedPolyline } from '../lib/map-helpers';

  let map: Leaflet.Map | null = null;
  let basePolyline: SegmentedPolyline | null = null;
  let travelledPolyline: SegmentedPolyline | null = null;
  let riderMarker: Leaflet.Marker | null = null;
  const markers: Leaflet.Marker[] = [];

  let { setSelectedIdx, selectedRowIndex, setVisible, visibleRows, gpsPoints, gpsGaps, pointsOfInterest }: Props =
    $props();

  let node = $state<HTMLDivElement | undefined>();

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
      if (riderMarker) {
        riderMarker.remove();
      }

      if (travelledPolyline) {
        travelledPolyline.remove();
      }

      const location = gpsPoints[selectedRowIndex];
      if (location) {
        riderMarker = Leaflet.marker(location, { icon: riderIcon }).addTo(map);
        travelledPolyline = getPolyline(gpsPoints, gpsGaps, selectedRowIndex, MapLine.Travelled).addTo(map);
      }
    }
  });

  function setVisibleIndices() {
    // SAFETY: only called when a valid map has been created
    const bounds = map!.getBounds();
    // SAFETY: only called when a valid line has been created
    if (bounds.contains(basePolyline!.getBounds())) {
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
        map!.fitBounds(basePolyline!.getBounds());
        setSelectedIdx(0);
      };
      return el;
    },
  });

  function updateMarkers() {
    for (const marker of markers) {
      marker.remove();
    }
    markers.length = 0;

    // add fault markers
    for (const { index, state: id } of pointsOfInterest) {
      const { icon, className } = getIcon(id);
      const marker = Leaflet.marker(gpsPoints[index]!, {
        icon,
        title: id,
      });

      // SAFETY: this function is never called unless the map has been created
      marker.addTo(map!);
      markers.push(marker);

      const element = marker.getElement();
      if (element) {
        element.classList.add(className);
        element.addEventListener('click', () => {
          // find the point in `visibleRows`, if it was clicked it was visible, so it must
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
    basePolyline = getPolyline(gpsPoints, gpsGaps, selectedRowIndex, MapLine.Base).addTo(map);
    travelledPolyline = getPolyline(gpsPoints, gpsGaps, selectedRowIndex, MapLine.Travelled).addTo(map);

    // fit ride in map
    map.fitBounds(basePolyline.getBounds());

    // add a reset zoom button
    map.addControl(new ResetButton());

    // add markers
    updateMarkers();

    map.addEventListener('zoomend', setVisibleIndices);
    map.addEventListener('moveend', setVisibleIndices);
    setVisibleIndices();
  }
</script>

<div
  data-testid="map"
  class="absolute h-full w-full border border-transparent outline-none focus-within:border-cyan-400"
  bind:this={node}
></div>
