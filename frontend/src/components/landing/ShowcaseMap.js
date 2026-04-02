import { useCallback, useRef } from "react";
import { GoogleMap, useJsApiLoader, Marker, Polyline, InfoWindow } from "@react-google-maps/api";

/*
 * Reusable Google Maps showcase for landing / features pages.
 * Uses the REAL Google Maps JS API — same as TripMap.
 * Renders Paris demo pins with per-day colors, route polylines, hotel marker.
 * Animation is controlled externally via props.
 */

const DAY_COLORS = { 1: "#F97316", 2: "#3B82F6", 3: "#22C55E" };

// Real Paris landmark coordinates
const PARIS_PINS = {
  day1: [
    { lat: 48.8867, lng: 2.3431 }, // Sacré-Cœur
    { lat: 48.8841, lng: 2.3323 }, // Moulin Rouge
    { lat: 48.8720, lng: 2.3316 }, // Opéra Garnier
    { lat: 48.8634, lng: 2.3275 }, // Jardin des Tuileries
    { lat: 48.8606, lng: 2.3376 }, // Louvre
    { lat: 48.8584, lng: 2.3505 }, // Pont Neuf
  ],
  day2: [
    { lat: 48.8584, lng: 2.2945 }, // Eiffel Tower
    { lat: 48.8566, lng: 2.3128 }, // Invalides
    { lat: 48.8600, lng: 2.3266 }, // Musée d'Orsay
    { lat: 48.8638, lng: 2.3135 }, // Pont Alexandre III
    { lat: 48.8554, lng: 2.3451 }, // Sainte-Chapelle
    { lat: 48.8530, lng: 2.3499 }, // Notre-Dame
  ],
  day3: [
    { lat: 48.8462, lng: 2.3372 }, // Jardin du Luxembourg
    { lat: 48.8463, lng: 2.3462 }, // Panthéon
    { lat: 48.8554, lng: 2.3654 }, // Place des Vosges
    { lat: 48.8580, lng: 2.3620 }, // Le Marais
    { lat: 48.8533, lng: 2.3694 }, // Bastille
    { lat: 48.8728, lng: 2.3636 }, // Canal Saint-Martin
  ],
  hotel: { lat: 48.8588, lng: 2.3620, name: "Hotel Le Marais", rating: 4.4, address: "Rue de Rivoli" },
};

const ALL_PINS = [
  ...PARIS_PINS.day1.map((p, i) => ({ ...p, day: 1, n: i + 1 })),
  ...PARIS_PINS.day2.map((p, i) => ({ ...p, day: 2, n: i + 1 })),
  ...PARIS_PINS.day3.map((p, i) => ({ ...p, day: 3, n: i + 1 })),
];

const CENTER = { lat: 48.862, lng: 2.335 };

export default function ShowcaseMap({
  visiblePins = ALL_PINS.length,
  showRoutes = true,
  showHotel = true,
  activeDay = null,
  showHotelInfo = false,
  zoom = 13,
  children,
  style = {},
  className = "",
}) {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY || "",
  });

  const mapRef = useRef(null);
  const onLoad = useCallback((map) => { mapRef.current = map; }, []);

  if (!isLoaded) {
    return (
      <div className={`bg-gray-100 animate-pulse ${className}`} style={style}>
        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
          Loading map...
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} style={style}>
      <GoogleMap
        center={CENTER}
        zoom={zoom}
        onLoad={onLoad}
        mapContainerStyle={{ width: "100%", height: "100%" }}
        options={{
          disableDefaultUI: true,
          zoomControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: "none",
          clickableIcons: false,
          keyboardShortcuts: false,
        }}
      >
        {/* Route polylines — render BEFORE markers so pins are on top */}
        {showRoutes &&
          [
            { pts: PARIS_PINS.day1, color: DAY_COLORS[1], day: 1 },
            { pts: PARIS_PINS.day2, color: DAY_COLORS[2], day: 2 },
            { pts: PARIS_PINS.day3, color: DAY_COLORS[3], day: 3 },
          ].map((route, ri) => (
            <Polyline
              key={ri}
              path={route.pts}
              options={{
                strokeColor: route.color,
                strokeWeight: 4,
                strokeOpacity: activeDay && activeDay !== route.day ? 0.15 : 0.8,
              }}
            />
          ))}

        {/* Attraction markers — numbered circles with day colors */}
        {ALL_PINS.slice(0, visiblePins).map((pin, i) => {
          const dimmed = activeDay && pin.day !== activeDay;
          return (
            <Marker
              key={`pin-${i}`}
              position={{ lat: pin.lat, lng: pin.lng }}
              label={{
                text: String(pin.n),
                color: "white",
                fontWeight: "bold",
                fontSize: "11px",
              }}
              icon={{
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: 14,
                fillColor: DAY_COLORS[pin.day],
                fillOpacity: dimmed ? 0.25 : 1,
                strokeColor: "white",
                strokeWeight: 2.5,
              }}
              opacity={dimmed ? 0.3 : 1}
              zIndex={dimmed ? 1 : 10}
            />
          );
        })}

        {/* Hotel marker — house/building icon */}
        {showHotel && (
          <Marker
            position={{ lat: PARIS_PINS.hotel.lat, lng: PARIS_PINS.hotel.lng }}
            icon={{
              path: "M-8,8 L-8,-2 L0,-8 L8,-2 L8,8 Z M-4,8 L-4,2 L0,2 L0,8 Z",
              scale: 1.5,
              fillColor: "#111111",
              fillOpacity: 1,
              strokeColor: "white",
              strokeWeight: 2.5,
            }}
            zIndex={999}
          />
        )}

        {/* Hotel info window */}
        {showHotel && showHotelInfo && (
          <InfoWindow
            position={{ lat: PARIS_PINS.hotel.lat + 0.003, lng: PARIS_PINS.hotel.lng }}
            options={{ disableAutoPan: true, pixelOffset: new window.google.maps.Size(0, -10) }}
          >
            <div style={{ padding: "2px 4px", minWidth: 140 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 14 }}>🏨</span>
                <strong style={{ fontSize: 13 }}>{PARIS_PINS.hotel.name}</strong>
              </div>
              <div style={{ fontSize: 11, color: "#666", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: "#F59E0B" }}>★</span>
                <span>{PARIS_PINS.hotel.rating}</span>
                <span>·</span>
                <span>{PARIS_PINS.hotel.address}</span>
              </div>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>

      {/* Overlay children — badges, info cards, etc. */}
      {children}
    </div>
  );
}

export { ALL_PINS, PARIS_PINS, DAY_COLORS };
