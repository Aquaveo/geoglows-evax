import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Fix Leaflet's default marker icons when bundled by Vite.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface ReachMapProps {
  lat: number;
  lon: number;
  riverId: number;
}

export function ReachMap({ lat, lon, riverId }: ReachMapProps) {
  return (
    <MapContainer
      center={[lat, lon]}
      zoom={6}
      style={{ width: '100%', height: 460, borderRadius: 8 }}
      key={`${lat}-${lon}`}
    >
      <TileLayer
        url="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri — World Imagery"
        maxZoom={19}
      />
      <TileLayer
        url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        attribution=""
        maxZoom={19}
      />
      <Marker position={[lat, lon]}>
        <Popup>River ID: {riverId}</Popup>
      </Marker>
    </MapContainer>
  );
}
